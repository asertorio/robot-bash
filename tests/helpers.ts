import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll } from 'vitest';
import type { ControlState } from '../src/sim/control';
import type { Match } from '../src/sim/match';
import type { V3 } from '../src/sim/vmath';

beforeAll(async () => {
  await RAPIER.init();
});

export const N: ControlState = { left: 0, right: 0, weapon: false, weapon2: false };
export const drive = (left: number, right = left): ControlState => ({ ...N, left, right });

/** Step a match for `seconds`, feeding controls from `c` each step. */
export function run(m: Match, seconds: number, c: (t: number) => ControlState[] = () => [], each?: () => void) {
  const steps = Math.round(seconds * 480);
  for (let i = 0; i < steps; i++) {
    m.update(1 / 480, c(m.time));
    each?.();
  }
}

export const spawnAt = (...spots: Array<[number, number, number]>) =>
  spots.map(([x, z, yaw]) => ({ pos: { x, y: 0.01, z } as V3, yaw }));
