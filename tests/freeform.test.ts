import { describe, expect, test } from 'vitest';
import { CRASH_TEST_DUMMY } from '../src/data/templates';
import { partMass } from '../src/sim/assembly';
import { blankDesign, mirrorPart, newParts } from '../src/sim/build';
import type { PartDef, RobotDesign } from '../src/sim/design';
import { Match } from '../src/sim/match';
import { WEIGHT_CLASSES, BUDGETS, isLegal, scrutineer } from '../src/sim/rules';
import { convexPieces, convexPolygons, polygonArea, shapeVolume } from '../src/sim/shapes';
import { computeStats } from '../src/sim/stats';
import { OUTLINE_PRESETS } from '../src/ui/sketch';
import { N, drive, run, spawnAt } from './helpers';

const open = { weight: WEIGHT_CLASSES.find((c) => c.id === 'open')!, budget: BUDGETS[0] };
const heavy = { weight: WEIGHT_CLASSES.find((c) => c.id === 'heavy')!, budget: BUDGETS[0] };

describe('any 2D outline', () => {
  test.each(Object.entries(OUTLINE_PRESETS))('%s splits into convex pieces covering exactly its area', (_, outline) => {
    const pieces = convexPolygons(outline);
    const area = pieces.reduce((s, p) => s + Math.abs(polygonArea(p)), 0);
    expect(area).toBeCloseTo(Math.abs(polygonArea(outline)), 8);
  });

  test('a U-shaped scoop is really U-shaped: something can sit inside it', () => {
    const d = blankDesign();
    const scoop: PartDef = {
      id: 'scoop', label: 'Scoop', parent: 'chassis', position: [0, -0.05, 0.6], rotation: [0, 0, 0], joint: { type: 'fixed' }, role: 'structure',
      shape: { type: 'extrude', plane: 'top', depth: 0.02, outline: OUTLINE_PRESETS['U-scoop'] }, material: 'aluminium',
    };
    d.parts.push(scoop);
    expect(convexPieces(scoop.shape!).length).toBeGreaterThan(1);
    // Drive into a small block: it should end up inside the U, not bounce off a solid front.
    const block: RobotDesign = { schema: 2, id: 'block', name: 'Block', description: '', colour: '#888888', parts: [
      { id: 'b', label: 'Block', parent: null, position: [0, 0.05, 0], rotation: [0, 0, 0], joint: { type: 'fixed' }, role: 'structure', shape: { type: 'box', size: [0.2, 0.1, 0.2] }, material: 'hdpe' }] };
    const m = new Match([d, block], { sandbox: true, skipCountdown: true, spawns: spawnAt([0, 0, 0], [0, 1.2, 0]) });
    run(m, 0.3);
    run(m, 1.2, () => [drive(0.5), N]);
    const rel = m.robots[1].position.z - m.robots[0].position.z;
    // Scoop arms reach ~0.8 m ahead of the chassis centre; the block is caught between them.
    expect(rel).toBeLessThan(0.85);
    m.free();
  });
});

describe('lathe and imported meshes', () => {
  test('a lathed drum weighs what a cylinder of the same size weighs', () => {
    const lathe = shapeVolume({ type: 'lathe', profile: [[0, -0.1], [0.1, -0.1], [0.1, 0.1], [0, 0.1]] });
    expect(lathe).toBeCloseTo(Math.PI * 0.01 * 0.2, 6);
  });

  test('a mesh cube voxelises into boxes with about the right volume', () => {
    const v = [-0.1, -0.1, -0.1, 0.1, -0.1, -0.1, 0.1, 0.1, -0.1, -0.1, 0.1, -0.1, -0.1, -0.1, 0.1, 0.1, -0.1, 0.1, 0.1, 0.1, 0.1, -0.1, 0.1, 0.1];
    const i = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];
    const shape = { type: 'mesh' as const, vertices: v, indices: i };
    const boxes = convexPieces(shape);
    const vol = boxes.reduce((s, b) => s + (b.kind === 'box' ? 8 * b.half[0] * b.half[1] * b.half[2] : 0), 0);
    expect(vol).toBeGreaterThan(0.008 * 0.85);
    expect(vol).toBeLessThan(0.008 * 1.15);
    expect(shapeVolume(shape)).toBeCloseTo(0.008, 6);
  });

  test('every new shape kind builds into a robot that drives', () => {
    for (const kind of ['outline', 'lathe', 'model'] as const) {
      const d = blankDesign();
      d.parts.push(...newParts(d, kind, 'chassis'));
      const m = new Match([d], { sandbox: true, skipCountdown: true });
      run(m, 0.3);
      const z = m.robots[0].position.z;
      run(m, 1, () => [drive(1)]);
      expect(m.robots[0].position.z - z).toBeGreaterThan(0.5);
      m.free();
    }
  });
});

describe('joints', () => {
  test('a flail on ball joints swings freely', () => {
    const d = blankDesign();
    d.parts.push(...newParts(d, 'flail', 'chassis'));
    const m = new Match([d], { sandbox: true, skipCountdown: true });
    const r = m.robots[0];
    run(m, 0.3);
    run(m, 1.5, () => [drive(1, -1)]);
    const ball = r.parts.find((p) => p.label === 'Flail ball')!;
    const v = ball.body!.linvel();
    expect(Math.hypot(v.x, v.y, v.z)).toBeGreaterThan(0.3);
    m.free();
  });

  test('a sprung suspension wheel carries load and drives', () => {
    const d = blankDesign();
    d.parts = d.parts.filter((p) => p.role !== 'wheel');
    d.parts.push(...newParts(d, 'suspensionWheel', 'chassis'));
    d.parts.push(...mirrorPart(d, d.parts[d.parts.length - 2].id));
    const m = new Match([d], { sandbox: true, skipCountdown: true });
    run(m, 1);
    const z = m.robots[0].position.z;
    run(m, 1.5, () => [drive(1)]);
    expect(m.robots[0].position.z - z).toBeGreaterThan(1);
    m.free();
  });
});

describe('custom parts and the Open class', () => {
  test('a custom motor spec is used for stats and physics', () => {
    const d = blankDesign();
    d.catalog = { motors: { 'custom-motors-x': { id: 'custom-motors-x', name: 'Hyper motor', mass: 1, cost: 10, sourcing: 'custom', swapMinutes: 5, voltage: 24, stallTorque: 20, freeSpeed: 9000, stallCurrent: 300, freeCurrent: 5 } } };
    for (const p of d.parts) if (p.joint.type === 'hinge' && p.joint.actuator?.type === 'motor') p.joint.actuator.motor = 'custom-motors-x';
    const base = computeStats(blankDesign()).topSpeed!;
    expect(computeStats(d).topSpeed!).toBeGreaterThan(base * 2);
    const m = new Match([d], { sandbox: true, skipCountdown: true });
    run(m, 0.3);
    run(m, 1, () => [drive(1)]);
    expect(Math.hypot(m.robots[0].chassis.linvel().x, m.robots[0].chassis.linvel().z)).toBeGreaterThan(base);
    m.free();
  });

  test('the Open class has no weight or size limit, and allows flamethrowers', () => {
    const d = blankDesign();
    d.parts.push({ id: 'lead', label: 'Lead', parent: 'chassis', position: [0, 0, 0], rotation: [0, 0, 0], joint: { type: 'fixed' }, role: 'component', component: { type: 'ballast', mass: 400 } });
    d.parts.push(...newParts(d, 'flamethrower', 'chassis'));
    expect(isLegal(scrutineer(d, heavy))).toBe(false);
    expect(scrutineer(d, open).filter((i) => i.level === 'error')).toEqual([]);
    expect(partMass(d.parts.find((p) => p.id === 'lead')!)).toBe(400);
  });

  test('a flamethrower cooks whatever is in front of it', () => {
    const d = blankDesign();
    const [fl] = newParts(d, 'flamethrower', 'chassis');
    d.parts.push(fl);
    const m = new Match([d, CRASH_TEST_DUMMY], { sandbox: true, skipCountdown: true, spawns: spawnAt([0, 0, 0], [0, 0.9, Math.PI / 2]) });
    run(m, 4, () => [{ ...N, weapon: true }, N]);
    const worst = Math.min(...m.robots[1].parts.map((p) => p.condition));
    expect(worst).toBeLessThan(0.97);
    expect(m.commentary.some((c) => /torching Crash Test Dummy/.test(c.text))).toBe(true);
    m.free();
  });
});
