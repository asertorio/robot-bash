import type { PartDef, RobotDesign, Shape, Vec3 } from '../sim/design';

/**
 * Helpers for giving the built-in robots real shapes: sloped armour, wedges
 * with cheek plates, bevelled flipper plates and profiled blades. Each one
 * stays inside the envelope of the plain box it replaces, so layouts (wheel
 * positions, hinge lines, internals) don't need to move.
 */

/** Replace fields of named parts. Throws if a name doesn't exist, so typos fail loudly. */
export function reshape(d: RobotDesign, changes: Record<string, Partial<PartDef>>): RobotDesign {
  for (const id of Object.keys(changes)) if (!d.parts.some((p) => p.id === id)) throw new Error(`${d.name}: no part ${id}`);
  return { ...d, parts: d.parts.map((p) => (changes[p.id] ? { ...p, ...changes[p.id] } : p)) };
}

/** Sloped armour shell the size of `size`: see the 'armour' shape. */
export const armour = (size: Vec3, o: { sides?: number; front?: number; rear?: number; belt?: number }): Shape =>
  ({ type: 'armour', size, sides: o.sides ?? 0, front: o.front ?? 0, rear: o.rear ?? 0, belt: o.belt ?? 0.5 });

/**
 * A wedge with cheek plates: full width at the floor, sloping from the lip
 * up to a narrower top edge at the back, with the sides raked in above the
 * `shoulder` height (measured from the bottom). Fits a [w, h, l] envelope.
 */
export function cheekWedge(size: Vec3, o: { topWidth: number; shoulder: number; lip: number; nose?: number }): Shape {
  const [w, h, l] = size.map((v) => v / 2);
  const tw = o.topWidth / 2, sh = -h + o.shoulder, lip = -h + o.lip;
  const nose = o.nose ?? 0; // corners cut off the leading edge, seen from above
  const pts: Vec3[] = [];
  for (const s of [-1, 1]) {
    pts.push([s * w, -h, -l], [s * w, sh, -l], [s * tw, h, -l]);
    pts.push([s * w, -h, l - nose], [s * w, Math.min(sh, lip), l - nose]);
    pts.push([s * (w - nose), -h, l], [s * (w - nose), lip, l]);
  }
  return { type: 'hull', points: pts };
}

/**
 * Flipper or lifter plate, `size` = [width, thickness, length]: the leading
 * edge is ground to a bevel on top and its corners are cut back.
 */
export function bevelledPlate(size: Vec3, o: { bevel?: number; corner?: number } = {}): Shape {
  const [w, t, l] = size.map((v) => v / 2);
  const bevel = o.bevel ?? Math.min(0.06, l), corner = o.corner ?? Math.min(0.06, w / 3);
  const edge = Math.min(0.0015, t);
  const pts: Vec3[] = [];
  for (const s of [-1, 1]) {
    pts.push([s * w, -t, -l], [s * w, t, -l]);
    pts.push([s * w, -t, l - corner], [s * w, t, l - bevel]);
    pts.push([s * (w - corner), -t, l], [s * (w - corner), -t + edge, l]);
  }
  return { type: 'hull', points: pts };
}

/**
 * A spinner bar seen from above, `length` × `width`, `thickness` deep: square
 * impact teeth on the leading corners and the trailing corners cut away.
 * Point-symmetric, so it's balanced.
 */
export function bladeBar(length: number, width: number, thickness: number): Shape {
  const L = length / 2, W = width / 2;
  const cut = Math.min(L * 0.25, W * 1.2);
  return {
    type: 'extrude', plane: 'top', depth: thickness,
    outline: [[L, -W * 0.2], [L, W], [-L + cut, W], [-L, W * 0.2], [-L, -W], [L - cut, -W]],
  };
}

/** A plate seen from above that tapers from `backWidth` to `frontWidth` with a rounded nose, `thick` deep. */
export function taperedTongue(backWidth: number, frontWidth: number, length: number, thick: number): Shape {
  const b = backWidth / 2, f = frontWidth / 2, l = length / 2;
  const r = Math.min(f * 0.6, l * 0.2);
  return {
    type: 'extrude', plane: 'top', depth: thick,
    outline: [[-b, -l], [b, -l], [f, l - r], [f - r * 0.6, l], [-f + r * 0.6, l], [-f, l - r]],
  };
}
