import { describe, expect, test } from 'vitest';
import { FLIPSIDE, WEDGEHOG } from '../src/data/templates';
import type { RobotDesign } from '../src/sim/design';
import { ARENA } from '../src/sim/arena';
import { Match } from '../src/sim/match';
import { drive, run } from './helpers';

/** How much a robot is hurt driving full speed into the side wall at z. */
function ram(z: number, wallSpikes: boolean, design: RobotDesign = FLIPSIDE) {
  const m = new Match([design], { skipCountdown: true, sandbox: true, wallSpikes, spawns: [{ pos: { x: ARENA.half - 2.2, y: 0.01, z }, yaw: Math.PI / 2 }] });
  run(m, 3, () => [drive(1)]);
  const loss = m.robots[0].parts.filter((p) => p.kind === 'structure').reduce((s, p) => s + (1 - p.condition), 0);
  const said = m.commentary.some((l) => l.text.includes('wall spikes'));
  m.free();
  return { loss, said };
}

describe('wall spikes', () => {
  test('ramming the spikes hurts more than ramming bare wall', () => {
    const spikes = ram(ARENA.spikes.centres[1], true);
    const bare = ram(-4.6, true);
    const none = ram(ARENA.spikes.centres[1], false);
    expect(spikes.loss).toBeGreaterThan(bare.loss * 1.3 + 0.01);
    expect(none.loss).toBeLessThan(spikes.loss);
    // Hardened steel shrugs them off far better than aluminium.
    const hard = ram(ARENA.spikes.centres[1], true, WEDGEHOG), hardBare = ram(-4.6, true, WEDGEHOG);
    expect(hard.loss / Math.max(1e-6, hardBare.loss)).toBeLessThan(spikes.loss / Math.max(1e-6, bare.loss));
    expect(spikes.said).toBe(true);
    console.log(`plate damage: aluminium ${spikes.loss.toFixed(3)} on spikes v ${bare.loss.toFixed(3)} bare; hardened ${hard.loss.toFixed(3)} v ${hardBare.loss.toFixed(3)}`);

  });
});
