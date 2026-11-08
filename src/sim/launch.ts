import { MOTORS, lookup } from '../data/parts';
import { partMass, rigidGroup } from './assembly';
import type { LaunchDef, PartDef, RobotDesign, WinchDef } from './design';

/**
 * Launchers: cannons and harpoon guns. A round rides on a gas-ram slider and
 * is let go at the end of the stroke, so its speed is just the ram's work
 * (pressure × area × stroke) over its mass, less what the valve's opening
 * time costs — the physics already does that. These numbers cover the rest.
 *
 * - `RELEASE`: the round leaves within this far (m) of full stroke.
 * - `SAFE_TIME`: a free round passes through its own robot this long (s)
 *   after leaving the barrel, so it can't clip the robot that fired it;
 *   then it's ordinary debris.
 * - `CABLE_KG_PER_M`: 5 mm steel wire rope weighs about 0.1 kg/m.
 * - `DRUM_KG`: the winch drum, frame and bearings, on top of the motor.
 * - `EMBED`: a pointed round (edge 'spike') sticks in when its impact force
 *   exceeds EMBED × the plate's pierce force (`pierceForce` in damage.ts,
 *   ∝ yield strength × thickness). So a harpoon goes into thin aluminium or
 *   HDPE and glances off thick Hardox, like the real thing.
 * - `REDOCK`: a tethered round reeled back to within this distance (m) of
 *   the muzzle drops back into the barrel, ready to fire again.
 * - `ROPE_STEP`: the cable joint is rebuilt when the winch has changed its
 *   length by this much (m) — fine enough to look and feel continuous.
 * - `RELOAD`: seconds to load the next round when the design doesn't say.
 */
export const LAUNCH = {
  RELEASE: 0.004,
  SAFE_TIME: 0.6,
  CABLE_KG_PER_M: 0.1,
  DRUM_KG: 0.6,
  EMBED: 1,
  REDOCK: 0.3,
  ROPE_STEP: 0.01,
  RELOAD: 1.5,
};

/** Mass of one round: the launched part and everything bolted to it. */
export function roundMass(d: RobotDesign, p: PartDef): number {
  return rigidGroup(d, p.id).reduce((s, id) => s + partMass(d.parts.find((q) => q.id === id)!), 0);
}

/** Mass carried for a launcher besides the round in the barrel: spare rounds, cable, winch. */
export function launcherExtras(d: RobotDesign, p: PartDef, l: LaunchDef): { spares: number; cable: number; winch: number } {
  return {
    spares: (l.rounds ?? 0) * roundMass(d, p),
    cable: l.tether ? l.tether.length * LAUNCH.CABLE_KG_PER_M : 0,
    winch: l.tether?.winch ? winchMass(l.tether.winch) : 0,
  };
}

export function winchMass(w: WinchDef): number {
  return lookup(MOTORS, w.motor, 'motor').mass + 1.2 * Math.min(1, w.gear / 8) + LAUNCH.DRUM_KG;
}

/** Every launcher in a design. */
export const launchersOf = (d: RobotDesign) => d.parts.flatMap((p) => (p.launch ? [{ part: p, launch: p.launch }] : []));
