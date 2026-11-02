import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { material as lookupMaterial } from '../data/materials';
import { BATTERIES, WHEELS, lookup, type WheelSpec } from '../data/parts';
import type { PartDef, Shape } from '../sim/design';
import { planeMap, wedgePoints } from '../sim/shapes';
import type { Part } from '../sim/robot';
import { hardware, partMaterial, textTexture } from './surfaces';

/**
 * Turns a simulated part into what it would look like built for real:
 * plate with chamfered edges and bolted seams, proper wheels with tyres and
 * rims, battery packs, gas bottles and ballast. Collision shapes are
 * untouched — this is only what the camera sees, and it stays within a few
 * millimetres of the physics shape.
 */

export interface PartMesh {
  mesh: THREE.Group;
  /** Every material on the part (wear, scorch and highlight apply to all). */
  mats: THREE.MeshPhysicalMaterial[];
}

const V = (p: readonly number[]) => new THREE.Vector3(p[0], p[1], p[2]);

// ---------------------------------------------------------------- convex faces

export interface Face {
  normal: THREE.Vector3;
  /** Counter-clockwise seen from outside. */
  poly: THREE.Vector3[];
  centroid: THREE.Vector3;
}

/** The flat faces of a convex solid (coplanar triangles merged into polygons). */
export function convexFaces(points: THREE.Vector3[]): Face[] {
  const hull = new ConvexHull().setFromPoints(points);
  const groups: Array<{ n: THREE.Vector3; d: number; pts: THREE.Vector3[] }> = [];
  for (const f of hull.faces) {
    const n = f.normal, d = f.constant;
    let g = groups.find((q) => q.n.dot(n) > 0.99995 && Math.abs(q.d - d) < 1e-5);
    if (!g) groups.push(g = { n: n.clone(), d, pts: [] });
    let e = f.edge;
    do {
      const p = e.head().point;
      if (!g.pts.some((q) => q.distanceToSquared(p) < 1e-12)) g.pts.push(p.clone());
      e = e.next;
    } while (e !== f.edge);
  }
  return groups.filter((g) => g.pts.length >= 3).map((g) => {
    const c = g.pts.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(g.pts.length);
    const t1 = g.pts[0].clone().sub(c).normalize();
    const t2 = new THREE.Vector3().crossVectors(g.n, t1);
    const ang = (p: THREE.Vector3) => { const v = p.clone().sub(c); return Math.atan2(v.dot(t2), v.dot(t1)); };
    const poly = [...g.pts].sort((a, b) => ang(a) - ang(b));
    return { normal: g.n, poly, centroid: c };
  });
}

/** Shortest distance from a face's centroid to its edges. */
function inradius(f: Face): number {
  let r = Infinity;
  for (let i = 0; i < f.poly.length; i++) {
    const a = f.poly[i], b = f.poly[(i + 1) % f.poly.length];
    const e = b.clone().sub(a).normalize();
    const v = f.centroid.clone().sub(a);
    r = Math.min(r, v.sub(e.multiplyScalar(v.dot(e))).length());
  }
  return r;
}

/** Shrink a convex face polygon by `c` in its own plane. */
export function insetFace(f: Face, c: number): THREE.Vector3[] {
  const n = f.poly.length;
  const inward = f.poly.map((p, i) => new THREE.Vector3().crossVectors(f.normal, f.poly[(i + 1) % n].clone().sub(p)).normalize());
  return f.poly.map((p, i) => {
    const m1 = inward[(i + n - 1) % n], m2 = inward[i];
    const k = c / (1 + m1.dot(m2));
    return p.clone().addScaledVector(m1.clone().add(m2), k);
  });
}

/**
 * A convex solid with every edge chamfered by about `c`: the hull of all its
 * faces, each shrunk by `c`. This is what a plate edge looks like after it's
 * been cut and deburred, and it catches the light like the real thing.
 */
export function chamferedConvex(faces: Face[], c: number): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (const f of faces) pts.push(...insetFace(f, Math.min(c, inradius(f) * 0.4)));
  return planarUV(new ConvexGeometry(pts));
}

/** Box-projected UVs in half-metres, so textures sit at real-world scale. */
export function planarUV(geo: THREE.BufferGeometry, scale = 2): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    n.crossVectors(b.clone().sub(a), c.clone().sub(a));
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const p = [a, b, c][k];
      const [u, v] = ax >= ay && ax >= az ? [p.z, p.y] : ay >= az ? [p.x, p.z] : [p.x, p.y];
      uv[(i + k) * 2] = u * scale;
      uv[(i + k) * 2 + 1] = v * scale;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

function convexPointsOf(s: Shape): THREE.Vector3[] | null {
  if (s.type === 'box') {
    const [x, y, z] = s.size.map((v) => v / 2);
    const out: THREE.Vector3[] = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push(new THREE.Vector3(sx * x, sy * y, sz * z));
    return out;
  }
  if (s.type === 'wedge') return wedgePoints(s.size, s.lip).map(V);
  if (s.type === 'hull') return s.points.map(V);
  return null;
}

// ---------------------------------------------------------------- fasteners

let boltGeo: THREE.BufferGeometry | null = null;
let boltMat: THREE.MeshPhysicalMaterial | null = null;

/** M8 button-head cap screw, head up +Y, seated at y = 0. */
function bolt() {
  boltGeo ??= new THREE.LatheGeometry([
    new THREE.Vector2(0, 0.0036), new THREE.Vector2(0.0018, 0.0036), new THREE.Vector2(0.0018, 0.0026),
    new THREE.Vector2(0.0034, 0.0031), new THREE.Vector2(0.0056, 0.0021), new THREE.Vector2(0.0068, 0.0006), new THREE.Vector2(0.0069, -0.0004),
  ], 14);
  boltMat ??= hardware(0x2c2d30, 0.85, 0.32);
  return { geo: boltGeo, mat: boltMat };
}

/**
 * Bolts round the edges of each panel of a hollow shell: how plate is held
 * together on a real robot. Bolts sit ~ 1½ plate thicknesses in from the
 * edge, about every 100 mm. Faces pointing at the floor are skipped.
 */
function panelBolts(faces: Face[], wallMm: number, toBody: THREE.Quaternion): THREE.InstancedMesh | null {
  const edge = Math.max(0.012, (wallMm / 1000) * 1.5 + 0.006);
  const spacing = 0.1;
  const spots: Array<{ p: THREE.Vector3; n: THREE.Vector3 }> = [];
  for (const f of faces) {
    if (f.normal.clone().applyQuaternion(toBody).y < -0.4) continue;
    if (inradius(f) < edge * 1.6) continue;
    const q = insetFace(f, edge);
    for (let i = 0; i < q.length; i++) {
      const a = q[i], b = q[(i + 1) % q.length];
      const len = a.distanceTo(b);
      const count = Math.max(1, Math.round(len / spacing));
      for (let k = 0; k < count; k++) spots.push({ p: a.clone().lerp(b, k / count), n: f.normal });
    }
  }
  if (!spots.length) return null;
  const { geo, mat } = bolt();
  const im = new THREE.InstancedMesh(geo, mat, spots.length);
  const m = new THREE.Matrix4(), qn = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  spots.forEach((s, i) => im.setMatrixAt(i, m.compose(s.p, qn.setFromUnitVectors(up, s.n), one)));
  im.receiveShadow = true;
  return im;
}

// ---------------------------------------------------------------- name decal

/** The robot's name painted on the chassis' top deck, readable from behind. */
function nameDecal(faces: Face[], name: string, paint: number, toBody: THREE.Quaternion): THREE.Mesh | null {
  const top = faces.map((f) => ({ f, y: f.normal.clone().applyQuaternion(toBody).y })).sort((a, b) => b.y - a.y)[0];
  if (!top || top.y < 0.6) return null;
  const f = top.f;
  // Text runs right-to-left along the robot's X (so it reads left-to-right from above, front at the top).
  const inv = toBody.clone().invert();
  const n = f.normal;
  const u = new THREE.Vector3(-1, 0, 0).applyQuaternion(inv);
  u.addScaledVector(n, -u.dot(n)).normalize();
  const v = new THREE.Vector3().crossVectors(n, u);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of insetFace(f, 0.03)) {
    const d = p.clone().sub(f.centroid);
    u0 = Math.min(u0, d.dot(u)); u1 = Math.max(u1, d.dot(u)); v0 = Math.min(v0, d.dot(v)); v1 = Math.max(v1, d.dot(v));
  }
  const aspect = 4;
  const w = Math.min((u1 - u0) * 0.9, (v1 - v0) * 0.9 * aspect);
  if (w < 0.08) return null;
  const lum = new THREE.Color(paint);
  const dark = lum.r * 0.3 + lum.g * 0.59 + lum.b * 0.11 > 0.5;
  const mat = hardware(0xffffff, 0, 0.45);
  mat.map = textTexture(name.toUpperCase(), { colour: dark ? '#141414' : '#f2f2ee' });
  mat.transparent = true;
  mat.depthWrite = false;
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / aspect), mat);
  m.position.copy(f.centroid).addScaledVector(u, (u0 + u1) / 2).addScaledVector(v, (v0 + v1) / 2).addScaledVector(n, 0.0006);
  m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, n));
  return m;
}

// ---------------------------------------------------------------- structure

function structureGeometry(s: Shape, chamfer: number): { geo: THREE.BufferGeometry; faces: Face[] | null } {
  const pts = convexPointsOf(s);
  if (pts) {
    const faces = convexFaces(pts);
    return { geo: chamferedConvex(faces, chamfer), faces };
  }
  switch (s.type) {
    case 'cylinder': {
      // Lathe with chamfered rims (discs, rollers, drums).
      const r = s.radius, h = s.length / 2, c = Math.min(chamfer, r * 0.2, h * 0.45);
      return { geo: planarUV(new THREE.LatheGeometry([new THREE.Vector2(0, -h), new THREE.Vector2(r - c, -h), new THREE.Vector2(r, -h + c), new THREE.Vector2(r, h - c), new THREE.Vector2(r - c, h), new THREE.Vector2(0, h)], 48)), faces: null };
    }
    // Curved shapes: real-world-scale texture projection rather than 0…1 UVs.
    case 'cone': return { geo: planarUV(new THREE.ConeGeometry(s.radius, s.length, 40)), faces: null };
    case 'capsule': return { geo: planarUV(new THREE.CapsuleGeometry(s.radius, s.length, 8, 24)), faces: null };
    case 'sphere': return { geo: planarUV(new THREE.SphereGeometry(s.radius, 40, 26)), faces: null };
    case 'lathe': return { geo: planarUV(new THREE.LatheGeometry(s.profile.map(([r, y]) => new THREE.Vector2(Math.abs(r), y)), Math.max(8, s.segments ?? 40))), faces: null };
    case 'mesh': {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(s.vertices, 3));
      g.setIndex(s.indices);
      g.computeVertexNormals();
      const uv = planarUV(g.clone());
      g.setAttribute('uv', uv.attributes.uv.count === g.attributes.position.count ? uv.attributes.uv : new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      return { geo: g, faces: null };
    }
    case 'extrude': {
      const c = Math.min(chamfer, s.depth * 0.3);
      const outline = new THREE.Shape(s.outline.map(([u, v]) => new THREE.Vector2(u, v)));
      const depth = Math.max(0.0005, s.depth - 2 * c);
      const g = new THREE.ExtrudeGeometry(outline, { depth, bevelEnabled: c > 0.0003, bevelThickness: c, bevelSize: c, bevelOffset: -c, bevelSegments: 1 });
      g.translate(0, 0, -depth / 2);
      const map = planeMap(s.plane);
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const [x, y, z] = map(pos.getX(i), pos.getY(i), pos.getZ(i));
        pos.setXYZ(i, x, y, z);
      }
      if (s.plane !== 'front') {
        // 'side' and 'top' mappings mirror the winding; flip faces back.
        const idx = g.index;
        if (idx) for (let i = 0; i < idx.count; i += 3) { const a = idx.getX(i); idx.setX(i, idx.getX(i + 2)); idx.setX(i + 2, a); }
        else for (let i = 0; i < pos.count; i += 3) {
          const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i);
          pos.setXYZ(i, pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
          pos.setXYZ(i + 2, ax, ay, az);
        }
      }
      g.deleteAttribute('normal');
      return { geo: planarUV(g), faces: null };
    }
    default: return { geo: new THREE.BoxGeometry(0.1, 0.1, 0.1), faces: null };
  }
}

function minExtent(s: Shape): number {
  const pts = convexPointsOf(s);
  if (pts) {
    const b = new THREE.Box3().setFromPoints(pts);
    const d = b.getSize(new THREE.Vector3());
    return Math.min(d.x, d.y, d.z);
  }
  if (s.type === 'cylinder') return Math.min(s.radius * 2, s.length);
  if (s.type === 'extrude') return s.depth;
  return 0.05;
}

function isPainted(part: Part): boolean {
  const def = part.def!;
  if (def.colour) return true;
  try { return part.colour !== lookupMaterial(def.material ?? 'aluminium').colour; } catch { return true; }
}

function buildStructure(part: Part, robotName: string | null): PartMesh {
  const def = part.def!, v = part.visual!, s = v.shape;
  const toBody = new THREE.Quaternion(v.rot.x, v.rot.y, v.rot.z, v.rot.w);
  const wall = def.wall;
  // Cut plate is deburred to a millimetre or two; thick solid parts get a bigger chamfer.
  const chamfer = wall ? THREE.MathUtils.clamp((wall / 1000) * 0.45, 0.0012, 0.004) : THREE.MathUtils.clamp(minExtent(s) * 0.18, 0.0005, 0.005);
  const { geo, faces } = structureGeometry(s, chamfer);
  const paint = isPainted(part) ? part.colour ?? 0x888888 : null;
  const mat = partMaterial(def.material, paint);
  if (s.type === 'mesh') mat.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = !mat.transparent;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  const mats = [mat];
  if (faces && wall) {
    const bolts = panelBolts(faces, wall, toBody);
    if (bolts) group.add(bolts);
  }
  if (faces && robotName && def.parent === null && !mat.transparent) {
    const decal = nameDecal(faces, robotName, paint ?? 0x888888, toBody);
    if (decal) { group.add(decal); mats.push(decal.material as THREE.MeshPhysicalMaterial); }
  }
  return { mesh: group, mats };
}

// ---------------------------------------------------------------- wheels

type TreadKind = 'knobbly' | 'smooth' | 'foam';
const treadCache = new Map<TreadKind, THREE.DataTexture>();

/**
 * Bump map for a tyre, laid out on the lathe's UVs: u goes round the wheel,
 * v round the tyre's cross-section (tread centre at v = 0.25).
 */
function treadTexture(kind: TreadKind): THREE.DataTexture {
  const hit = treadCache.get(kind);
  if (hit) return hit;
  const W = 1024, H = 256;
  const data = new Uint8Array(W * H * 4);
  let seed = 99;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const v = j / H, u = i / W;
    const across = (v - 0.25) / 0.13; // −1…1 across the tread face
    let h = 0.5;
    if (kind === 'knobbly' && Math.abs(across) < 1.05) {
      // Staggered tread blocks with a centre rib, like a sack-truck tyre.
      const blocks = 30;
      const side = across < 0 ? 0 : 0.5;
      const t = (u * blocks + side + across * 0.35) % 1;
      const inBlock = t > 0.18 && t < 0.82 && Math.abs(across) > 0.12;
      const rib = Math.abs(across) < 0.07;
      h = inBlock || rib ? 0.85 : 0.2;
    } else if (kind === 'smooth' && Math.abs(across) < 1) {
      h = 0.55 + (Math.abs(across) % 0.33 < 0.04 ? -0.25 : 0);
    } else if (kind === 'foam') {
      h = 0.45 + rnd() * 0.15;
    }
    // Sidewall: a moulded ring of lettering-ish bumps.
    const side = Math.abs(v - 0.5) < 0.04 || Math.abs(v - 0.0) < 0.04 || Math.abs(v - 1) < 0.04;
    if (kind !== 'foam' && side && ((u * 160) | 0) % 3 === 0) h = 0.62;
    const b = Math.round(h * 255);
    data.set([b, b, b, 255], (j * W + i) * 4);
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  treadCache.set(kind, t);
  return t;
}

/** Tyre cross-section: a rounded rectangle (superellipse) revolved about Y. */
function tyreGeometry(R: number, rimR: number, W: number, squareness: number): THREE.LatheGeometry {
  const a = (R - rimR) / 2, b = W / 2, rc = (R + rimR) / 2, p = squareness;
  const pts: THREE.Vector2[] = [];
  const N = 64;
  for (let i = 0; i <= N; i++) {
    const th = -Math.PI / 2 + (i / N) * Math.PI * 2;
    const c = Math.cos(th), s = Math.sin(th);
    pts.push(new THREE.Vector2(rc + a * Math.sign(c) * Math.abs(c) ** (2 / p), b * Math.sign(s) * Math.abs(s) ** (2 / p)));
  }
  return new THREE.LatheGeometry(pts, 72);
}

function wheelStyle(spec: WheelSpec): { tread: TreadKind; rimFrac: number; rim: number; rimMetal: number; spokes: number; squareness: number } {
  const id = spec.id;
  if (id.startsWith('pneu')) return { tread: 'knobbly', rimFrac: 0.5, rim: 0xb0241c, rimMetal: 0.3, spokes: 5, squareness: 3 };
  if (id.startsWith('foam')) return { tread: 'foam', rimFrac: 0.42, rim: 0xe2a91a, rimMetal: 0, spokes: 6, squareness: 5 };
  if (id.startsWith('solid')) return { tread: 'smooth', rimFrac: 0.56, rim: 0x80858c, rimMetal: 0.9, spokes: 4, squareness: 6 };
  return { tread: 'smooth', rimFrac: 0.5, rim: 0x80858c, rimMetal: 0.9, spokes: 5, squareness: 4 };
}

/** A real wheel: tyre with tread, spoked rim, hub and axle nuts. Axle along Y. */
export function buildWheel(spec: WheelSpec, rimColour?: number): PartMesh {
  const st = wheelStyle(spec);
  const R = spec.radius, W = spec.width, rimR = R * st.rimFrac;
  const group = new THREE.Group();
  const tyreMat = hardware(st.tread === 'foam' ? 0x2a2a2a : 0x161616, 0, 0.9);
  tyreMat.bumpMap = treadTexture(st.tread);
  tyreMat.bumpScale = st.tread === 'knobbly' ? 2.2 : 0.6;
  tyreMat.roughnessMap = null;
  const tyre = new THREE.Mesh(tyreGeometry(R, rimR * 0.98, W, st.squareness), tyreMat);
  tyre.castShadow = tyre.receiveShadow = true;
  group.add(tyre);

  const rimMat = hardware(rimColour ?? st.rim, st.rimMetal, st.rimMetal > 0.5 ? 0.35 : 0.45, { clearcoat: st.rimMetal > 0.5 ? 0 : 0.4 });
  rimMat.side = THREE.DoubleSide;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR, W * 0.78, 40, 1, true), rimMat);
  group.add(barrel);

  // Rim face: a disc with lightening holes, so you can see the wheel turn.
  const hubR = Math.max(0.014, R * 0.17);
  const disc = new THREE.Shape();
  disc.absarc(0, 0, rimR * 1.0, 0, Math.PI * 2, false);
  const mid = (hubR + rimR) / 2, holeR = (rimR - hubR) * 0.3;
  for (let i = 0; i < st.spokes; i++) {
    const a = (i / st.spokes) * Math.PI * 2;
    const hole = new THREE.Path();
    hole.absarc(Math.cos(a) * mid, Math.sin(a) * mid, holeR, 0, Math.PI * 2, true);
    disc.holes.push(hole);
  }
  const plate = 0.004;
  const discGeo = new THREE.ExtrudeGeometry(disc, { depth: plate, bevelEnabled: true, bevelThickness: 0.0012, bevelSize: 0.0012, bevelSegments: 1, curveSegments: 32 });
  discGeo.translate(0, 0, -plate / 2);
  discGeo.rotateX(Math.PI / 2);
  const discMesh = new THREE.Mesh(planarUV(discGeo), rimMat);
  discMesh.castShadow = true;
  group.add(discMesh);

  const hubMat = hardware(0xa8adb3, 1, 0.3, { rough: 'brushed' });
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR, W * 0.92, 28), hubMat);
  group.add(hub);
  // Axle nut and wheel bolts on both faces.
  const nutMat = hardware(0x3a3c40, 0.9, 0.35);
  const nutGeo = new THREE.CylinderGeometry(hubR * 0.55, hubR * 0.55, 0.012, 6);
  const studGeo = new THREE.CylinderGeometry(hubR * 0.14, hubR * 0.14, 0.008, 6);
  for (const sgn of [-1, 1]) {
    const nut = new THREE.Mesh(nutGeo, nutMat);
    nut.position.y = sgn * (W * 0.46 + 0.006);
    group.add(nut);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const stud = new THREE.Mesh(studGeo, nutMat);
      stud.position.set(Math.cos(a) * hubR * 0.72, sgn * (W * 0.46 + 0.004), Math.sin(a) * hubR * 0.72);
      group.add(stud);
    }
  }
  return { mesh: group, mats: [tyreMat, rimMat, hubMat] };
}

// ---------------------------------------------------------------- internals

function boxFaces(size: readonly number[]): Face[] {
  return convexFaces(convexPointsOf({ type: 'box', size: [size[0], size[1], size[2]] })!);
}

function labelPlane(text: string, sub: string | undefined, w: number, h: number, colour: string, background: string): THREE.Mesh {
  const mat = hardware(0xffffff, 0, 0.5);
  mat.map = textTexture(text, { colour, background, sub, width: 512, height: Math.round(512 * (h / w)) });
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -4;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
}

function buildBattery(def: PartDef, size: number[]): PartMesh {
  const c = def.component as { type: 'battery'; part: string };
  let chem: 'SLA' | 'NiCd' | 'LiPo' = 'NiCd', volts = 24, ah = 0;
  try { const b = lookup(BATTERIES, c.part, 'battery'); chem = b.chemistry; volts = b.voltage; ah = b.capacity / b.voltage; } catch { /* custom: defaults */ }
  const group = new THREE.Group();
  const mats: THREE.MeshPhysicalMaterial[] = [];
  const caseMat = chem === 'SLA' ? hardware(0x1c1c1e, 0, 0.55) : chem === 'LiPo' ? hardware(0x2b2d31, 0.2, 0.35, { clearcoat: 0.5 }) : hardware(0x1f56b0, 0, 0.3, { clearcoat: 0.7 });
  mats.push(caseMat);
  const body = new THREE.Mesh(chamferedConvex(boxFaces(size), chem === 'SLA' ? 0.003 : 0.008), caseMat);
  body.castShadow = body.receiveShadow = true;
  group.add(body);
  const [sx, sy, sz] = size;
  const label = labelPlane(`${volts}V ${chem}`, ah ? `${ah.toFixed(ah < 10 ? 1 : 0)}Ah` : undefined, sx * 0.7, Math.min(sz * 0.5, sx * 0.3),
    chem === 'LiPo' ? '#111' : '#f4f4f4', chem === 'LiPo' ? '#f2c200' : chem === 'SLA' ? '#2a2a2c' : '#1f56b0');
  label.rotation.x = -Math.PI / 2;
  label.position.y = sy / 2 + 0.0005;
  group.add(label);
  mats.push(label.material as THREE.MeshPhysicalMaterial);
  // Terminals and leads out of the back.
  const red = hardware(0xc81e1e, 0, 0.4), black = hardware(0x111111, 0, 0.5);
  for (const [x, m] of [[sx * 0.2, red], [-sx * 0.2, black]] as const) {
    const term = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.014, 12), m);
    term.position.set(x, sy / 2 + 0.007, -sz * 0.32);
    group.add(term);
    const lead = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, sz * 0.4, 8), m);
    lead.rotation.x = Math.PI / 2;
    lead.position.set(x * 0.6, sy / 2 + 0.012, -sz * 0.5);
    group.add(lead);
  }
  const plug = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.016, 0.024), hardware(0xb81d1d, 0, 0.45));
  plug.position.set(0, sy / 2 + 0.012, -sz * 0.72);
  group.add(plug);
  return { mesh: group, mats };
}

function buildGasBottle(size: number[]): PartMesh {
  // Lies along X (the longest side of the component envelope).
  const L = size[0], r = Math.min(size[1], size[2]) / 2 * 0.95;
  const h = L / 2 - 0.03;
  const prof = [
    [0, -h], [r * 0.55, -h + 0.002], [r * 0.9, -h + r * 0.25], [r, -h + r * 0.6], [r, h - r * 0.9], [r * 0.85, h - r * 0.35],
    [r * 0.5, h - r * 0.05], [r * 0.3, h], [0, h],
  ].map(([a, b]) => new THREE.Vector2(a, b));
  const bodyMat = hardware(0x18191b, 0, 0.35, { clearcoat: 0.6 });
  const shoulderMat = hardware(0x8e949a, 0, 0.4, { clearcoat: 0.5 });
  const group = new THREE.Group();
  const bottle = new THREE.Mesh(new THREE.LatheGeometry(prof, 32), bodyMat);
  bottle.castShadow = bottle.receiveShadow = true;
  const shoulder = new THREE.Mesh(new THREE.LatheGeometry(prof.filter((p) => p.y > h - r * 1.2), 32), shoulderMat);
  shoulder.scale.setScalar(1.004);
  const brass = hardware(0xb48a32, 1, 0.3);
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.32, r * 0.32, 0.035, 12), brass);
  valve.position.y = h + 0.017;
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(r * 0.38, 0.003, 6, 16), hardware(0x202020, 0.5, 0.5));
  wheel.rotation.x = Math.PI / 2;
  wheel.position.y = h + 0.036;
  const reg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 12), brass);
  reg.rotation.z = Math.PI / 2;
  reg.position.set(r * 0.4, h + 0.02, 0);
  const inner = new THREE.Group();
  inner.add(bottle, shoulder, valve, wheel, reg);
  inner.rotation.z = -Math.PI / 2; // neck towards +X
  group.add(inner);
  return { mesh: group, mats: [bodyMat, shoulderMat, brass] };
}

function buildBallast(size: number[]): PartMesh {
  const mat = hardware(0x5d6166, 0.55, 0.75);
  const m = new THREE.Mesh(chamferedConvex(boxFaces(size), 0.004), mat);
  m.castShadow = m.receiveShadow = true;
  const g = new THREE.Group();
  g.add(m);
  return { mesh: g, mats: [mat] };
}

function buildFlamethrower(size: number[]): PartMesh {
  const [sx, sy, sz] = size;
  const r = Math.min(sx, sy) / 2 * 0.9;
  const tankMat = hardware(0xb3261e, 0, 0.35, { clearcoat: 0.6 });
  const brass = hardware(0xb48a32, 1, 0.3);
  const steel = hardware(0x9a9fa5, 1, 0.35, { rough: 'brushed' });
  const g = new THREE.Group();
  const tank = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, sz - 2 * r), 6, 20), tankMat);
  tank.rotation.x = Math.PI / 2;
  tank.castShadow = true;
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, sz * 0.7, 8), steel);
  pipe.rotation.x = Math.PI / 2;
  pipe.position.set(0, r + 0.01, sz * 0.3);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.014, 0.05, 12), brass);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.set(0, r + 0.01, sz * 0.65 + 0.025);
  g.add(tank, pipe, nozzle);
  return { mesh: g, mats: [tankMat, brass, steel] };
}

// ---------------------------------------------------------------- entry point

/** Build what the camera sees for one part. `robotName` paints the name on the chassis. */
export function buildPartMesh(part: Part, robotName: string | null): PartMesh {
  const def = part.def;
  const shape = part.visual!.shape;
  if (part.kind === 'wheel' && def?.wheel && shape.type === 'cylinder') {
    let spec: WheelSpec;
    try { spec = lookup(WHEELS, def.wheel, 'wheel'); } catch { spec = { id: 'custom', name: '', mass: 1, cost: 0, sourcing: 'common', swapMinutes: 5, radius: shape.radius, width: shape.length, grip: 0.9 }; }
    // A catalogue spec might differ from the collider if customised; draw the collider's size.
    return buildWheel({ ...spec, radius: shape.radius, width: shape.length }, def.colour ? parseInt(def.colour.slice(1), 16) : undefined);
  }
  if (part.kind === 'component' && def?.component && shape.type === 'box') {
    const size = [...shape.size];
    switch (def.component.type) {
      case 'battery': return buildBattery(def, size);
      case 'gasTank': return buildGasBottle(size);
      case 'flamethrower': return buildFlamethrower(size);
      default: return buildBallast(size);
    }
  }
  if (def) return buildStructure(part, robotName);
  const mat = hardware(part.colour ?? 0x888888, 0.5, 0.5);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(structureGeometry(shape, 0.002).geo, mat));
  return { mesh: g, mats: [mat] };
}
