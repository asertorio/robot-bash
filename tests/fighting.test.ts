import { describe, expect, test } from 'vitest';
import { GYRODISC, ORB } from '../src/data/examples';
import { HOUSE_ROBOTS } from '../src/data/house';
import { AXEMAN, ROSTER } from '../src/data/roster';
import { CRASH_TEST_DUMMY, FLIPSIDE, WEDGEHOG } from '../src/data/templates';
import { CpuDriver, WeaponOperator } from '../src/sim/ai';
import { cloneDesign } from '../src/sim/build';
import { Match } from '../src/sim/match';
import { convexPieces, pieceMassProps } from '../src/sim/shapes';
import { N, drive, run, spawnAt } from './helpers';

const worst = (m: Match, i: number) => Math.min(...m.robots[i].parts.map((p) => p.condition));

describe('impact damage', () => {
  test('a big landing shakes up the internals', () => {
    const m = new Match([FLIPSIDE], { skipCountdown: true, sandbox: true });
    for (const b of m.robots[0].bodies()) { const t = b.translation(); b.setTranslation({ x: t.x, y: t.y + 2, z: t.z }, true); }
    run(m, 2);
    const battery = m.robots[0].parts.find((p) => p.label === 'Battery')!;
    expect(battery.condition).toBeLessThan(0.9);
    expect(battery.condition).toBeGreaterThan(0.5);
    m.free();
  });

  test('ordinary driving, reversing and spinning hurt nothing', () => {
    const m = new Match([WEDGEHOG], { skipCountdown: true, sandbox: true });
    run(m, 6, (t) => [t < 2 ? drive(1) : t < 4 ? drive(-1) : drive(1, -1)]);
    expect(worst(m, 0)).toBe(1);
    m.free();
  });

  test('ramming at full speed does some damage to both robots', () => {
    const m = new Match([WEDGEHOG, CRASH_TEST_DUMMY], { skipCountdown: true, sandbox: true, spawns: spawnAt([0, -3, 0], [0, 1.5, Math.PI / 2]) });
    run(m, 2.5, () => [drive(1), N]);
    expect(worst(m, 0)).toBeLessThan(0.99);
    expect(worst(m, 1)).toBeLessThan(0.99);
    m.free();
  });

  test('landing damage after a throw counts for the thrower with the judges', () => {
    const m = new Match([FLIPSIDE, WEDGEHOG], { skipCountdown: true, duration: 5, spawns: spawnAt([0, 0, 0], [0, 1.2, Math.PI]) });
    // Wedgehog drives into Flipside; then it's thrown (lifted 2 m) and lands.
    run(m, 2.2, () => [N, drive(0.6)]);
    for (const b of m.robots[1].bodies()) { const t = b.translation(); b.setTranslation({ x: t.x, y: t.y + 2, z: t.z }, true); }
    run(m, 3.5);
    const [flipper, wedge] = m.result!.scores!;
    expect(flipper.damage).toBeGreaterThan(wedge.damage);
    m.free();
  });
});

describe('mass properties', () => {
  test('a very flat cone gets a sane inertia (the engine gets it badly wrong)', () => {
    const [piece] = convexPieces({ type: 'lathe', segments: 48, profile: [[0, 0.075], [0.26, 0.07], [0.26, 0.069], [0, 0.069]] });
    const mp = pieceMassProps(piece)!;
    expect(mp.com[0]).toBeCloseTo(0, 6);
    // A thin disc-like cone: Iy ≈ (3/10) r² … ½ r² per kg, never more than r².
    expect(mp.inertia[4]).toBeGreaterThan(0.3 * 0.26 ** 2 * 0.9);
    expect(mp.inertia[4]).toBeLessThan(0.26 ** 2);
  });

  test('a hull box matches the box formula', () => {
    const h = [0.2, 0.05, 0.3];
    const pts = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x * h[0], y * h[1], z * h[2]] as [number, number, number])));
    const mp = pieceMassProps({ kind: 'hull', points: pts })!;
    const [a, b, c] = h.map((v) => 2 * v);
    expect(mp.inertia[0]).toBeCloseTo((b * b + c * c) / 12, 6);
    expect(mp.inertia[4]).toBeCloseTo((a * a + c * c) / 12, 6);
    expect(mp.inertia[8]).toBeCloseTo((a * a + b * b) / 12, 6);
  });

  test("Gyrodisc's shell spins up without spinning the base round", () => {
    const m = new Match([GYRODISC], { skipCountdown: true, sandbox: true });
    run(m, 0.1, () => [{ ...N, weapon: true }]);
    run(m, 6);
    const r = m.robots[0];
    const shell = r.actuators.find((a) => a.driven.id === 'shell')!;
    expect(shell.child.body.principalInertia().y + shell.child.body.principalInertia().z).toBeLessThan(15);
    expect(Math.abs(r.chassis.angvel().y)).toBeLessThan(0.5);
    expect(r.rotors()[0].rpm).toBeGreaterThan(400);
    m.free();
  });

  test('soft start ramps a weapon up gently', () => {
    const hard = cloneDesign(GYRODISC);
    for (const p of hard.parts) if (p.joint.type === 'hinge' && p.joint.actuator?.type === 'motor') delete p.joint.actuator.softStart;
    const rpm = (d: typeof GYRODISC) => {
      const m = new Match([d], { skipCountdown: true, sandbox: true });
      run(m, 0.05, () => [{ ...N, weapon: true }]);
      run(m, 0.6);
      const out = m.robots[0].rotors()[0].rpm;
      m.free();
      return out;
    };
    expect(rpm(GYRODISC)).toBeLessThan(rpm(hard) * 0.5);
  });
});

describe('controllability', () => {
  test('Orb turns on the spot and stops when you let go', () => {
    const m = new Match([ORB], { skipCountdown: true, sandbox: true });
    run(m, 1);
    run(m, 1, () => [drive(0.7, -0.7)]);
    expect(Math.abs(m.robots[0].chassis.angvel().y)).toBeGreaterThan(3);
    run(m, 1);
    run(m, 1.5, () => [drive(1)]);
    const p = { ...m.robots[0].position };
    run(m, 2);
    const q = m.robots[0].position;
    expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeLessThan(0.8);
    expect(m.robots[0].uprightness).toBeGreaterThan(0.8);
    m.free();
  });

  test.each(ROSTER.map((d) => [d.name, d]))('%s drives forward', (_, d) => {
    const m = new Match([d], { skipCountdown: true, sandbox: true, spawns: spawnAt([0, -3, 0]) });
    run(m, 0.5);
    run(m, 1.5, () => [drive(1)]);
    expect(m.robots[0].position.z + 3).toBeGreaterThan(2);
    expect(m.robots[0].uprightness).toBeGreaterThan(0.9);
    m.free();
  });

  test('house robots can be driven as competitors', () => {
    const m = new Match([HOUSE_ROBOTS[0], WEDGEHOG], { skipCountdown: true, sandbox: true, spawns: spawnAt([0, -3, 0], [3, 3, 0]) });
    run(m, 0.5);
    run(m, 1.5, () => [drive(1), N]);
    expect(m.robots[0].position.z + 3).toBeGreaterThan(1.5);
    m.free();
  });
});

describe('CPU weapons', () => {
  test('the CPU fires its flipper with the opponent on it, and holds it for the whole stroke', () => {
    const m = new Match([FLIPSIDE, WEDGEHOG], { skipCountdown: true, sandbox: true, spawns: spawnAt([0, -0.5, 0], [0, 0.45, Math.PI]) });
    const cpu = new CpuDriver();
    let held = 0, peak = 0;
    run(m, 0.6, () => [N, drive(0.5)]);
    for (let t = 0; t < 1.5; t += 1 / 60) {
      const c = cpu.update(m.robots[0], m.robots[1], false, 1 / 60);
      if (c.weapon) held += 1 / 60;
      m.update(1 / 60, [{ ...c, left: 0, right: 0 }, N]);
      peak = Math.max(peak, m.robots[1].position.y);
    }
    expect(held).toBeGreaterThan(0.3);
    expect(peak).toBeGreaterThan(0.5);
    m.free();
  });

  test("the CPU doesn't waste a shot on someone out of reach", () => {
    const m = new Match([FLIPSIDE, WEDGEHOG], { skipCountdown: true, sandbox: true, spawns: spawnAt([0, -2, 0], [0, 1, Math.PI]) });
    const op = new WeaponOperator();
    run(m, 0.3);
    expect(op.wouldHit(m.robots[0], m.robots[1], 'button1')).toBe(false);
    m.free();
  });

  test("an axe sees a target in front as in reach, even though it's nowhere near it at rest", () => {
    const m = new Match([AXEMAN, CRASH_TEST_DUMMY], { skipCountdown: true, sandbox: true, spawns: spawnAt([0, -0.7, 0], [0, 0.1, Math.PI / 2]) });
    run(m, 0.5);
    expect(new WeaponOperator().wouldHit(m.robots[0], m.robots[1], 'button1')).toBe(true);
    m.free();
  });
});
