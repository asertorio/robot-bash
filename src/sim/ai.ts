import { ARENA } from './arena';
import type { ControlState } from './control';
import type { Robot } from './robot';
import { qconj, qrotate, vsub, type V3 } from './vmath';

/**
 * Point-and-drive steering towards a world position, handling being upside
 * down (the drive reverses and the sides swap). Returns per-side throttles.
 */
export function steerTo(me: Robot, target: V3, maxThrottle = 1): { left: number; right: number; bearing: number; distance: number } {
  const inverted = me.uprightness < 0;
  const rel = qrotate(qconj(me.rotation), vsub(target, me.position));
  if (inverted) rel.x = -rel.x;
  const distance = Math.hypot(rel.x, rel.z);
  const bearing = Math.atan2(rel.x, rel.z); // + = target to my left
  const turn = Math.max(-1, Math.min(1, -bearing * 1.6));
  const throttle = Math.max(0, Math.cos(bearing)) * maxThrottle * (distance > 0.6 ? 1 : 0.6);
  let left = Math.max(-1, Math.min(1, throttle + turn));
  let right = Math.max(-1, Math.min(1, throttle - turn));
  if (inverted) [left, right] = [-right, -left];
  return { left, right, bearing, distance };
}

/**
 * A simple CPU driver: chase, line up, use the weapon, don't drive into the
 * pit, back off when stuck. It drives through the same ControlState a human
 * does, so it is bound by the same physics.
 */
export class CpuDriver {
  private stuckFor = 0;
  private reverseFor = 0;
  private fireCooldown = 0;
  private pressed = new Set<string>();

  update(me: Robot, foe: Robot | undefined, pitOpen: boolean, dt: number): ControlState {
    const out: ControlState = { left: 0, right: 0, weapon: false, weapon2: false };
    if (!foe) return out;
    this.fireCooldown -= dt;

    // Where is the target, in my own frame? (+z ahead, +x to my left.)
    const target = foe.position;
    const inverted = me.uprightness < 0;
    const rel = qrotate(qconj(me.rotation), vsub(target, me.position));
    if (inverted) rel.x = -rel.x;
    const dist = Math.hypot(rel.x, rel.z);
    let bearing = Math.atan2(rel.x, rel.z); // + = target to my left

    // Steer around an open pit unless the foe is right next to it (then shove!).
    if (pitOpen) {
      const p = vsub({ x: ARENA.pit.x, y: 0, z: ARENA.pit.z }, me.position);
      const pd = Math.hypot(p.x, p.z);
      const pl = qrotate(qconj(me.rotation), p);
      const pitBearing = Math.atan2(pl.x, pl.z);
      if (pd < 2 && Math.abs(pitBearing) < 0.6 && dist > 1.2) bearing += pitBearing > 0 ? -0.9 : 0.9;
    }

    // Unstick: pushing but going nowhere → reverse out for a moment.
    const v = me.chassis.linvel();
    const speed = Math.hypot(v.x, v.z);
    if (this.reverseFor > 0) {
      this.reverseFor -= dt;
      out.left = -0.8;
      out.right = -0.5;
      return this.weapons(me, out, dist, bearing);
    }
    // Includes shoving stalemates: going nowhere, so try another angle.
    const spinning = Math.abs(me.chassis.angvel().y) > 0.4;
    if (speed < 0.15 && !spinning) this.stuckFor += dt; else this.stuckFor = Math.max(0, this.stuckFor - dt);
    if (this.stuckFor > 1.8) {
      this.stuckFor = 0;
      this.reverseFor = 0.6 + Math.random() * 0.6;
    }

    const turn = Math.max(-1, Math.min(1, -bearing * 1.6));
    const aligned = Math.max(0, Math.cos(bearing));
    const throttle = aligned * (dist > 0.6 ? 1 : 0.6);
    out.left = Math.max(-1, Math.min(1, throttle + turn));
    out.right = Math.max(-1, Math.min(1, throttle - turn));
    // Upside down, the wheels drive backwards and the sides swap over.
    if (inverted) [out.left, out.right] = [-out.right, -out.left];
    return this.weapons(me, out, dist, bearing);
  }

  private weapons(me: Robot, out: ControlState, dist: number, bearing: number): ControlState {
    const fire = this.fireCooldown <= 0 && ((dist < 1.1 && Math.abs(bearing) < 0.45) || me.uprightness < -0.3);
    if (fire) this.fireCooldown = 1.2;
    return useWeapons(me, out, fire, this.pressed);
  }
}

const BUTTONS = ['button1', 'button2', 'button3', 'button4'] as const;
const FIELD = { button1: 'weapon', button2: 'weapon2', button3: 'weapon3', button4: 'weapon4' } as const;

/**
 * Work every weapon button the robot has: keep toggled spinners running, and
 * press attack buttons when `attack` is true. `pressed` remembers last frame's
 * presses so toggles see a fresh press each time.
 */
export function useWeapons(me: Robot, out: ControlState, attack: boolean, pressed: Set<string>): ControlState {
  const uses = me.buttonUses();
  for (const b of BUTTONS) {
    const kinds = uses.get(b);
    if (!kinds) continue;
    let press = false;
    if (kinds.has('spinner')) {
      const off = me.actuators.some((a) => a.def.input.source === b && a.def.input.mode === 'toggle' && !a.toggled && a.child.joint);
      press = off && !pressed.has(b);
    } else {
      press = attack;
    }
    if (press) pressed.add(b); else pressed.delete(b);
    out[FIELD[b]] = press;
  }
  return out;
}
