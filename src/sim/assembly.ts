import { material } from '../data/materials';
import { BATTERIES, MOTORS, RAMS, TANKS, VALVES, WHEELS, lookup } from '../data/parts';
import type { ActuatorDef, PartDef, RobotDesign, Shape, Vec3 } from './design';
import { qaxis, qmul, qrotate, vadd, vcross, vdot, vlen, vscale, vsub, type Q, type V3 } from './vmath';

/**
 * Geometry, mass and inertia for v2 part trees. Pure functions shared by the
 * physics build, stats, scrutineering and the garage.
 */

export const toV = (a: readonly number[]): V3 => ({ x: a[0], y: a[1], z: a[2] });
const DEG = Math.PI / 180;

/** Euler degrees (X, then Y, then Z, about fixed axes) to a quaternion. */
export function eulerQuat(deg: Vec3): Q {
  const qx = qaxis({ x: 1, y: 0, z: 0 }, deg[0] * DEG);
  const qy = qaxis({ x: 0, y: 1, z: 0 }, deg[1] * DEG);
  const qz = qaxis({ x: 0, y: 0, z: 1 }, deg[2] * DEG);
  return qmul(qz, qmul(qy, qx));
}

/** Shortest rotation taking unit vector a onto unit vector b. */
export function quatFromTo(a: V3, b: V3): Q {
  const d = vdot(a, b);
  if (d > 0.999999) return { x: 0, y: 0, z: 0, w: 1 };
  if (d < -0.999999) {
    const ortho = Math.abs(a.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const axis = vcross(a, ortho);
    return qaxis(vscale(axis, 1 / vlen(axis)), Math.PI);
  }
  const c = vcross(a, b);
  const q = { x: c.x, y: c.y, z: c.z, w: 1 + d };
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

export const unit = (v: Vec3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return { x: v[0] / l, y: v[1] / l, z: v[2] / l };
};

export interface Frame { pos: V3; rot: Q }

export function root(d: RobotDesign): PartDef {
  const r = d.parts.find((p) => p.parent === null);
  if (!r) throw new Error('The design has no chassis (a part with no parent).');
  return r;
}

export function childrenOf(d: RobotDesign, id: string): PartDef[] {
  return d.parts.filter((p) => p.parent === id);
}

/** Problems that stop a part tree being built at all. */
export function treeErrors(d: RobotDesign): string[] {
  const errs: string[] = [];
  const roots = d.parts.filter((p) => p.parent === null);
  if (roots.length !== 1) errs.push(roots.length ? 'Only one part can be the chassis (have no parent).' : 'One part must be the chassis (no parent).');
  const ids = new Set(d.parts.map((p) => p.id));
  if (ids.size !== d.parts.length) errs.push('Two parts share an id.');
  for (const p of d.parts) {
    if (p.parent !== null && !ids.has(p.parent)) errs.push(`${p.label} is attached to a part that doesn't exist.`);
    // Walk up: a cycle never reaches the root.
    let cur: PartDef | undefined = p, steps = 0;
    while (cur && cur.parent !== null && steps++ <= d.parts.length) cur = d.parts.find((q) => q.id === cur!.parent);
    if (steps > d.parts.length) errs.push(`${p.label} is attached in a loop.`);
    if (p.role === 'structure' && !p.shape) errs.push(`${p.label} has no shape.`);
    if (p.role === 'wheel' && !p.wheel) errs.push(`${p.label} has no wheel type.`);
    if (p.role === 'component' && !p.component) errs.push(`${p.label} is an empty component.`);
    if (p.joint.type === 'slider' && p.joint.actuator?.type === 'motor') errs.push(`${p.label}: a DC motor can't drive a slider — use a ram or servo.`);
    if (p.role === 'wheel' && p.joint.type !== 'hinge') errs.push(`${p.label}: wheels need a hinge joint (their axle).`);
  }
  return errs;
}

/** Each part's frame in the robot frame, as built. */
export function partFrames(d: RobotDesign): Map<string, Frame> {
  const out = new Map<string, Frame>();
  const visit = (p: PartDef, parent: Frame | null) => {
    const local = toV(p.position);
    const rot = eulerQuat(p.rotation);
    const f = parent ? { pos: vadd(parent.pos, qrotate(parent.rot, local)), rot: qmul(parent.rot, rot) } : { pos: local, rot };
    out.set(p.id, f);
    for (const c of childrenOf(d, p.id)) if (!out.has(c.id)) visit(c, f);
  };
  visit(root(d), null);
  return out;
}

// ---------------------------------------------------------------- shapes

export interface ResolvedShape {
  shape: Shape;
  /** Shape centre and orientation in the part frame. */
  offset: V3;
  rot: Q;
}

const COMPONENT_DENSITY = 2500;

/** The physical shape of a part (wheels and components get theirs from the catalogue). */
export function resolveShape(p: PartDef): ResolvedShape {
  if (p.role === 'wheel') {
    const w = lookup(WHEELS, p.wheel!, 'wheel');
    const axis = p.joint.type === 'hinge' ? unit(p.joint.axis) : { x: 1, y: 0, z: 0 };
    return { shape: { type: 'cylinder', radius: w.radius, length: w.width }, offset: { x: 0, y: 0, z: 0 }, rot: quatFromTo({ x: 0, y: 1, z: 0 }, axis) };
  }
  if (p.role === 'component') {
    const side = Math.cbrt(partMass(p) / COMPONENT_DENSITY);
    return { shape: { type: 'box', size: [side * 1.4, side * 0.7, side] }, offset: toV(p.shapeOffset ?? [0, 0, 0]), rot: { x: 0, y: 0, z: 0, w: 1 } };
  }
  return { shape: p.shape!, offset: toV(p.shapeOffset ?? [0, 0, 0]), rot: { x: 0, y: 0, z: 0, w: 1 } };
}

/** Corner points for polyhedral shapes (box, wedge, hull). */
export function shapePoints(s: Shape): Vec3[] | null {
  if (s.type === 'hull') return s.points;
  if (s.type !== 'box' && s.type !== 'wedge') return null;
  const [w, h, l] = s.size;
  const x = w / 2, y = h / 2, z = l / 2;
  if (s.type === 'box') {
    const out: Vec3[] = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push([sx * x, sy * y, sz * z]);
    return out;
  }
  const lip = Math.min(s.lip, h);
  const out: Vec3[] = [[-x, -y, -z], [x, -y, -z], [-x, y, -z], [x, y, -z], [-x, -y, z], [x, -y, z]];
  if (lip > 0.001) out.push([-x, -y + lip, z], [x, -y + lip, z]);
  return out;
}

/** Half-extents of the shape's bounding box, in its own frame. */
export function shapeHalf(s: Shape): V3 {
  switch (s.type) {
    case 'box': case 'wedge': return { x: s.size[0] / 2, y: s.size[1] / 2, z: s.size[2] / 2 };
    case 'cylinder': case 'cone': return { x: s.radius, y: s.length / 2, z: s.radius };
    case 'sphere': return { x: s.radius, y: s.radius, z: s.radius };
    case 'capsule': return { x: s.radius, y: s.length / 2 + s.radius, z: s.radius };
    case 'hull': {
      const m = [0, 0, 0];
      for (const p of s.points) for (let i = 0; i < 3; i++) m[i] = Math.max(m[i], Math.abs(p[i]));
      return toV(m);
    }
  }
}

export function shapeVolume(s: Shape): number {
  switch (s.type) {
    case 'box': return s.size[0] * s.size[1] * s.size[2];
    case 'wedge': return s.size[0] * s.size[2] * (s.size[1] + Math.min(s.lip, s.size[1])) / 2;
    case 'cylinder': return Math.PI * s.radius ** 2 * s.length;
    case 'cone': return (Math.PI * s.radius ** 2 * s.length) / 3;
    case 'sphere': return (4 / 3) * Math.PI * s.radius ** 3;
    case 'capsule': return Math.PI * s.radius ** 2 * s.length + (4 / 3) * Math.PI * s.radius ** 3;
    case 'hull': { const hh = shapeHalf(s); return 8 * hh.x * hh.y * hh.z * 0.6; }
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
    case 'hull': { const hh = shapeHalf(s); return 8 * (hh.x * hh.y + hh.x * hh.z + hh.y * hh.z) * 0.8; }
  }
}

/** Largest face area, m² (how widely a hit spreads). */
export function faceArea(s: Shape): number {
  const h = shapeHalf(s);
  return 4 * Math.max(h.x * h.y, h.x * h.z, h.y * h.z);
}

/** Smallest dimension, mm (how thick a solid part is). */
export function solidThickness(s: Shape): number {
  const h = shapeHalf(s);
  return Math.min(60, 2000 * Math.min(h.x, h.y, h.z));
}

// ---------------------------------------------------------------- mass & cost

export function partMass(p: PartDef): number {
  if (p.role === 'wheel') return lookup(WHEELS, p.wheel!, 'wheel').mass;
  if (p.role === 'component') {
    const c = p.component!;
    if (c.type === 'battery') return lookup(BATTERIES, c.part, 'battery').mass;
    if (c.type === 'gasTank') { const t = lookup(TANKS, c.part, 'tank'); return t.mass + t.capacity / 1000; }
    return c.mass;
  }
  const m = material(p.material ?? 'aluminium');
  const s = p.shape!;
  const solid = shapeVolume(s) * m.density;
  if (!p.wall) return solid;
  return Math.min(solid, shapeArea(s) * (p.wall / 1000) * m.density);
}

/** Mass of whatever drives a joint (motor + gearbox, or ram + valve). */
export function actuatorMass(a: ActuatorDef): number {
  if (a.type === 'pneumatic') return lookup(RAMS, a.ram, 'ram').mass + lookup(VALVES, a.valve, 'valve').mass;
  return lookup(MOTORS, a.motor, 'motor').mass + 1.2 * Math.min(1, a.gear / 8);
}

// ---------------------------------------------------------------- inertia

/** Solid-body principal moments about the shape centre, in its frame. Hollow parts carry mass further out. */
export function shapeInertia(s: Shape, mass: number, hollow: boolean): V3 {
  const k = hollow ? 1.6 : 1;
  let I: V3;
  switch (s.type) {
    case 'cylinder': case 'capsule': {
      const r = s.radius, h = s.type === 'capsule' ? s.length + 1.3 * r : s.length;
      I = { x: (mass * (3 * r * r + h * h)) / 12, y: 0.5 * mass * r * r, z: (mass * (3 * r * r + h * h)) / 12 };
      break;
    }
    case 'cone': {
      const r = s.radius, h = s.length;
      I = { x: mass * (0.15 * r * r + 0.0375 * h * h), y: 0.3 * mass * r * r, z: mass * (0.15 * r * r + 0.0375 * h * h) };
      break;
    }
    case 'sphere': I = { x: 0.4 * mass * s.radius ** 2, y: 0.4 * mass * s.radius ** 2, z: 0.4 * mass * s.radius ** 2 }; break;
    default: {
      const h = shapeHalf(s), x = 2 * h.x, y = 2 * h.y, z = 2 * h.z;
      I = { x: (mass * (y * y + z * z)) / 12, y: (mass * (x * x + z * z)) / 12, z: (mass * (x * x + y * y)) / 12 };
    }
  }
  return vscale(I, k);
}

/**
 * Moment of inertia of a rigid group of parts about an axis line (through
 * `point`, along unit `dir`, robot frame). Used for spinner energy.
 */
export function inertiaAbout(d: RobotDesign, ids: string[], point: V3, dir: V3): number {
  const frames = partFrames(d);
  let total = 0;
  for (const id of ids) {
    const p = d.parts.find((q) => q.id === id)!;
    const f = frames.get(id)!;
    const rs = resolveShape(p);
    const m = partMass(p);
    const rot = qmul(f.rot, rs.rot);
    const centre = vadd(f.pos, qrotate(f.rot, rs.offset));
    const I = shapeInertia(rs.shape, m, !!p.wall);
    // Axis direction in the shape's frame.
    const a = qrotate({ x: -rot.x, y: -rot.y, z: -rot.z, w: rot.w }, dir);
    const own = I.x * a.x * a.x + I.y * a.y * a.y + I.z * a.z * a.z;
    const r = vsub(centre, point);
    const along = vdot(r, dir);
    const d2 = vdot(r, r) - along * along;
    total += own + m * Math.max(0, d2);
  }
  return total;
}

/** A part plus every part rigidly (fixed-joint) attached below it. */
export function rigidGroup(d: RobotDesign, id: string): string[] {
  const out = [id];
  for (const c of childrenOf(d, id)) if (c.joint.type === 'fixed') out.push(...rigidGroup(d, c.id));
  return out;
}

/** A part and everything below it, jointed or not. */
export function subtree(d: RobotDesign, id: string): string[] {
  const out = [id];
  for (const c of childrenOf(d, id)) out.push(...subtree(d, c.id));
  return out;
}

/** World-space (robot frame) bounding box of the whole robot as built. */
export function designBounds(d: RobotDesign): { min: V3; max: V3 } {
  const frames = partFrames(d);
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of d.parts) {
    const f = frames.get(p.id);
    if (!f) continue;
    for (const c of shapeCorners(p, f)) {
      min.x = Math.min(min.x, c.x); min.y = Math.min(min.y, c.y); min.z = Math.min(min.z, c.z);
      max.x = Math.max(max.x, c.x); max.y = Math.max(max.y, c.y); max.z = Math.max(max.z, c.z);
    }
  }
  return { min, max };
}

/** Points on a part's surface (or its bounding box for round shapes), robot frame. */
export function shapeCorners(p: PartDef, f: Frame): V3[] {
  const rs = resolveShape(p);
  const rot = qmul(f.rot, rs.rot);
  const centre = vadd(f.pos, qrotate(f.rot, rs.offset));
  const pts = shapePoints(rs.shape);
  let local: V3[];
  if (pts) local = pts.map(toV);
  else if (rs.shape.type === 'sphere') {
    const r = rs.shape.radius;
    local = [];
    for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) for (const c of [-1, 0, 1]) {
      const v = { x: a, y: b, z: c }, l = vlen(v);
      if (l > 0) local.push(vscale(v, r / l));
    }
  } else {
    // Round shapes: sample the rims.
    const h = shapeHalf(rs.shape);
    local = [];
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * 2 * Math.PI;
      for (const y of [-h.y, h.y]) local.push({ x: Math.cos(t) * h.x, y, z: Math.sin(t) * h.z });
    }
  }
  return local.map((v) => vadd(centre, qrotate(rot, v)));
}
