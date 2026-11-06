import { describe, expect, test } from 'vitest';
import { ARSENAL, BRICKHOUSE, LUMBERJACK, TAILSPIN, VICEGRIP } from '../src/data/arsenal';
import { MAELSTROM, MONSTER_HOUSE } from '../src/data/house';
import { CRASH_TEST_DUMMY, WEDGEHOG } from '../src/data/templates';
import { CpuDriver, WeaponOperator } from '../src/sim/ai';
import { cloneDesign } from '../src/sim/build';
import { cutRatio, edgeFactor, impactShare, pierceForce } from '../src/sim/damage';
import type { RobotDesign } from '../src/sim/design';
import { Match } from '../src/sim/match';
import { isLegal, scrutineer } from '../src/sim/rules';
import { computeStats } from '../src/sim/stats';
import { qaxis } from '../src/sim/vmath';
import { N, drive, run, spawnAt } from './helpers';

/** The crash-test dummy, rebuilt in another material. */
function dummyOf(materialId: string): RobotDesign {
  const d = cloneDesign(CRASH_TEST_DUMMY);
  d.id = `dummy-${materialId}`;
  for (const p of d.parts) if (p.role === 'structure') p.material = materialId;
  return d;
}

const body = (m: Match, i: number) => m.robots[i].parts.find((p) => p.id === 'body')!.condition;

describe('materials and edges', () => {
  test('a hard edge bites deeper into soft plate, and hardly marks hard plate', () => {
    expect(edgeFactor('blade', 'hardox', 'aluminium')).toBeGreaterThan(3 * edgeFactor('blade', 'hardox', 'hardox') * 0.9);
    expect(edgeFactor('blade', 'aluminium', 'hardox')).toBeLessThan(edgeFactor('blunt', 'aluminium', 'aluminium'));
    expect(edgeFactor('spike', 'hardox', 'mildSteel')).toBeGreaterThan(edgeFactor('blade', 'hardox', 'mildSteel'));
    // Equal blunt plates share an impact evenly; softer takes more.
    expect(impactShare('aluminium', 'aluminium')).toBeCloseTo(0.5);
    expect(impactShare('aluminium', 'hardox')).toBeGreaterThan(0.6);
  });

  test('saws cut soft materials far faster than hardened steel', () => {
    expect(cutRatio('hardox', 'aluminium')).toBeGreaterThan(3);
    expect(cutRatio('hardox', 'hardox')).toBeCloseTo(1);
    expect(cutRatio('aluminium', 'hardox')).toBeLessThan(0.3);
  });

  test('thicker and stronger plate takes more force to pierce', () => {
    expect(pierceForce('aluminium', 6)).toBeLessThan(pierceForce('mildSteel', 8));
    expect(pierceForce('hardox', 6)).toBeGreaterThan(4 * pierceForce('aluminium', 6));
  });

  test('a chainsaw goes through mild steel, and much more slowly through hardened steel', () => {
    const cut = (target: RobotDesign) => {
      const m = new Match([LUMBERJACK, target], { skipCountdown: true, sandbox: true, spawns: spawnAt([0, -0.75, 0], [0, -0.1, Math.PI / 2]) });
      run(m, 0.3, () => [{ ...N, weapon2: true }, N]);
      run(m, 0.3);
      run(m, 4, () => [{ ...N, weapon: true }, N]);
      expect(m.robots[0].chains[0].on).toBe(true);
      const left = body(m, 1);
      m.free();
      return 1 - left;
    };
    const steel = cut(CRASH_TEST_DUMMY);
    const hard = cut(dummyOf('hardox'));
    expect(steel).toBeGreaterThan(0.3);
    expect(hard).toBeLessThan(steel * 0.5);
  }, 30000);
});

describe('hydraulic crusher', () => {
  test('needs no gas bottle and never runs out', () => {
    expect(isLegal(scrutineer(VICEGRIP))).toBe(true);
    expect(VICEGRIP.parts.some((p) => p.component?.type === 'gasTank')).toBe(false);
    expect(computeStats(VICEGRIP).weapons[0].shots).toBeUndefined();
    const m = new Match([VICEGRIP], { skipCountdown: true, sandbox: true });
    const beak = m.robots[0].actuators.find((a) => a.driven.id === 'beak')!;
    for (let i = 0; i < 12; i++) {
      run(m, 1.2, () => [{ ...N, weapon: true }]);
      expect(beak.position).toBeGreaterThan(0.8);
      run(m, 1.2);
    }
    m.free();
  }, 30000);

  test('its point goes through mild steel under steady pressure, but not hardened steel', () => {
    const crush = (target: RobotDesign) => {
      const m = new Match([VICEGRIP, target], { skipCountdown: true, sandbox: true, spawns: [{ pos: { x: 0, y: 0.01, z: -0.7 }, yaw: 0 }, { pos: { x: 0, y: 0.12, z: -0.12 }, yaw: Math.PI / 2 }] });
      run(m, 0.5);
      run(m, 3, () => [{ ...N, weapon: true }, N]);
      const left = body(m, 1);
      m.free();
      return 1 - left;
    };
    expect(crush(CRASH_TEST_DUMMY)).toBeGreaterThan(0.1);
    expect(crush(dummyOf('hardox'))).toBeLessThan(0.02);
  });

  test('the CPU only fires a slow crusher when there is something under the beak', () => {
    const op = new WeaponOperator();
    const near = new Match([VICEGRIP, CRASH_TEST_DUMMY], { skipCountdown: true, sandbox: true, spawns: [{ pos: { x: 0, y: 0.01, z: -0.7 }, yaw: 0 }, { pos: { x: 0, y: 0.12, z: -0.12 }, yaw: Math.PI / 2 }] });
    run(near, 0.5);
    expect(op.wouldHit(near.robots[0], near.robots[1], 'button1')).toBe(true);
    near.free();
    const far = new Match([VICEGRIP, CRASH_TEST_DUMMY], { skipCountdown: true, sandbox: true, spawns: spawnAt([0, -0.7, 0], [0, 0.6, Math.PI / 2]) });
    run(far, 0.5);
    expect(op.wouldHit(far.robots[0], far.robots[1], 'button1')).toBe(false);
    far.free();
  });
});

describe('new robots', () => {
  test.each(ARSENAL.map((d) => [d.name, d]))('%s passes heavyweight scrutineering', (_, d) => {
    expect(scrutineer(d).filter((i) => i.level === 'error')).toEqual([]);
  });

  test.each([...ARSENAL, ...MONSTER_HOUSE].map((d) => [d.name, d]))('%s drives forward', (_, d) => {
    const m = new Match([d], { skipCountdown: true, sandbox: true, spawns: spawnAt([0, -3, 0]) });
    run(m, 0.5);
    run(m, 2, () => [drive(1)]);
    expect(m.robots[0].position.z + 3).toBeGreaterThan(1);
    expect(m.robots[0].uprightness).toBeGreaterThan(0.9);
    m.free();
  });

  test("Brickhouse's wheels are inside its body, and it drives upside down", () => {
    const shell = BRICKHOUSE.parts.find((p) => p.id === 'body')!;
    const half = (shell.shape as { size: number[] }).size[0] / 2;
    for (const w of BRICKHOUSE.parts.filter((p) => p.role === 'wheel')) expect(Math.abs(w.position[0]) + 0.04).toBeLessThan(half);
    const m = new Match([BRICKHOUSE], { skipCountdown: true, sandbox: true, spawns: [{ pos: { x: 0, y: 0.27, z: -3 }, yaw: 0 }] });
    const r = m.robots[0];
    const flip = qaxis({ x: 0, y: 0, z: 1 }, Math.PI);
    for (const b of r.bodies()) { const t = b.translation(); b.setTranslation({ x: -t.x, y: 0.25 - (t.y - 0.27), z: t.z }, true); b.setRotation(flip, true); }
    run(m, 1);
    const start = r.position.z;
    run(m, 1.5, () => [drive(1)]);
    expect(r.uprightness).toBeLessThan(-0.9);
    // Upside down the drive reverses, as in real life — but it moves.
    expect(Math.abs(r.position.z - start)).toBeGreaterThan(1.5);
    m.free();
  });

  test('Tailspin whips round on the spot, and the CPU spins it when it is close', () => {
    const m = new Match([TAILSPIN, CRASH_TEST_DUMMY], { skipCountdown: true, sandbox: true, spawns: spawnAt([0, 0, 0], [0, 1.3, 0]) });
    run(m, 0.5);
    const cpu = new CpuDriver();
    const c = cpu.update(m.robots[0], m.robots[1], false, 1 / 60);
    expect(Math.sign(c.left)).toBe(-Math.sign(c.right));
    run(m, 2.5, () => [drive(1, -1), N]);
    expect(Math.abs(m.robots[0].chassis.angvel().y)).toBeGreaterThan(9);
    m.free();
  });

  test("Maelstrom's shell winds up without spinning its base round", () => {
    const m = new Match([MAELSTROM], { skipCountdown: true, sandbox: true });
    run(m, 0.05, () => [{ ...N, weapon: true }]);
    run(m, 8);
    expect(m.robots[0].rotors()[0].rpm).toBeGreaterThan(200);
    expect(Math.abs(m.robots[0].chassis.angvel().y)).toBeLessThan(0.5);
    m.free();
  });
});

describe('the referee and the finale', () => {
  const noseToNose = (breaks: boolean) => {
    const m = new Match([WEDGEHOG, WEDGEHOG], { skipCountdown: true, duration: 60, breaks, spawns: spawnAt([0, -0.55, 0], [0, 0.55, Math.PI]) });
    run(m, 12, () => [drive(1), drive(1)]);
    const broke = m.commentary.some((c) => c.text.startsWith('Stalemate'));
    m.free();
    return broke;
  };

  test('two robots shoving nose to nose get pulled apart', () => {
    expect(noseToNose(true)).toBe(true);
    expect(noseToNose(false)).toBe(false);
  }, 30000);

  test('the finale opens the pit for the last 30 seconds', () => {
    const m = new Match([WEDGEHOG, CRASH_TEST_DUMMY], { skipCountdown: true, duration: 32, finale: true, spawns: spawnAt([-3, 0, 0], [3, 0, 0]) });
    run(m, 1);
    expect(m.arena.pitOpen).toBe(false);
    run(m, 1.5);
    expect(m.finaleStarted).toBe(true);
    expect(m.arena.pitOpen).toBe(true);
    m.free();
  });

  test('brutal damage hurts more', () => {
    const hit = (damageScale: number) => {
      const m = new Match([WEDGEHOG, CRASH_TEST_DUMMY], { skipCountdown: true, sandbox: true, damageScale, spawns: spawnAt([0, -3, 0], [0, 1.5, Math.PI / 2]) });
      run(m, 2.5, () => [drive(1), N]);
      const worst = Math.min(...m.robots[1].parts.map((p) => p.condition));
      m.free();
      return 1 - worst;
    };
    expect(hit(2)).toBeGreaterThan(hit(1) * 1.5);
  });
});
