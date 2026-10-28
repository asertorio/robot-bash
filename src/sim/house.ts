import { ARENA } from './arena';
import type { ControlState } from './control';
import type { Robot } from './robot';
import { steerTo, useWeapons } from './ai';
import type { V3 } from './vmath';

/** The corner patrol zone a house robot guards. */
export interface Zone {
  sx: number;
  sz: number;
}

export const HOUSE_CORNERS: Zone[] = [{ sx: 1, sz: 1 }, { sx: -1, sz: -1 }, { sx: 1, sz: -1 }, { sx: -1, sz: 1 }];

export function zoneCentre(z: Zone): V3 {
  const c = ARENA.half - ARENA.cpz / 2;
  return { x: z.sx * c, y: 0, z: z.sz * c };
}

export function inZone(z: Zone, p: V3, margin = 0): boolean {
  const inner = ARENA.half - ARENA.cpz - margin;
  return p.x * z.sx > inner && p.z * z.sz > inner;
}

/**
 * House robot behaviour, as on the show: sit in your corner, punish anyone
 * who strays into it, and once a robot is counted out, everyone piles in.
 */
export class HouseDriver {
  private fireFor = 0;
  private cooldown = 0;
  private pressed = new Set<string>();

  constructor(readonly zone: Zone) {}

  /** `victims` are competitors that have been counted out and are fair game anywhere. */
  update(me: Robot, competitors: Robot[], victims: Robot[], dt: number): ControlState {
    const out: ControlState = { left: 0, right: 0, weapon: false, weapon2: false };
    this.cooldown -= dt;
    const home = zoneCentre(this.zone);
    const intruders = competitors.filter((r) => inZone(this.zone, r.position, 0.3));
    const targets = [...intruders, ...victims];
    const dist = (r: Robot) => Math.hypot(r.position.x - me.position.x, r.position.z - me.position.z);
    const target = targets.sort((a, b) => dist(a) - dist(b))[0];

    if (target) {
      const s = steerTo(me, target.position, 0.75);
      out.left = s.left;
      out.right = s.right;
      if (s.distance < 1.4 && Math.abs(s.bearing) < 0.5 && this.cooldown <= 0) {
        this.fireFor = 1.4;
        this.cooldown = 3;
      }
    } else if (Math.hypot(home.x - me.position.x, home.z - me.position.z) > 0.35) {
      const s = steerTo(me, home, 0.5);
      out.left = s.left;
      out.right = s.right;
    } else {
      // Home: face the arena.
      const s = steerTo(me, { x: 0, y: 0, z: 0 }, 0);
      if (Math.abs(s.bearing) > 0.3) { out.left = s.left * 0.4; out.right = s.right * 0.4; }
    }

    // Lifters hold while the button is held; spinners just stay on.
    if (this.fireFor > 0) this.fireFor -= dt;
    useWeapons(me, out, this.fireFor > 0, this.pressed);
    return out;
  }
}
