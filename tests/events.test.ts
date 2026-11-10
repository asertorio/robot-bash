import { describe, expect, test } from 'vitest';
import { FLIPSIDE, WEDGEHOG } from '../src/data/templates';
import { CpuDriver, footballAim, nearDaisEdge, sumoAim } from '../src/sim/ai';
import { ARENA } from '../src/sim/arena';
import { Match } from '../src/sim/match';
import { N, drive, run } from './helpers';

describe('sumo', () => {
  test('robots start on the dais, and one driven off the edge is out', () => {
    const m = new Match([WEDGEHOG, FLIPSIDE], { skipCountdown: true, event: 'sumo' });
    expect(m.robots[0].position.y).toBeGreaterThan(ARENA.dais.height - 0.05);
    // Robot 1 sits still; robot 0 drives straight across and off the far side.
    run(m, 0.5);
    expect(m.eliminated).toEqual([null, null]);
    run(m, 6, () => [drive(-1), N]);
    expect(m.eliminated[0]).toBe('off the dais');
    expect(m.result?.winner).toBe(1);
    m.free();
  });

  test('a CPU on the edge heads back to the middle instead of going over', () => {
    const m = new Match([WEDGEHOG, FLIPSIDE], { skipCountdown: true, event: 'sumo' });
    const cpu = new CpuDriver();
    const [me, foe] = m.competitors;
    run(m, 4, () => [cpu.update(me, foe, false, 1 / 480, { aim: sumoAim(me, foe, ARENA.dais.radius), noReverse: nearDaisEdge(me, ARENA.dais.radius) }), N]);
    expect(m.eliminated[0]).toBeNull();
    m.free();
  });
});

describe('football', () => {
  test('a ball pushed into the far goal scores for the team attacking it, and comes back to the centre', () => {
    const m = new Match([WEDGEHOG, FLIPSIDE], { skipCountdown: true, event: 'football', spawns: [{ pos: { x: 0, y: 0.01, z: 2.4 }, yaw: 0 }, { pos: { x: 3.5, y: 0.01, z: -3 }, yaw: 0 }] });
    m.ball!.setTranslation({ x: 0, y: 0.25, z: 3.3 }, true);
    run(m, 4, () => [drive(1), N]);
    expect(m.goals).toEqual([1, 0]);
    expect(m.commentary.some((l) => l.text.startsWith('GOAL! Wedgehog scores'))).toBe(true);
    expect(Math.hypot(m.ball!.translation().x, m.ball!.translation().z)).toBeLessThan(1.5);
    m.free();
  });

  test('a CPU gets behind the ball and scores against an empty net', () => {
    const m = new Match([WEDGEHOG, FLIPSIDE], { skipCountdown: true, event: 'football', duration: 60, spawns: [{ pos: { x: 1.5, y: 0.01, z: -2.6 }, yaw: 0 }, { pos: { x: 5, y: 0.01, z: -5 }, yaw: 0 }] });
    const cpu = new CpuDriver();
    const goal = { x: 0, y: 0, z: ARENA.half };
    const [me, foe] = m.competitors;
    run(m, 25, () => [cpu.update(me, foe, false, 1 / 480, { aim: footballAim(me, m.ball!.translation(), goal) }), N]);
    expect(m.goals[0]).toBeGreaterThanOrEqual(1);
    m.free();
  });

  test('three goals wins it', () => {
    const m = new Match([WEDGEHOG, FLIPSIDE], { skipCountdown: true, event: 'football' });
    for (let g = 0; g < 3; g++) {
      m.ball!.setTranslation({ x: 0, y: 0.25, z: -ARENA.half + 0.2 }, true);
      run(m, 0.1);
    }
    expect(m.goals).toEqual([0, 3]);
    expect(m.result?.winner).toBe(1);
    expect(m.result?.reason).toBe('Blue wins 3–0');
    m.free();
  });
});

describe('gauntlet', () => {
  test('a CPU runs the course — chicane, crates and all — and wins by crossing the line', async () => {
    const { gauntletAim } = await import('../src/sim/ai');
    const m = new Match([WEDGEHOG, FLIPSIDE], { skipCountdown: true, event: 'gauntlet', duration: 90 });
    expect(m.crates.length).toBeGreaterThan(3);
    const cpu = new CpuDriver();
    const me = m.competitors[0];
    run(m, 60, () => [cpu.update(me, m.competitors[1], false, 1 / 480, { aim: gauntletAim(me) }), N]);
    expect(m.result?.winner).toBe(0);
    expect(m.result?.reason).toMatch(/crossed the line first/);
    console.log(`gauntlet run: ${m.endTime?.toFixed(1)} s`);
    m.free();
  });

  test('at time, the one furthest along wins', () => {
    const m = new Match([WEDGEHOG, FLIPSIDE], { skipCountdown: true, event: 'gauntlet', duration: 3 });
    run(m, 3.2, () => [drive(1), N]);
    expect(m.progress[0]).toBeGreaterThan(m.progress[1] + 1);
    expect(m.result?.winner).toBe(0);
    m.free();
  });
});
