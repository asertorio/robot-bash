import { MATERIALS, material } from '../data/materials';
import { BATTERIES, MOTORS, RAMS, TANKS, VALVES, WHEELS, lookup } from '../data/parts';
import type { ActuatorDef, PartDef, RobotDesign, Shape, Vec3 } from './design';
import { shapeInertia, shapeSamplePoints, shapeArea, shapeVolume } from './shapes';
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
    if (p.launch) {
      const l = p.launch;
      if (p.role !== 'structure' || p.joint.type !== 'slider' || p.joint.actuator?.type !== 'pneumatic') errs.push(`${p.label}: a launched round sits on a slider driven by a pneumatic ram.`);
      else if (childrenOf(d, p.id).some((c) => c.joint.type !== 'fixed')) errs.push(`${p.label}: a round can only have parts bolted to it, not jointed ones.`);
      if (l.rounds !== undefined && !(Number.isInteger(l.rounds) && l.rounds >= 0 && l.rounds <= 50)) errs.push(`${p.label}: spare rounds must be a whole number from 0 to 50.`);
      if (l.reload !== undefined && !(l.reload >= 0.2 && l.reload <= 30)) errs.push(`${p.label}: reload time must be 0.2–30 s.`);
      if (l.tether) {
        if (!(l.tether.length >= 0.5 && l.tether.length <= 15)) errs.push(`${p.label}: the cable must be 0.5–15 m long.`);
        const w = l.tether.winch;
        if (w && (!(w.gear >= 1) || !(w.drum >= 5 && w.drum <= 200) || !w.input || typeof w.input.source !== 'string')) errs.push(`${p.label}: the winch needs a gear ratio, a 5–200 mm drum and a control.`);
      }
    }
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
    // Ballast is lead; everything else is roughly battery-dense.
    const side = Math.cbrt(partMass(p) / (p.component?.type === 'ballast' ? 11300 : COMPONENT_DENSITY));
    return { shape: { type: 'box', size: [side * 1.4, side * 0.6, side * 1.2] }, offset: toV(p.shapeOffset ?? [0, 0, 0]), rot: { x: 0, y: 0, z: 0, w: 1 } };
  }
  return { shape: p.shape!, offset: toV(p.shapeOffset ?? [0, 0, 0]), rot: { x: 0, y: 0, z: 0, w: 1 } };
}

export { faceArea, shapeArea, shapeHalf, shapeInertia, shapeVolume, solidThickness } from './shapes';

// ---------------------------------------------------------------- mass & cost

export function partMass(p: PartDef): number {
  if (p.role === 'wheel') return lookup(WHEELS, p.wheel!, 'wheel').mass;
  if (p.role === 'component') {
    const c = p.component!;
    if (c.type === 'battery') return lookup(BATTERIES, c.part, 'battery').mass;
    if (c.type === 'gasTank') { const t = lookup(TANKS, c.part, 'tank'); return t.mass + t.capacity / 1000; }
    if (c.type === 'flamethrower') return 2.5 + c.fuel;
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

/** Points on a part's surface (corners, or sampled rims for round shapes), robot frame. */
export function shapeCorners(p: PartDef, f: Frame): V3[] {
  const rs = resolveShape(p);
  const rot = qmul(f.rot, rs.rot);
  const centre = vadd(f.pos, qrotate(f.rot, rs.offset));
  return shapeSamplePoints(rs.shape).map((v) => vadd(centre, qrotate(rot, toV(v))));
}

/** The actuator on a part's joint, if it has one. */
export function actuatorOf(p: PartDef): ActuatorDef | undefined {
  return p.joint.type === 'hinge' || p.joint.type === 'slider' ? p.joint.actuator : undefined;
}

/** Make a design's own catalogue parts and materials available by id. */
export function registerCatalog(d: RobotDesign) {
  const c = d.catalog;
  if (!c) return;
  Object.assign(MOTORS, c.motors ?? {});
  Object.assign(BATTERIES, c.batteries ?? {});
  Object.assign(WHEELS, c.wheels ?? {});
  Object.assign(RAMS, c.rams ?? {});
  Object.assign(VALVES, c.valves ?? {});
  Object.assign(TANKS, c.tanks ?? {});
  Object.assign(MATERIALS, c.materials ?? {});
}
