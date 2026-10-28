/** Minimal vector/quaternion helpers so the sim doesn't depend on a renderer. */

export interface V3 { x: number; y: number; z: number }
export interface Q { x: number; y: number; z: number; w: number }

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const fromArr = (a: readonly number[]): V3 => ({ x: a[0], y: a[1], z: a[2] });
export const vadd = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vsub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vscale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const vdot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const vcross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const vlen = (a: V3): number => Math.hypot(a.x, a.y, a.z);

export const qidentity = (): Q => ({ x: 0, y: 0, z: 0, w: 1 });

export function qaxis(axis: V3, angle: number): Q {
  const s = Math.sin(angle / 2);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(angle / 2) };
}

export function qmul(a: Q, b: Q): Q {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

export const qconj = (q: Q): Q => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

export function qrotate(q: Q, v: V3): V3 {
  // v' = v + 2w(q×v) + 2q×(q×v)
  const u = { x: q.x, y: q.y, z: q.z };
  const t = vscale(vcross(u, v), 2);
  return vadd(vadd(v, vscale(t, q.w)), vcross(u, t));
}

/** Signed rotation angle of `q` about the unit `axis` (twist decomposition). */
export function twistAngle(q: Q, axis: V3): number {
  const p = vdot({ x: q.x, y: q.y, z: q.z }, axis);
  let a = 2 * Math.atan2(p, q.w);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Deterministic PRNG so fights replay identically in tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
