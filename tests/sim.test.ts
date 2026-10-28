import { describe, expect, test } from 'vitest';
import { FLIPSIDE, TEMPLATES, WEDGEHOG, WHIRLWIND } from '../src/data/templates';
import { ARENA } from '../src/sim/arena';
import { Match } from '../src/sim/match';
import { computeStats } from '../src/sim/stats';
import { N, drive, run, spawnAt } from './helpers';

describe('templates', () => {
  test.each(TEMPLATES.map((t) => [t.name, t]))('%s is a legal heavyweight whose sim mass matches its bill of materials', (_, d) => {
    const stats = computeStats(d);
    expect(stats.mass).toBeLessThanOrEqual(100);
    const m = new Match([d], { skipCountdown: true });
    expect(m.robots[0].mass).toBeCloseTo(stats.mass, 0);
    m.free();
  });
});

describe('driving', () => {
  test('a robot left alone stays put', () => {
    const m = new Match([WEDGEHOG], { skipCountdown: true });
    run(m, 4);
    expect(Math.abs(m.robots[0].position.z + 3.5)).toBeLessThan(0.01);
    m.free();
  });

  test.each(TEMPLATES.map((t) => [t.name, t]))('%s reaches close to its predicted top speed', (_, d) => {
    const m = new Match([d], { skipCountdown: true });
    run(m, 0.3);
    run(m, 1.6, () => [drive(1)]);
    const v = m.robots[0].chassis.linvel();
    const predicted = computeStats(d).topSpeed;
    expect(Math.hypot(v.x, v.z)).toBeGreaterThan(predicted * 0.7);
    expect(Math.hypot(v.x, v.z)).toBeLessThan(predicted * 1.15);
    m.free();
  });

  test('opposite throttles turn on the spot, clockwise for left-forward', () => {
    const m = new Match([WEDGEHOG], { skipCountdown: true });
    run(m, 0.8, () => [drive(1, -1)]);
    expect(m.robots[0].chassis.angvel().y).toBeLessThan(-1);
    m.free();
  });
});

describe('weapons', () => {
  test('the flipper throws a 90 kg robot into the air, and uses gas doing it', () => {
    const m = new Match([FLIPSIDE, WEDGEHOG], { skipCountdown: true, spawns: spawnAt([0, 0, 0], [0, 1.25, Math.PI / 2]) });
    run(m, 0.4);
    run(m, 0.5, () => [drive(0.5), N]);
    let peak = 0;
    run(m, 1.5, (t) => [{ ...N, weapon: t < 1.2 }, N], () => { peak = Math.max(peak, m.robots[1].position.y); });
    expect(peak).toBeGreaterThan(0.3);
    expect(m.robots[0].flipperGas[0]).toBeLessThan(2000);
    m.free();
  });

  test('the spinner spins up towards its predicted speed', () => {
    const m = new Match([WHIRLWIND], { skipCountdown: true });
    run(m, 0.1, () => [{ ...N, weapon: true }]);
    run(m, 5);
    const predicted = computeStats(WHIRLWIND).weapons[0];
    if (predicted.kind !== 'spinner') throw new Error('expected spinner');
    expect(m.robots[0].spinnerRpm()[0]).toBeGreaterThan(predicted.numbers.maxRpm * 0.8);
    m.free();
  });

  test('a spun-up spinner driven into an opponent damages something', () => {
    const m = new Match([WHIRLWIND, WEDGEHOG], { skipCountdown: true, spawns: spawnAt([0, 0, 0], [0, 1.5, Math.PI / 2]) });
    const s = m.robots[0].spinners[0];
    s.on = true;
    s.body.setAngvel({ x: 0, y: 170, z: 0 }, true);
    run(m, 1.5, () => [drive(0.6), N]);
    const worst = Math.min(...m.robots[1].parts.map((p) => p.condition));
    expect(worst).toBeLessThan(1);
    expect(m.robots[0].spinnerRpm()[0]).toBeLessThan(1600); // hits cost the blade speed
    m.free();
  });
});

describe('rules', () => {
  test('a robot with a dead battery is counted out by the referee', () => {
    const m = new Match([WEDGEHOG, WEDGEHOG], { skipCountdown: true });
    m.robots[0].energy = 0;
    // The other robot keeps showing it's alive by turning on the spot.
    run(m, 15, () => [drive(1), drive(0.6, -0.6)]);
    expect(m.eliminated[0]).toBe('immobilised');
    expect(m.result?.winner).toBe(1);
    m.free();
  });

  test('shoving an opponent does not get you counted', () => {
    const m = new Match([WEDGEHOG, WEDGEHOG], { skipCountdown: true, spawns: spawnAt([0, 0, 0], [0, 1.2, Math.PI]) });
    run(m, 15, () => [drive(1), drive(1)]);
    expect(m.eliminated).toEqual([null, null]);
    m.free();
  });

  test('the pit button opens the pit and a robot driven in is out', () => {
    const { pit, pitButton } = ARENA;
    const m = new Match([WEDGEHOG, WEDGEHOG], {
      skipCountdown: true,
      spawns: spawnAt([pitButton.x, pitButton.z, 0], [pit.x, pit.z - 1.3, 0]),
    });
    run(m, 0.5);
    expect(m.arena.pitOpen).toBe(true);
    run(m, 4, () => [N, drive(0.7)]);
    expect(m.eliminated[1]).toBe('into the pit');
    m.free();
  });

  test('if both survive, the judges decide', () => {
    const m = new Match([WEDGEHOG, WEDGEHOG], { skipCountdown: true, duration: 5 });
    run(m, 5.5, () => [drive(0.6, 0.5), drive(0.5, 0.6)]);
    expect(m.result?.reason).toBe("Judges' decision");
    expect(m.result?.scores?.length).toBe(2);
    m.free();
  });
});
