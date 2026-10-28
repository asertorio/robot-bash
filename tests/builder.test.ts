import { describe, expect, test } from 'vitest';
import { EXAMPLES, ARACHNID, GYRODISC, ORB, TWIN_TERROR } from '../src/data/examples';
import { checkDesign, parseDesign } from '../src/data/garage';
import { CRASH_TEST_DUMMY, FLIPSIDE, TEMPLATES } from '../src/data/templates';
import { treeErrors } from '../src/sim/assembly';
import { NEW_PART_KINDS, blankDesign, cloneDesign, mirrorPart, newParts, removePart, validParents } from '../src/sim/build';
import { Match } from '../src/sim/match';
import { BUDGETS, WEIGHT_CLASSES, isLegal, scrutineer } from '../src/sim/rules';
import { N, drive, run } from './helpers';

const heavy = { weight: WEIGHT_CLASSES.find((c) => c.id === 'heavy')!, budget: BUDGETS[0] };

describe('scrutineering', () => {
  test.each(TEMPLATES.map((t) => [t.name, t]))('%s passes as a heavyweight', (_, d) => {
    expect(scrutineer(d, heavy).filter((i) => i.level === 'error')).toEqual([]);
  });

  test('a heavyweight fails as a middleweight, and over a tight budget', () => {
    const issues = scrutineer(FLIPSIDE, { weight: WEIGHT_CLASSES.find((c) => c.id === 'middle')!, budget: BUDGETS.find((b) => b.id === 'b1500')! });
    expect(issues.filter((i) => i.level === 'error').map((i) => i.text).join(' ')).toMatch(/over the middleweight limit.*over the £1,500 budget/);
  });

  test('parts below the floor are rejected', () => {
    const d = cloneDesign(FLIPSIDE);
    d.parts[0].position[1] = 0.05;
    expect(scrutineer(d, heavy).some((i) => i.level === 'error' && /below the floor/.test(i.text))).toBe(true);
  });

  test('pneumatics without gas, and no battery, are rejected', () => {
    const d = cloneDesign(FLIPSIDE);
    d.parts = d.parts.filter((p) => p.component?.type !== 'gasTank' && p.component?.type !== 'battery');
    const errors = scrutineer(d, heavy).filter((i) => i.level === 'error').map((i) => i.text).join(' ');
    expect(errors).toMatch(/no gas bottle/);
    expect(errors).toMatch(/No battery/);
  });

  test('a broken tree is reported, not crashed on', () => {
    const d = cloneDesign(FLIPSIDE);
    d.parts[1].parent = 'nowhere';
    expect(treeErrors(d).length).toBeGreaterThan(0);
    expect(isLegal(scrutineer(d, heavy))).toBe(false);
  });
});

describe('builder operations', () => {
  test('a blank chassis is legal and drives', () => {
    const d = blankDesign();
    expect(scrutineer(d, heavy).filter((i) => i.level === 'error')).toEqual([]);
    const m = new Match([d], { skipCountdown: true });
    run(m, 0.3);
    const z = m.robots[0].position.z;
    run(m, 1.5, () => [drive(1)]);
    expect(m.robots[0].position.z - z).toBeGreaterThan(1);
    m.free();
  });

  test.each(NEW_PART_KINDS.map(([k, label]) => [label, k]))('adding a %s builds into a working robot', (_, kind) => {
    const d = blankDesign();
    d.parts.push(...newParts(d, kind, 'chassis'));
    if (!d.parts.some((p) => p.component?.type === 'gasTank')) d.parts.push(...newParts(d, 'gasTank', 'chassis'));
    expect(treeErrors(d)).toEqual([]);
    const m = new Match([d, CRASH_TEST_DUMMY], { sandbox: true, skipCountdown: true });
    run(m, 1, () => [{ ...drive(0.3), weapon: true, weapon2: true }]);
    expect(Number.isFinite(m.robots[0].position.y)).toBe(true);
    m.free();
  });

  test('mirroring a wheel puts it on the other side, wired to the other drive channel', () => {
    const d = blankDesign();
    const left = d.parts.find((p) => p.role === 'wheel' && p.position[0] > 0)!;
    const [copy] = mirrorPart(d, left.id);
    expect(copy.position[0]).toBeCloseTo(-left.position[0]);
    expect(copy.joint.type === 'hinge' && copy.joint.actuator?.input.source).toBe('right');
  });

  test('removing a part removes everything attached to it; parts cannot be moved onto their own children', () => {
    const d = blankDesign();
    d.parts.push(...newParts(d, 'axe', 'chassis'));
    const arm = d.parts.find((p) => p.label === 'Axe arm')!;
    expect(validParents(d, arm.id).some((p) => p.label === 'Axe head')).toBe(false);
    removePart(d, arm.id);
    expect(d.parts.some((p) => p.label === 'Axe head')).toBe(false);
  });
});

describe('anything goes', () => {
  test.each(EXAMPLES.map((e) => [e.name, e]))('%s is a legal heavyweight', (_, d) => {
    expect(scrutineer(d, heavy).filter((i) => i.level === 'error')).toEqual([]);
  });

  test('Twin Terror fires its two flippers independently', () => {
    const m = new Match([TWIN_TERROR], { skipCountdown: true, sandbox: true });
    run(m, 0.5);
    run(m, 0.4, () => [{ ...N, weapon: true }]);
    const [l, r] = m.robots[0].actuators.filter((a) => a.def.type === 'pneumatic');
    expect(l.position).toBeGreaterThan(0.5);
    expect(r.position).toBeLessThan(0.1);
    m.free();
  });

  test('Orb rolls forward and stays the right way up inside', () => {
    const m = new Match([ORB], { skipCountdown: true, sandbox: true });
    run(m, 1);
    const z = m.robots[0].position.z;
    run(m, 3, () => [drive(1)]);
    expect(m.robots[0].position.z - z).toBeGreaterThan(1.5);
    expect(m.robots[0].uprightness).toBeGreaterThan(0.8);
    m.free();
  });

  test('Arachnid walks forward on its legs', () => {
    const m = new Match([ARACHNID], { skipCountdown: true, sandbox: true });
    run(m, 1);
    const z = m.robots[0].position.z;
    run(m, 3, () => [drive(1)]);
    expect(m.robots[0].position.z - z).toBeGreaterThan(0.5);
    expect(m.robots[0].uprightness).toBeGreaterThan(0.9);
    m.free();
  });

  test('Gyrodisc spins its whole shell up', () => {
    const m = new Match([GYRODISC], { skipCountdown: true, sandbox: true });
    run(m, 0.1, () => [{ ...N, weapon: true }]);
    run(m, 6);
    expect(m.robots[0].rotors()[0].rpm).toBeGreaterThan(400);
    m.free();
  });
});

describe('saving and sharing', () => {
  test('a design survives a JSON round trip', () => {
    expect(parseDesign(JSON.stringify(ARACHNID))).toEqual(ARACHNID);
  });

  test('old v1 saves are upgraded on load', () => {
    const v1 = { schema: 1, id: 'old', name: 'Old Bot', description: '', colour: '#ff0000',
      shell: [{ id: 'body', label: 'Body', shape: 'box', size: [0.5, 0.2, 0.6], position: [0, 0.13, 0], material: 'aluminium', thickness: 5 }],
      skids: [], drive: { motor: 'dm750', motorsPerSide: 1, gearRatio: 9, motorPosition: [0.15, 0.1, 0], wheels: [
        { wheel: 'pneu250', position: [0.32, 0.125, 0], side: 'left' }, { wheel: 'pneu250', position: [-0.32, 0.125, 0], side: 'right' }] },
      battery: { part: 'nicd24', position: [0, 0.1, 0] }, weapons: [] };
    const d = checkDesign(v1);
    expect(d.schema).toBe(2);
    expect(d.parts.filter((p) => p.role === 'wheel')).toHaveLength(2);
  });

  test('broken JSON and unknown parts are rejected with a reason', () => {
    expect(() => parseDesign('{nope')).toThrow(/valid JSON/);
    const bad = cloneDesign(FLIPSIDE);
    bad.parts.find((p) => p.role === 'wheel')!.wheel = 'warp-drive';
    expect(() => checkDesign(bad)).toThrow(/Unknown wheel/);
  });
});

describe('test bay', () => {
  test('nobody is eliminated or declared the winner in sandbox mode', () => {
    const m = new Match([FLIPSIDE, CRASH_TEST_DUMMY], { sandbox: true, skipCountdown: true });
    run(m, 16);
    expect(m.eliminated).toEqual([null, null]);
    expect(m.result).toBeNull();
    m.free();
  });
});
