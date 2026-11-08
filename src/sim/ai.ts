import { ARENA } from './arena';
import type { ControlState } from './control';
import type { Robot } from './robot';
import type RAPIER from '@dimforge/rapier3d-compat';
import { qaxis, qconj, qmul, qrotate, vadd, vcross, vdot, vlen, vscale, vsub, type V3 } from './vmath';

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
  private arms = new WeaponOperator();
  private dt = 0;
  /** Which way to curve when backing out of a shoving match (alternates, so it comes round a different side). */
  private flank = 1;

  update(me: Robot, foe: Robot | undefined, pitOpen: boolean, dt: number): ControlState {
    const out: ControlState = { left: 0, right: 0, weapon: false, weapon2: false };
    if (!foe) return out;
    this.dt = dt;

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
      out.left = this.flank > 0 ? -0.9 : -0.35;
      out.right = this.flank > 0 ? -0.35 : -0.9;
      return this.weapons(me, foe, out);
    }
    // Includes shoving stalemates: going nowhere, so try another angle.
    const spinning = Math.abs(me.chassis.angvel().y) > 0.4;
    if (speed < 0.15 && !spinning) this.stuckFor += dt; else this.stuckFor = Math.max(0, this.stuckFor - dt);
    if (this.stuckFor > 1.5) {
      this.stuckFor = 0;
      this.reverseFor = 0.5 + Math.random() * 0.5;
      this.flank = -this.flank;
    }

    // A thwackbot's weapon is turning: close in, then spin on the spot.
    if (me.design.style === 'thwack' && dist < 1.5) {
      out.left = 1;
      out.right = -1;
      if (inverted) [out.left, out.right] = [-out.right, -out.left];
      return this.weapons(me, foe, out);
    }

    const turn = Math.max(-1, Math.min(1, -bearing * 1.6));
    const aligned = Math.max(0, Math.cos(bearing));
    const throttle = aligned * (dist > 0.6 ? 1 : 0.6);
    out.left = Math.max(-1, Math.min(1, throttle + turn));
    out.right = Math.max(-1, Math.min(1, throttle - turn));
    // Upside down, the wheels drive backwards and the sides swap over.
    if (inverted) [out.left, out.right] = [-out.right, -out.left];
    return this.weapons(me, foe, out);
  }

  private weapons(me: Robot, foe: Robot, out: ControlState): ControlState {
    return this.arms.update(me, [foe], out, this.dt, { selfRight: true });
  }
}

const BUTTONS = ['button1', 'button2', 'button3', 'button4'] as const;
const FIELD = { button1: 'weapon', button2: 'weapon2', button3: 'weapon3', button4: 'weapon4' } as const;
type Button = (typeof BUTTONS)[number];

/** A weapon is worth firing if, somewhere along its stroke, it would come this close to the target (m). */
const HIT_MARGIN = 0.03;
/** Only bother checking targets this close (m). */
const LOOK_RANGE = 2.5;
/** Furthest a CPU will shoot a free round (m): any further and it'll have dropped or they'll have moved. */
const LAUNCH_RANGE = 6;

const shapes = new WeakMap<RAPIER.Collider, RAPIER.Shape>();
const shapeOf = (c: RAPIER.Collider): RAPIER.Shape => {
  let sh = shapes.get(c);
  if (!sh) { sh = c.shape; shapes.set(c, sh); }
  return sh;
};

/**
 * Works a robot's weapon buttons the way a driver would: keep spinners and
 * drums running, and fire flippers, axes, lifters, rams, crushers and
 * flamethrowers when — and only when — the stroke would actually reach the
 * target, holding the button long enough for the whole stroke.
 */
export class WeaponOperator {
  private hold = new Map<Button, number>();
  private rest = new Map<Button, number>();
  private pressed = new Set<Button>();

  /** `attack` forces every attack button (house robots' scripted moments); `selfRight` fires flippers when upside down. */
  update(me: Robot, targets: Robot[], out: ControlState, dt: number, opts: { attack?: boolean; selfRight?: boolean } = {}): ControlState {
    const uses = me.buttonUses();
    for (const b of BUTTONS) {
      const kinds = uses.get(b);
      const flame = me.flames.some((f) => f.def.input.source === b);
      if (!kinds && !flame) continue;
      let press = false;
      if (kinds && (kinds.has('cannon') || kinds.has('harpoon') || kinds.has('cut') || kinds.has('winch'))) {
        out[FIELD[b]] = this.launcherButton(me, targets, b, kinds, dt);
        continue;
      }
      const chainToggle = me.chains.some((c) => c.def.input.source === b && c.def.input.mode === 'toggle');
      if (kinds?.has('spinner') || chainToggle) {
        // Toggle switches: press once to switch on, then leave it.
        const off = me.actuators.some((a) => a.def.input.source === b && a.def.input.mode === 'toggle' && !a.toggled && a.child.joint)
          || me.chains.some((c) => c.def.input.source === b && c.def.input.mode === 'toggle' && !c.toggled && !c.part.detached);
        press = off && !this.pressed.has(b);
        if (press) this.pressed.add(b); else this.pressed.delete(b);
      } else if (kinds?.has('motor') || (kinds?.has('chain') && kinds.size === 1)) {
        // A held motor or chainsaw (drum, saw, crusher screw): keep it going while anyone is near.
        press = targets.some((t) => planarDistance(me, t) < (kinds.has('chain') ? 1.5 : LOOK_RANGE));
      } else {
        const holding = (this.hold.get(b) ?? 0) - dt;
        const resting = (this.rest.get(b) ?? 0) - dt;
        this.hold.set(b, holding);
        this.rest.set(b, resting);
        if (holding > 0) press = true;
        else if (resting <= 0) {
          const upsideDown = opts.selfRight && me.uprightness < -0.3 && !!kinds?.has('pneumatic');
          if (opts.attack || upsideDown || targets.some((t) => this.wouldHit(me, t, b))) {
            const d = this.strokeTime(me, b);
            this.hold.set(b, d);
            // Give a slow lifter time to drive them somewhere before trying again.
            this.rest.set(b, d + (d > 1 ? 2 : 0.5));
            press = true;
          }
        }
      }
      out[FIELD[b]] = press;
    }
    return out;
  }

  /**
   * Cannons and harpoons: fire when a target is in line and in range, hold
   * through the stroke; never cut our own cable. Wind the winch whenever a
   * harpoon is out and has stopped flying — dragging what it hit, or
   * reeling it back in after a miss.
   */
  private launcherButton(me: Robot, targets: Robot[], b: Button, kinds: Set<string>, dt: number): boolean {
    if (kinds.has('winch')) {
      return me.launchers.some((l) => l.winch?.def.input.source === b && l.cable
        && (l.cable.round.embed || vlen(l.cable.round.info.body.linvel()) < 2));
    }
    if (kinds.has('cut')) return false;
    const holding = (this.hold.get(b) ?? 0) - dt;
    const resting = (this.rest.get(b) ?? 0) - dt;
    this.hold.set(b, holding);
    this.rest.set(b, resting);
    if (holding > 0) return true;
    if (resting > 0) return false;
    for (const l of me.launchers) {
      if (l.act.def.input.source !== b || !l.loaded || me.gasLeft <= 0) continue;
      const pb = l.act.parent.body;
      const origin = vadd(pb.translation(), qrotate(pb.rotation(), l.muzzle));
      const dir = qrotate(pb.rotation(), l.act.axis);
      const range = l.def.tether ? l.def.tether.length * 0.85 : LAUNCH_RANGE;
      for (const t of targets) {
        const to = vsub(t.position, origin);
        const along = vdot(to, dir);
        const off = vlen(vsub(to, vscale(dir, along)));
        if (along > 0.2 && along < range && off < 0.22 + 0.02 * along) {
          this.hold.set(b, 0.4);
          this.rest.set(b, 0.8);
          return true;
        }
      }
    }
    return false;
  }

  /** How long to hold a button for a full stroke. */
  private strokeTime(me: Robot, b: Button): number {
    let t = me.flames.some((f) => f.def.input.source === b) ? 0.8 : 0.35;
    for (const a of me.actuators) {
      if (a.def.input.source !== b) continue;
      // A hydraulic crusher holds on to get its point through.
      if (a.def.type === 'pneumatic') t = Math.max(t, a.ram?.hydraulic ? 2.6 : Number.isFinite(a.maxRate) ? 1.6 : 0.5);
      // Bring a saw arm down and keep it there while it cuts.
      if (a.def.type === 'servo') t = Math.max(t, me.parts.some((p) => p.bodyKey === a.child.key && p.edge === 'saw') ? 2.5 : 1.0);
    }
    return t;
  }

  /** Would firing button `b` now hit `foe`? Sweeps each driven part through its stroke. */
  wouldHit(me: Robot, foe: Robot, b: Button): boolean {
    if (planarDistance(me, foe) > LOOK_RANGE) return false;
    const foeColliders = foe.parts.filter((p) => !p.detached).flatMap((p) => foe.collidersOf(p));
    for (const f of me.flames) {
      if (f.def.input.source !== b || f.fuel <= 0 || !f.part.collider || !f.part.body) continue;
      const origin = f.part.collider.translation();
      const dir = qrotate(f.part.body.rotation(), f.dir);
      const to = vsub(foe.position, origin);
      const along = to.x * dir.x + to.y * dir.y + to.z * dir.z;
      const off = Math.hypot(to.x - dir.x * along, to.y - dir.y * along, to.z - dir.z * along);
      if (along > 0 && along < f.def.range + 0.2 && off < 0.35 + along * 0.35) return true;
    }
    if (me.gasLeft <= 0 && me.actuators.every((a) => a.def.input.source !== b || (a.def.type === 'pneumatic' && !a.ram?.hydraulic))) return false;
    for (const a of me.actuators) {
      if (a.def.input.source !== b || !a.child.joint) continue;
      const pivot = a.child.body.translation();
      const axis = qrotate(a.parent.body.rotation(), a.axis);
      // Which way, and how far, does firing move the joint?
      let travel: number;
      if (a.def.type === 'servo') {
        const hi = a.def.targets[2];
        travel = (a.joint === 'hinge' ? (hi * Math.PI) / 180 : hi / 1000) - a.position;
      } else {
        const hi = a.limits ? a.limits[1] : a.joint === 'hinge' ? Math.PI / 2 : 0.15;
        travel = Math.max(0, hi - a.position);
      }
      if (Math.abs(travel) < 1e-3) continue;
      const own = me.parts.filter((p) => p.bodyKey === a.child.key && !p.detached && p.kind === 'structure').flatMap((p) => me.collidersOf(p));
      // A slow weapon (lifter, hydraulic crusher) only works on what it's
      // already pressing on in the direction it moves — under a lifter, under
      // a crusher's beak; anything else it would just push away. Fast weapons
      // hit whatever their stroke reaches.
      const slow = a.def.type === 'pneumatic' && Number.isFinite(a.maxRate);
      const sign = Math.sign(travel);
      for (const k of [0.08, 0.3, 0.55, 0.8, 1]) {
        const d = travel * k;
        const turn = a.joint === 'hinge' ? qaxis(axis, d) : { x: 0, y: 0, z: 0, w: 1 };
        for (const c of own) {
          const p = c.translation();
          const pos = a.joint === 'hinge' ? vadd(pivot, qrotate(turn, vsub(p, pivot))) : vadd(p, vscale(axis, d));
          const rot = qmul(turn, c.rotation());
          for (const fc of foeColliders) {
            const hit = fc.contactShape(shapeOf(c), pos, rot, HIT_MARGIN);
            if (!hit || hit.distance >= HIT_MARGIN) continue;
            if (!slow) return true;
            // Which way is our surface moving there, and is it pressing into them?
            const motion = a.joint === 'hinge' ? vscale(vcross(axis, vsub(hit.point2, pivot)), sign) : vscale(axis, sign);
            const len = vlen(motion);
            if (len < 1e-6 || vdot(hit.normal2, motion) / len < 0.5) continue;
            // Lifting: only what's on it already. Crushing down: anything the
            // beak comes down on is trapped against the floor or the scoop.
            if (k <= 0.08 || -motion.y / len > 0.5) return true;
          }
        }
      }
    }
    return false;
  }
}

function planarDistance(a: Robot, b: Robot): number {
  return Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
}
