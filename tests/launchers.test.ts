import { describe, expect, test } from 'vitest';
import { BOMBARD, WHALER } from '../src/data/launchers';
import { WEDGEHOG } from '../src/data/templates';
import { checkDesign } from '../src/data/garage';
import { Match } from '../src/sim/match';
import { WEIGHT_CLASSES, BUDGETS, isLegal, scrutineer } from '../src/sim/rules';
import { computeStats } from '../src/sim/stats';
import { WeaponOperator } from '../src/sim/ai';
import { N, drive, run, spawnAt } from './helpers';

const fire = { ...N, weapon: true };
const winch = { ...N, weapon2: true };
const open = { weight: WEIGHT_CLASSES.find((c) => c.id === 'open')!, budget: BUDGETS[0] };

describe('cannon', () => {
  test('free-flying rounds are Open class only; its mass matches its parts list, spares and all', () => {
    expect(scrutineer(BOMBARD).some((i) => i.level === 'error' && /projectiles are banned/.test(i.text))).toBe(true);
    expect(isLegal(scrutineer(BOMBARD, open))).toBe(true);
    const m = new Match([BOMBARD, WEDGEHOG], { skipCountdown: true });
    expect(m.robots[0].mass).toBeCloseTo(computeStats(BOMBARD).mass, 1);
    m.free();
  });

  test('a shot leaves at the speed the ram gives it, kicks the robot back, and the next round loads', () => {
    const m = new Match([BOMBARD, WEDGEHOG], { skipCountdown: true, spawns: spawnAt([0, -2, 0], [3, 3, 0]) });
    const r = m.robots[0];
    const l = r.launchers[0];
    const mass0 = r.mass, gas0 = r.gasLeft;
    let muzzle = 0;
    run(m, 0.25, () => [fire, N], () => { for (const f of l.fired) muzzle = Math.max(muzzle, f.info.body.linvel().z); });
    // Ram work ÷ round mass bounds it; the valve's opening time costs some.
    const bound = Number(/at up to (\d+) m\/s/.exec(computeStats(BOMBARD).weapons[0].lines[0])![1]);
    expect(muzzle).toBeGreaterThan(0.55 * bound);
    expect(muzzle).toBeLessThan(bound);
    expect(r.chassis.linvel().z).toBeLessThan(-0.2); // recoil
    expect(r.roundsLeft(l)).toBe(7);
    expect(r.gasLeft).toBeLessThan(gas0);
    expect(r.mass).toBeLessThan(mass0 - 2);
    run(m, 1.5, () => [N, N]);
    expect(l.loaded).not.toBeNull();
    expect(r.roundsLeft(l)).toBe(7);
    m.free();
  });

  test('a cannonball shoves a robot it hits square on', () => {
    // Side-on: a flat aluminium flank, no wedge to deflect it.
    const m = new Match([BOMBARD, WEDGEHOG], { skipCountdown: true, spawns: spawnAt([0, -2, 0], [0, 0.5, Math.PI / 2]) });
    m.robots[1].energy = 0;
    let peak = 0;
    run(m, 0.5, () => [fire, N], () => { peak = Math.max(peak, m.robots[1].chassis.linvel().z); });
    expect(peak).toBeGreaterThan(0.3);
    m.free();
  });
});

describe('harpoon', () => {
  test('sticks into aluminium plate but glances off a hardened wedge', () => {
    const side = new Match([WHALER, WEDGEHOG], { skipCountdown: true, spawns: spawnAt([0, -2, 0], [0, 1, Math.PI / 2]) });
    run(side, 0.3, () => [fire, N]);
    expect(side.robots[0].launchers[0].cable?.round.embed).toBeTruthy();
    expect(side.commentary.some((c) => /harpooned/.test(c.text))).toBe(true);
    side.free();
    const front = new Match([WHALER, WEDGEHOG], { skipCountdown: true, spawns: spawnAt([0, -2, 0], [0, 1, Math.PI]) });
    run(front, 0.3, () => [fire, N]);
    expect(front.robots[0].launchers[0].cable?.round.embed ?? null).toBeNull();
    front.free();
  });

  test('the winch drags what it has harpooned', () => {
    const m = new Match([WHALER, WEDGEHOG], { skipCountdown: true, spawns: spawnAt([0, -2, 0], [0, 1, Math.PI / 2]) });
    m.robots[1].energy = 0;
    run(m, 0.3, () => [fire, N]);
    const z0 = m.robots[1].position.z;
    run(m, 3, () => [{ ...winch, left: -1, right: -1 }, N]);
    expect(z0 - m.robots[1].position.z).toBeGreaterThan(1);
    m.free();
  });

  test('a miss reels back into the barrel and fires again; a second press cuts the cable', () => {
    const m = new Match([WHALER, WEDGEHOG], { skipCountdown: true, spawns: spawnAt([0, -3, 0], [4, 3, 0]) });
    const r = m.robots[0];
    const l = r.launchers[0];
    run(m, 0.3, () => [fire, N]);
    expect(l.loaded).toBeNull();
    expect(l.cable).not.toBeNull();
    run(m, 1, () => [N, N]); // let it land
    run(m, 12, () => [winch, N]);
    expect(l.loaded).not.toBeNull();
    expect(l.cable).toBeNull();
    run(m, 0.3, () => [fire, N]);
    expect(l.cable).not.toBeNull();
    run(m, 0.1, () => [N, N]);
    run(m, 0.1, () => [fire, N]);
    expect(l.cable).toBeNull();
    expect(l.loaded).toBeNull();
    m.free();
  });
});

describe('launchers', () => {
  test('a CPU fires when its target is lined up and in range', () => {
    const m = new Match([WHALER, WEDGEHOG], { skipCountdown: true, spawns: spawnAt([0, -2, 0], [0, 1.5, Math.PI / 2]) });
    const op = new WeaponOperator();
    run(m, 0.5, () => [op.update(m.robots[0], [m.robots[1]], drive(0), 1 / 480), N]);
    expect(m.robots[0].launchers[0].loaded).toBeNull();
    m.free();
  });

  test('saved designs with a broken launcher are refused', () => {
    const bad = JSON.parse(JSON.stringify(WHALER));
    bad.parts.find((p: { id: string }) => p.id === 'harpoon').joint = { type: 'hinge', axis: [1, 0, 0] };
    expect(() => checkDesign(bad)).toThrow(/slider driven by a pneumatic ram/);
    const many = JSON.parse(JSON.stringify(BOMBARD));
    many.parts.find((p: { id: string }) => p.id === 'ball').launch.rounds = -3;
    expect(() => checkDesign(many)).toThrow(/spare rounds/);
    expect(checkDesign(JSON.parse(JSON.stringify(WHALER))).parts.some((p) => p.launch?.tether?.winch)).toBe(true);
  });
});
