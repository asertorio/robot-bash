import { describe, expect, test } from 'vitest';
import { HOUSE_ROBOTS } from '../src/data/house';
import { CRASH_TEST_DUMMY, FLIPSIDE, TEMPLATES, WEDGEHOG } from '../src/data/templates';
import { ARENA, floorAround } from '../src/sim/arena';
import { HOUSE_CORNERS, inZone, zoneCentre } from '../src/sim/house';
import { Match } from '../src/sim/match';
import { N, drive, run, spawnAt } from './helpers';

describe('arena', () => {
  test('the floor covers the square exactly, minus the holes', () => {
    const holes = [{ x0: 1, x1: 2, z0: 1, z1: 2 }, { x0: -3, x1: -2, z0: -1, z1: 0.5 }];
    const area = floorAround(6, holes).reduce((s, r) => s + (r.x1 - r.x0) * (r.z1 - r.z0), 0);
    expect(area).toBeCloseTo(144 - 1 - 1.5);
  });

  test('the floor flipper launches a robot that parks on it', () => {
    const f = ARENA.floorFlipper;
    const m = new Match([WEDGEHOG], { skipCountdown: true, spawns: spawnAt([f.x, f.z0 + f.length * 0.6, 0]) });
    let peak = 0;
    run(m, 2, () => [N], () => { peak = Math.max(peak, m.robots[0].position.y); });
    expect(peak).toBeGreaterThan(0.4);
    expect(m.commentary.some((c) => /floor flipper launches Wedgehog/.test(c.text))).toBe(true);
    m.free();
  });

  test('the flame pit cooks tyres faster than steel', () => {
    const f = ARENA.flamePit;
    const m = new Match([WEDGEHOG], { skipCountdown: true, sandbox: true, spawns: spawnAt([f.x, f.z, 0]) });
    run(m, f.period + 0.5, () => [N]);
    const r = m.robots[0];
    const wheel = Math.min(...r.parts.filter((p) => p.kind === 'wheel').map((p) => p.condition));
    const wedge = r.parts.find((p) => p.id === 'wedge')!.condition;
    expect(wheel).toBeLessThan(0.9);
    expect(wedge).toBeGreaterThan(wheel);
    m.free();
  });
});

describe('house robots', () => {
  test('they live in the corners and do not count as competitors', () => {
    const m = new Match([FLIPSIDE, WEDGEHOG], { skipCountdown: true, house: HOUSE_ROBOTS });
    expect(m.competitors).toHaveLength(2);
    expect(m.robots).toHaveLength(6);
    m.houseRobots.forEach((h, k) => expect(inZone(HOUSE_CORNERS[k], h.position)).toBe(true));
    m.free();
  });

  test('a house robot attacks a competitor in its zone, then goes home', () => {
    const zone = HOUSE_CORNERS[0];
    const home = zoneCentre(zone);
    const m = new Match([CRASH_TEST_DUMMY, WEDGEHOG], {
      skipCountdown: true, house: [HOUSE_ROBOTS[2]],
      spawns: spawnAt([home.x - 0.9, home.z - 0.9, 0], [-4, -4, 0]),
    });
    const h = m.houseRobots[0];
    const start = { ...h.position };
    run(m, 2.5, () => [drive(0.6, -0.6), drive(0.6, -0.6)]);
    const moved = Math.hypot(h.position.x - start.x, h.position.z - start.z);
    expect(moved).toBeGreaterThan(0.3);
    m.free();
  });

  test("a house robot's attacks don't save a stuck robot from the count", () => {
    // Wedgehog is jammed against the wall in Shovelhead's corner, wheels
    // spinning. Shovelhead comes out and shoves it about, which mustn't
    // count as Wedgehog moving under its own power.
    const m = new Match([WEDGEHOG, WEDGEHOG], {
      skipCountdown: true, house: [HOUSE_ROBOTS[2]],
      spawns: spawnAt([5.5, 3.7, Math.PI / 2], [-3, -1, 0]),
    });
    const h = m.houseRobots[0];
    const start = { ...h.position };
    let moved = 0;
    run(m, 22, () => [drive(1), drive(0.8, 0.3)], () => {
      moved = Math.max(moved, Math.hypot(h.position.x - start.x, h.position.z - start.z));
    });
    expect(moved).toBeGreaterThan(0.3);
    expect(m.eliminated[0]).toBe('immobilised');
    expect(m.eliminated[1]).toBeNull();
    m.free();
  }, 60000);

  test('they never decide a fight', () => {
    const m = new Match([WEDGEHOG, TEMPLATES[1]], { skipCountdown: true, duration: 4, house: HOUSE_ROBOTS });
    run(m, 4.5, () => [drive(0.5, -0.5), drive(0.5, -0.5)]);
    expect(m.result?.scores).toHaveLength(2);
    expect([0, 1]).toContain(m.result?.winner);
    m.free();
  });
});
