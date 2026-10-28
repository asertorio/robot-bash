import type { Shape, Vec3 } from './design';
import type { V3 } from './vmath';

/**
 * Shape maths. The physics engine only collides convex pieces, so every
 * shape is broken into convex pieces here:
 *
 * - primitives (box, cylinder, cone, sphere, capsule) are one piece each;
 * - wedges and hulls are one convex hull;
 * - extrusions of any 2D outline (concave too) are split into convex prisms;
 * - lathes (solids of revolution) become a stack of frustums;
 * - imported meshes are voxelised into a compound of boxes.
 *
 * Mass, volume, area and inertia are computed from the same pieces, so what
 * you see, what collides and what it weighs all agree.
 */

export type Piece =
  | { kind: 'prim'; shape: Extract<Shape, { type: 'box' | 'cylinder' | 'cone' | 'sphere' | 'capsule' }> }
  | { kind: 'hull'; points: Vec3[] }
  | { kind: 'box'; centre: Vec3; half: Vec3 };

const cache = new Map<string, Piece[]>();

export function convexPieces(s: Shape): Piece[] {
  if (s.type === 'box' || s.type === 'cylinder' || s.type === 'cone' || s.type === 'sphere' || s.type === 'capsule') return [{ kind: 'prim', shape: s }];
  if (s.type === 'wedge') return [{ kind: 'hull', points: wedgePoints(s.size, s.lip) }];
  if (s.type === 'hull') return [{ kind: 'hull', points: s.points }];
  const key = JSON.stringify(s);
  let hit = cache.get(key);
  if (!hit) {
    hit = s.type === 'extrude' ? extrudePieces(s) : s.type === 'lathe' ? lathePieces(s) : meshPieces(s);
    if (cache.size > 200) cache.clear();
    cache.set(key, hit);
  }
  return hit;
}

export function wedgePoints(size: Vec3, lipH: number): Vec3[] {
  const [w, h, l] = size;
  const x = w / 2, y = h / 2, z = l / 2;
  const lip = Math.min(lipH, h);
  const out: Vec3[] = [[-x, -y, -z], [x, -y, -z], [-x, y, -z], [x, y, -z], [-x, -y, z], [x, -y, z]];
  if (lip > 0.001) out.push([-x, -y + lip, z], [x, -y + lip, z]);
  return out;
}

// ---------------------------------------------------------------- extrusion

/** Map outline (u, v) and depth coordinate w to the part frame for each drawing plane. */
export function planeMap(plane: 'top' | 'side' | 'front' = 'top'): (u: number, v: number, w: number) => Vec3 {
  if (plane === 'side') return (u, v, w) => [w, v, u]; // drawn side-on: u forward, v up; extruded across
  if (plane === 'front') return (u, v, w) => [u, v, w]; // drawn face-on: u left, v up; extruded front-to-back
  return (u, v, w) => [u, w, v]; // drawn from above: u left, v forward; extruded upward
}

function extrudePieces(s: Extract<Shape, { type: 'extrude' }>): Piece[] {
  const map = planeMap(s.plane);
  const d = s.depth / 2;
  return convexPolygons(s.outline).map((poly) => ({ kind: 'hull', points: poly.flatMap(([u, v]) => [map(u, v, -d), map(u, v, d)]) }) as Piece);
}

const cross2 = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

export function polygonArea(p: Array<[number, number]>): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q[0] * r[1] - r[0] * q[1]; }
  return a / 2;
}

/** Split any simple polygon into convex pieces (ear clipping, then Hertel–Mehlhorn merging). */
export function convexPolygons(outline: Array<[number, number]>): Array<Array<[number, number]>> {
  let pts = outline.filter((p, i) => {
    const q = outline[(i + 1) % outline.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6;
  });
  if (pts.length < 3) return [];
  if (polygonArea(pts) < 0) pts = [...pts].reverse(); // make it counter-clockwise
  // Ear clipping.
  const idx = pts.map((_, i) => i);
  const tris: number[][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
      if (cross2(pts[a], pts[b], pts[c]) <= 1e-12) continue; // reflex or flat
      const inside = idx.some((k) => k !== a && k !== b && k !== c && inTri(pts[k], pts[a], pts[b], pts[c]));
      if (inside) continue;
      tris.push([a, b, c]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // self-intersecting outline: give up on the rest
  }
  if (idx.length === 3 && cross2(pts[idx[0]], pts[idx[1]], pts[idx[2]]) > 1e-12) tris.push([...idx]);
  // Merge neighbouring pieces while the result stays convex.
  let polys = tris.map((t) => [...t]);
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < polys.length; i++) {
      for (let j = i + 1; j < polys.length; j++) {
        const m = mergeIfConvex(polys[i], polys[j], pts);
        if (m) { polys[i] = m; polys.splice(j, 1); merged = true; break outer; }
      }
    }
  }
  return polys.map((poly) => poly.map((k) => pts[k]));
}

function inTri(p: number[], a: number[], b: number[], c: number[]): boolean {
  return cross2(a, b, p) >= -1e-12 && cross2(b, c, p) >= -1e-12 && cross2(c, a, p) >= -1e-12;
}

function mergeIfConvex(p: number[], q: number[], pts: Array<[number, number]>): number[] | null {
  // Find a shared edge (a→b in p, b→a in q).
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const j = q.findIndex((v, k) => v === b && q[(k + 1) % q.length] === a);
    if (j < 0) continue;
    const out: number[] = [];
    for (let k = 0; k < p.length; k++) { out.push(p[(i + 1 + k) % p.length]); }
    // out starts at b and ends at a; add q's other vertices from after a back to before b.
    for (let k = 2; k < q.length; k++) out.push(q[(j + k) % q.length]);
    for (let k = 0; k < out.length; k++) {
      if (cross2(pts[out[k]], pts[out[(k + 1) % out.length]], pts[out[(k + 2) % out.length]]) < -1e-12) return null;
    }
    return out;
  }
  return null;
}

// ---------------------------------------------------------------- lathe

function lathePieces(s: Extract<Shape, { type: 'lathe' }>): Piece[] {
  const n = Math.max(8, Math.min(48, s.segments ?? 24));
  const out: Piece[] = [];
  for (let i = 0; i < s.profile.length - 1; i++) {
    const [r0, y0] = s.profile[i], [r1, y1] = s.profile[i + 1];
    if (Math.abs(y1 - y0) < 1e-5 || (r0 < 1e-5 && r1 < 1e-5)) continue;
    const points: Vec3[] = [];
    for (let k = 0; k < n; k++) {
      const t = (k / n) * 2 * Math.PI, c = Math.cos(t), si = Math.sin(t);
      points.push([Math.abs(r0) * c, y0, Math.abs(r0) * si], [Math.abs(r1) * c, y1, Math.abs(r1) * si]);
    }
    out.push({ kind: 'hull', points });
  }
  return out;
}

// ---------------------------------------------------------------- imported meshes

/** Voxelise a triangle mesh and merge the voxels into as few boxes as we can. */
function meshPieces(s: Extract<Shape, { type: 'mesh' }>): Piece[] {
  const v = s.vertices, idx = s.indices;
  if (v.length < 9 || idx.length < 3) return [];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v[i + k]); max[k] = Math.max(max[k], v[i + k]); }
  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const vox = s.voxel && s.voxel > 0 ? s.voxel : size / 20;
  const nx = Math.max(1, Math.ceil((max[0] - min[0]) / vox)), ny = Math.max(1, Math.ceil((max[1] - min[1]) / vox)), nz = Math.max(1, Math.ceil((max[2] - min[2]) / vox));
  if (nx * ny * nz > 200000) return [{ kind: 'box', centre: mid(min, max), half: [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2] }];
  const filled = new Uint8Array(nx * ny * nz);
  // One ray along +X per (y, z) column; inside between pairs of crossings.
  for (let iy = 0; iy < ny; iy++) {
    for (let iz = 0; iz < nz; iz++) {
      const y = min[1] + (iy + 0.5) * vox, z = min[2] + (iz + 0.5) * vox;
      const xs: number[] = [];
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
        const x = rayX(y, z, v[a], v[a + 1], v[a + 2], v[b], v[b + 1], v[b + 2], v[c], v[c + 1], v[c + 2]);
        if (x !== null) xs.push(x);
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.round((xs[k] - min[0]) / vox)), i1 = Math.min(nx, Math.round((xs[k + 1] - min[0]) / vox));
        for (let ix = i0; ix < i1; ix++) filled[ix + nx * (iy + ny * iz)] = 1;
      }
    }
  }
  // Greedy box merging: grow along x, then z, then y.
  const at = (x: number, y: number, z: number) => filled[x + nx * (y + ny * z)] === 1;
  const used = new Uint8Array(filled.length);
  const free = (x: number, y: number, z: number) => at(x, y, z) && !used[x + nx * (y + ny * z)];
  const out: Piece[] = [];
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    if (!free(x, y, z)) continue;
    let x1 = x; while (x1 + 1 < nx && free(x1 + 1, y, z)) x1++;
    let z1 = z;
    grow: while (z1 + 1 < nz) { for (let i = x; i <= x1; i++) if (!free(i, y, z1 + 1)) break grow; z1++; }
    let y1 = y;
    growY: while (y1 + 1 < ny) { for (let k = z; k <= z1; k++) for (let i = x; i <= x1; i++) if (!free(i, y1 + 1, k)) break growY; y1++; }
    for (let k = z; k <= z1; k++) for (let j = y; j <= y1; j++) for (let i = x; i <= x1; i++) used[i + nx * (j + ny * k)] = 1;
    const lo = [min[0] + x * vox, min[1] + y * vox, min[2] + z * vox], hi = [min[0] + (x1 + 1) * vox, min[1] + (y1 + 1) * vox, min[2] + (z1 + 1) * vox];
    out.push({ kind: 'box', centre: mid(lo, hi), half: [(hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2] });
  }
  return out.length ? out : [{ kind: 'box', centre: mid(min, max), half: [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2] }];
}

const mid = (a: number[], b: number[]): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/** Where a ray along +X at (y, z) crosses a triangle, if it does. */
function rayX(y: number, z: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): number | null {
  // Barycentric test in the YZ plane, then interpolate x.
  const d = (by - ay) * (cz - az) - (cy - ay) * (bz - az);
  if (Math.abs(d) < 1e-14) return null;
  const u = ((y - ay) * (cz - az) - (cy - ay) * (z - az)) / d;
  const w = ((by - ay) * (z - az) - (y - ay) * (bz - az)) / d;
  if (u < 0 || w < 0 || u + w > 1) return null;
  return ax + u * (bx - ax) + w * (cx - ax);
}

// ---------------------------------------------------------------- measures

/** Every corner point of the pieces (or a sampled rim for round primitives). */
export function shapeSamplePoints(s: Shape): Vec3[] {
  const out: Vec3[] = [];
  for (const p of convexPieces(s)) {
    if (p.kind === 'hull') out.push(...p.points);
    else if (p.kind === 'box') {
      for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) out.push([p.centre[0] + a * p.half[0], p.centre[1] + b * p.half[1], p.centre[2] + c * p.half[2]]);
    } else {
      const q = p.shape;
      if (q.type === 'box') { for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) out.push([a * q.size[0] / 2, b * q.size[1] / 2, c * q.size[2] / 2]); continue; }
      if (q.type === 'sphere') {
        for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) for (const c of [-1, 0, 1]) {
          const l = Math.hypot(a, b, c);
          if (l > 0) out.push([(a / l) * q.radius, (b / l) * q.radius, (c / l) * q.radius]);
        }
        continue;
      }
      const top = q.type === 'capsule' ? q.length / 2 + q.radius : q.length / 2;
      for (let i = 0; i < 16; i++) {
        const t = (i / 16) * 2 * Math.PI;
        out.push([Math.cos(t) * q.radius, -top, Math.sin(t) * q.radius]);
        out.push([q.type === 'cone' ? 0 : Math.cos(t) * q.radius, top, q.type === 'cone' ? 0 : Math.sin(t) * q.radius]);
      }
    }
  }
  return out;
}

/** Half-extents of the bounding box about the shape origin. */
export function shapeHalf(s: Shape): V3 {
  const m = [0, 0, 0];
  for (const p of shapeSamplePoints(s)) for (let i = 0; i < 3; i++) m[i] = Math.max(m[i], Math.abs(p[i]));
  return { x: m[0], y: m[1], z: m[2] };
}

export function shapeVolume(s: Shape): number {
  switch (s.type) {
    case 'box': return s.size[0] * s.size[1] * s.size[2];
    case 'wedge': return s.size[0] * s.size[2] * (s.size[1] + Math.min(s.lip, s.size[1])) / 2;
    case 'cylinder': return Math.PI * s.radius ** 2 * s.length;
    case 'cone': return (Math.PI * s.radius ** 2 * s.length) / 3;
    case 'sphere': return (4 / 3) * Math.PI * s.radius ** 3;
    case 'capsule': return Math.PI * s.radius ** 2 * s.length + (4 / 3) * Math.PI * s.radius ** 3;
    case 'extrude': return Math.abs(polygonArea(s.outline)) * s.depth;
    case 'lathe': {
      let v = 0;
      for (let i = 0; i < s.profile.length - 1; i++) {
        const [r0, y0] = s.profile[i], [r1, y1] = s.profile[i + 1];
        v += (Math.PI * Math.abs(y1 - y0) * (r0 * r0 + r0 * r1 + r1 * r1)) / 3;
      }
      return v;
    }
    case 'mesh': {
      // Closed meshes: divergence theorem. Open ones fall back to the voxel boxes.
      let v = 0;
      const t = s.vertices, ix = s.indices;
      for (let i = 0; i < ix.length; i += 3) {
        const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
        v += (t[a] * (t[b + 1] * t[c + 2] - t[b + 2] * t[c + 1]) - t[a + 1] * (t[b] * t[c + 2] - t[b + 2] * t[c]) + t[a + 2] * (t[b] * t[c + 1] - t[b + 1] * t[c])) / 6;
      }
      if (Math.abs(v) > 1e-9) return Math.abs(v);
      return convexPieces(s).reduce((sum, p) => sum + (p.kind === 'box' ? 8 * p.half[0] * p.half[1] * p.half[2] : 0), 0);
    }
    case 'hull': { const h = shapeHalf(s); return 8 * h.x * h.y * h.z * 0.6; }
  }
}

export function shapeArea(s: Shape): number {
  switch (s.type) {
    case 'box': { const [w, h, l] = s.size; return 2 * (w * h + w * l + h * l); }
    case 'wedge': {
      const [w, h, l] = s.size, lip = Math.min(s.lip, h);
      return w * l + w * h + w * Math.hypot(l, h - lip) + l * (h + lip) + w * lip;
    }
    case 'cylinder': return 2 * Math.PI * s.radius * (s.radius + s.length);
    case 'cone': return Math.PI * s.radius * (s.radius + Math.hypot(s.radius, s.length));
    case 'sphere': return 4 * Math.PI * s.radius ** 2;
    case 'capsule': return 2 * Math.PI * s.radius * s.length + 4 * Math.PI * s.radius ** 2;
    case 'extrude': {
      let perim = 0;
      s.outline.forEach((p, i) => { const q = s.outline[(i + 1) % s.outline.length]; perim += Math.hypot(p[0] - q[0], p[1] - q[1]); });
      return 2 * Math.abs(polygonArea(s.outline)) + perim * s.depth;
    }
    case 'lathe': {
      let a = 0;
      const p = s.profile;
      for (let i = 0; i < p.length - 1; i++) a += Math.PI * (p[i][0] + p[i + 1][0]) * Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
      // Flat ends where the profile doesn't close on the axis.
      return a + Math.PI * p[0][0] ** 2 + Math.PI * p[p.length - 1][0] ** 2;
    }
    case 'mesh': {
      let a = 0;
      const t = s.vertices, ix = s.indices;
      for (let i = 0; i < ix.length; i += 3) {
        const p = ix[i] * 3, q = ix[i + 1] * 3, r = ix[i + 2] * 3;
        const ux = t[q] - t[p], uy = t[q + 1] - t[p + 1], uz = t[q + 2] - t[p + 2];
        const vx = t[r] - t[p], vy = t[r + 1] - t[p + 1], vz = t[r + 2] - t[p + 2];
        a += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      }
      return a;
    }
    case 'hull': { const h = shapeHalf(s); return 8 * (h.x * h.y + h.x * h.z + h.y * h.z) * 0.8; }
  }
}

/** Largest face area, m² (how widely a hit spreads). */
export function faceArea(s: Shape): number {
  const h = shapeHalf(s);
  return 4 * Math.max(h.x * h.y, h.x * h.z, h.y * h.z);
}

/** Smallest dimension, mm (how thick a solid part is). */
export function solidThickness(s: Shape): number {
  if (s.type === 'extrude') return Math.min(60, s.depth * 1000);
  const h = shapeHalf(s);
  return Math.min(60, 2000 * Math.min(h.x, h.y, h.z));
}

/** Principal moments about the shape origin (approximate for freeform shapes). Hollow parts carry mass further out. */
export function shapeInertia(s: Shape, mass: number, hollow: boolean): V3 {
  const k = hollow ? 1.6 : 1;
  switch (s.type) {
    case 'cylinder': case 'capsule': {
      const r = s.radius, h = s.type === 'capsule' ? s.length + 1.3 * r : s.length;
      return scale({ x: (mass * (3 * r * r + h * h)) / 12, y: 0.5 * mass * r * r, z: (mass * (3 * r * r + h * h)) / 12 }, k);
    }
    case 'cone': {
      const r = s.radius, h = s.length;
      return scale({ x: mass * (0.15 * r * r + 0.0375 * h * h), y: 0.3 * mass * r * r, z: mass * (0.15 * r * r + 0.0375 * h * h) }, k);
    }
    case 'sphere': return scale({ x: 0.4 * mass * s.radius ** 2, y: 0.4 * mass * s.radius ** 2, z: 0.4 * mass * s.radius ** 2 }, k);
    case 'box': case 'wedge': case 'hull': {
      const h = shapeHalf(s), x = 2 * h.x, y = 2 * h.y, z = 2 * h.z;
      return scale({ x: (mass * (y * y + z * z)) / 12, y: (mass * (x * x + z * z)) / 12, z: (mass * (x * x + y * y)) / 12 }, k);
    }
    default: {
      // Freeform: spread the mass evenly over the piece corner points.
      const pts = shapeSamplePoints(s);
      const m = mass / Math.max(1, pts.length);
      const I = { x: 0, y: 0, z: 0 };
      for (const [x, y, z] of pts) { I.x += m * (y * y + z * z); I.y += m * (x * x + z * z); I.z += m * (x * x + y * y); }
      // Corner points sit on the outside; solid parts have mass further in.
      return scale(I, hollow ? 1 : 0.6);
    }
  }
}

const scale = (v: V3, k: number): V3 => ({ x: v.x * k, y: v.y * k, z: v.z * k });
