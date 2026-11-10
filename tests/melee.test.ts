import { describe, expect, test } from 'vitest';
import { FLIPSIDE, WEDGEHOG, WHIRLWIND, TEMPLATES } from '../src/data/templates';
import { CpuDriver } from '../src/sim/ai';
import { Match } from '../src/sim/match';
import { N, drive, run, spawnAt } from './helpers';

describe('melees', () => {
  test('the last robot moving wins a four-way, and the knock-outs are recorded in order', () => {
    const m = new Match([WEDGEHOG, FLIPSIDE, WHIRLWIND, TEMPLATES[3]], { skipCountdown: true, duration: 60 });
    // Robot 0 spins on the spot (under its own power); the rest sit still and get counted out.
    run(m, 16, () => [drive(1, -1), N, N, N]);
    expect(m.phase).toBe('over');
    expect(m.result?.winner).toBe(0);
    expect(m.result?.reason).toMatch(/Last robot standing/);
    expect([...m.outOrder].sort()).toEqual([1, 2, 3]);
    // All three went at once: no "robots left" call on the way to the result.
    expect(m.commentary.some((l) => /left in the arena|last two/.test(l.text))).toBe(false);
    m.free();
  });

  test('one out of a four-way: the commentator says how many are left', () => {
    const m = new Match([WEDGEHOG, FLIPSIDE, WHIRLWIND, TEMPLATES[3]], { skipCountdown: true, duration: 60 });
    run(m, 15, () => [drive(1, -1), drive(-1, 1), drive(1, -1), N]);
    expect(m.outOrder).toEqual([3]);
    expect(m.commentary.filter((l) => l.text === '3 robots left in the arena!')).toHaveLength(1);
    m.free();
  });

  test('a melee that goes the distance is judged across everyone', () => {
    const m = new Match([WEDGEHOG, FLIPSIDE, WHIRLWIND], { skipCountdown: true, duration: 3 });
    run(m, 3.2, () => [drive(1, -1), drive(-1, 1), drive(1, -1)]);
    expect(m.result?.scores).toHaveLength(3);
    m.free();
  });

  test('a CPU goes for the nearest rival and sticks with it', () => {
    const m = new Match([WEDGEHOG, FLIPSIDE, WHIRLWIND], { skipCountdown: true, spawns: spawnAt([0, 0, 0], [0, 2, 0], [0, -3, 0]) });
    const [me, near, far] = m.competitors;
    const cpu = new CpuDriver();
    expect(cpu.chooseFoe(me, [far, near])).toBe(near);
    // Now the other is only a little closer: no switching.
    near.shift({ x: 0, y: 0, z: 1.5 });
    m.world.step();
    expect(cpu.chooseFoe(me, [far, near])).toBe(near);
    m.free();
  });
});
