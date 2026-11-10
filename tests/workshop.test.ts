import { describe, expect, test } from 'vitest';
import { BEARHUG, BELLRINGER, CONKER, FLIPFLOP, HAYMAKER, LIMPET, WHIPPET, WHISK, WORKSHOP } from '../src/data/workshop';
import { CRASH_TEST_DUMMY, TEMPLATES, WEDGEHOG } from '../src/data/templates';
import { CpuDriver } from '../src/sim/ai';
import { ARENA } from '../src/sim/arena';
import type { RobotDesign } from '../src/sim/design';
import { Match } from '../src/sim/match';
import { scrutineer } from '../src/sim/rules';
import { computeStats } from '../src/sim/stats';
import { qaxis, qconj, qrotate, vsub } from '../src/sim/vmath';
import { N, drive, run, spawnAt } from './helpers';

const worst = (m: Match, i: number) => Math.min(...m.robots[i].parts.map((p) => p.condition));
const on = (b1 = true, b2 = false) => ({ ...N, weapon: b1, weapon2: b2 });

describe('workshop robots', () => {
  test.each(WORKSHOP.map((d) => [d.name, d]))('%s passes heavyweight scrutineering', (_, d) => {
    expect(scrutineer(d).filter((i) => i.level === 'error')).toEqual([]);
  });

  test('every one has its own name and colour', () => {
    for (const d of WORKSHOP) {
      expect(TEMPLATES.filter((t) => t.name === d.name || t.id === d.id)).toHaveLength(1);
      expect(TEMPLATES.filter((t) => t.colour === d.colour)).toHaveLength(1);
    }
  });

  test.each(WORKSHOP.map((d) => [d.name, d]))('%s drives forward and stays upright', (_, d) => {
    const m = new Match([d], { skipCountdown: true, sandbox: true, spawns: spawnAt([0, -3, 0]) });
    run(m, 0.5);
    run(m, 2, () => [drive(1)]);
    expect(m.robots[0].position.z + 3).toBeGreaterThan(1);
    expect(Math.abs(m.robots[0].position.x)).toBeLessThan(0.5);
    expect(m.robots[0].uprightness).toBeGreaterThan(0.95);
    m.free();
  });

  // Each against a CPU Wedgehog: nothing explodes and nothing flies off.
  test.each(WORKSHOP.map((d) => [d.name, d]))('%s fights a CPU without anything going wrong', (_, d: RobotDesign) => {
    const m = new Match([d, WEDGEHOG], { skipCountdown: true, duration: 30 });
    const cpus = [new CpuDriver(), new CpuDriver()];
    let top = 0, fastest = 0;
    for (let t = 0; t < 5; t += 1 / 60) {
      const c = [cpus[0].update(m.robots[0], m.robots[1], m.arena.pitOpen, 1 / 60), cpus[1].update(m.robots[1], m.robots[0], m.arena.pitOpen, 1 / 60)];
      for (let k = 0; k < 8; k++) m.update(1 / 480, c);
      for (const b of m.robots[0].bodies()) {
        const p = b.translation(), v = b.linvel();
        top = Math.max(top, p.y);
        fastest = Math.max(fastest, Math.hypot(v.x, v.y, v.z));
      }
    }
    // The CPU backs out of stalemates at random, so allow for the floor
    // flipper or a big hit — but nothing should be launched into orbit.
    expect(Number.isFinite(top)).toBe(true);
    expect(top).toBeLessThan(2.5);
    // Spinner teeth and flails move fast; nothing should be anywhere near a bullet.
    expect(fastest).toBeLessThan(80);
    const p = m.robots[0].position;
    expect(Math.max(Math.abs(p.x), Math.abs(p.z))).toBeLessThan(ARENA.outerHalf);
    m.free();
  });
});

describe('workshop weapons', () => {
  test("Bellringer's bell winds up without spinning its base round, and rings a dummy", () => {
    const m = new Match([BELLRINGER, CRASH_TEST_DUMMY], { skipCountdown: true, sandbox: true, spawns: spawnAt([0, -1.6, 0], [0, 0, Math.PI / 2]) });
    run(m, 0.05, () => [on(), N]);
    run(m, 6);
    expect(m.robots[0].rotors()[0].rpm).toBeGreaterThan(600);
    expect(Math.abs(m.robots[0].chassis.angvel().y)).toBeLessThan(0.5);
    run(m, 2, () => [drive(0.6), N]);
    expect(worst(m, 1)).toBeLessThan(0.97);
    expect(Math.hypot(m.robots[1].position.x, m.robots[1].position.z)).toBeGreaterThan(0.5);
    m.free();
  });

  test("Whisk's beater gets to speed and hurts what it hits", () => {
    const m = new Match([WHISK, CRASH_TEST_DUMMY], { skipCountdown: true, sandbox: true, spawns: spawnAt([0, -1.6, 0], [0, 0, Math.PI / 2]) });
    run(m, 0.05, () => [on(), N]);
    run(m, 4);
    expect(m.robots[0].rotors()[0].rpm).toBeGreaterThan(0.75 * computeStats(WHISK).weapons[0].maxRpm!);
    run(m, 2, () => [drive(0.6), N]);
    expect(worst(m, 1)).toBeLessThan(0.95);
    expect(m.robots[0].uprightness).toBeGreaterThan(0.9);
    m.free();
  });

  test('Flipflop throws a robot from either end, and drives upside down', () => {
    for (const [end, s, button] of [['front', 1, on(true)], ['rear', -1, on(false, true)]] as const) {
      // Drive (or back) up to a robot until it's on the plate at that end, then fire.
      const m = new Match([FLIPFLOP, WEDGEHOG], { skipCountdown: true, sandbox: true, spawns: spawnAt([0, 0, 0], [0, 1.2 * s, Math.PI / 2]) });
      run(m, 0.4);
      run(m, 0.5, () => [drive(0.5 * s), N]);
      let peak = 0;
      run(m, 1.2, (t) => [t < 1.4 ? button : N, N], () => { peak = Math.max(peak, m.robots[1].position.y); });
      expect(peak, end).toBeGreaterThan(0.3);
      m.free();
    }
    const m = new Match([FLIPFLOP], { skipCountdown: true, sandbox: true, spawns: [{ pos: { x: 0, y: 0.27, z: -3 }, yaw: 0 }] });
    const r = m.robots[0];
    const flip = qaxis({ x: 0, y: 0, z: 1 }, Math.PI);
    for (const b of r.bodies()) { const t = b.translation(); b.setTranslation({ x: -t.x, y: 0.25 - (t.y - 0.27), z: t.z }, true); b.setRotation(flip, true); }
    run(m, 1);
    const start = r.position.z;
    run(m, 1.5, () => [drive(1)]);
    expect(r.uprightness).toBeLessThan(-0.9);
    expect(Math.abs(r.position.z - start)).toBeGreaterThan(1.5);
    m.free();
  });

  test('Whippet is half the weight of a heavyweight and the fastest robot in the box', () => {
    const stats = computeStats(WHIPPET);
    expect(stats.mass).toBeLessThan(50);
    for (const t of TEMPLATES) if (t !== WHIPPET) expect(computeStats(t).topSpeed ?? 0).toBeLessThan(stats.topSpeed!);
    const m = new Match([WHIPPET], { skipCountdown: true, sandbox: true, spawns: spawnAt([0, -4, 0]) });
    run(m, 0.3);
    run(m, 1.4, () => [drive(1)]);
    const v = m.robots[0].chassis.linvel();
    expect(Math.hypot(v.x, v.z)).toBeGreaterThan(5.5);
    m.free();
  });

  test("Haymaker's arm sweeps across the nose and knocks a robot off its line", () => {
    const m = new Match([HAYMAKER, CRASH_TEST_DUMMY], { skipCountdown: true, sandbox: true, spawns: spawnAt([0, 0, 0], [0, 0.9, Math.PI / 2]) });
    run(m, 0.5);
    const arm = m.robots[0].actuators.find((a) => a.driven.id === 'arm')!;
    run(m, 0.6, () => [on(), N]);
    expect(arm.position).toBeGreaterThan((100 * Math.PI) / 180);
    const d = m.robots[1].position;
    expect(Math.hypot(d.x, d.z - 0.9)).toBeGreaterThan(0.4);
    expect(m.biggestHit?.parts).toMatch(/hammer/i);
    m.free();
  });

  test("Conker's balls hang at rest and fly out when it spins", () => {
    const m = new Match([CONKER], { skipCountdown: true, sandbox: true });
    const r = m.robots[0];
    const balls = () => r.parts.filter((p) => /^ball-\d$/.test(p.id)).map((p) => {
      const b = r.collidersOf(p)[0].translation();
      return { reach: Math.hypot(b.x - r.position.x, b.z - r.position.z), y: b.y };
    });
    run(m, 1);
    for (const b of balls()) expect(b.y).toBeLessThan(0.1);
    run(m, 0.05, () => [on()]);
    run(m, 4);
    expect(r.rotors()[0].rpm).toBeGreaterThan(300);
    for (const b of balls()) {
      expect(b.reach).toBeGreaterThan(0.4);
      expect(b.y).toBeGreaterThan(0.12);
    }
    expect(r.uprightness).toBeGreaterThan(0.95);
    m.free();
  });

  test('Limpet gets under a wedge whichever way it is facing', () => {
    for (const yaw of [0, Math.PI / 2, Math.PI]) {
      const m = new Match([LIMPET, WEDGEHOG], { skipCountdown: true, sandbox: true, spawns: spawnAt([0, 0, yaw], [0, -1.6, 0]) });
      run(m, 0.3);
      const y0 = m.robots[1].position.y;
      let peak = 0;
      run(m, 2.2, () => [N, drive(1)], () => { peak = Math.max(peak, m.robots[1].position.y); });
      expect(peak - y0).toBeGreaterThan(0.025);
      expect(m.robots[0].uprightness).toBeGreaterThan(0.95);
      m.free();
    }
  });

  test('Bearhug holds on to what it hugs: it turns and backs away with it', () => {
    const after = (hug: boolean) => {
      const m = new Match([BEARHUG, CRASH_TEST_DUMMY], { skipCountdown: true, sandbox: true, spawns: spawnAt([0, -0.6, 0], [0, 0.85, Math.PI / 2]) });
      run(m, 1.6, () => [drive(0.5), N]);
      run(m, 0.6, () => [{ ...drive(0.3), weapon: hug }, N]);
      run(m, 1.5, () => [{ ...drive(0.6, -0.6), weapon: hug }, N]);
      run(m, 1.5, () => [{ ...drive(-1), weapon: hug }, N]);
      const rel = qrotate(qconj(m.robots[0].rotation), vsub(m.robots[1].position, m.robots[0].position));
      m.free();
      return Math.hypot(rel.x, rel.z);
    };
    expect(after(true)).toBeLessThan(1.3);
    expect(after(false)).toBeGreaterThan(2.5);
  });
});
