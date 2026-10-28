import { describe, expect, test } from 'vitest';
import { checkDesign, parseDesign } from '../src/data/garage';
import { CRASH_TEST_DUMMY, FLIPSIDE, TEMPLATES } from '../src/data/templates';
import { applyDriveLayout, blankDesign, cloneDesign, defaultFlipper, defaultSpinner, driveLayout, newPanel } from '../src/sim/build';
import { Match } from '../src/sim/match';
import { BUDGETS, WEIGHT_CLASSES, isLegal, scrutineer } from '../src/sim/rules';
import { drive, run } from './helpers';

const heavy = { weight: WEIGHT_CLASSES.find((c) => c.id === 'heavy')!, budget: BUDGETS[0] };

describe('scrutineering', () => {
  test.each(TEMPLATES.map((t) => [t.name, t]))('%s passes as a heavyweight', (_, d) => {
    expect(isLegal(scrutineer(d, heavy))).toBe(true);
  });

  test('a heavyweight fails as a middleweight, and over a tight budget', () => {
    const issues = scrutineer(FLIPSIDE, { weight: WEIGHT_CLASSES.find((c) => c.id === 'middle')!, budget: BUDGETS.find((b) => b.id === 'b1500')! });
    expect(issues.filter((i) => i.level === 'error').map((i) => i.text).join(' ')).toMatch(/over the middleweight limit.*over the £1,500 budget/);
  });

  test('armour scraping the floor is rejected', () => {
    const d = cloneDesign(FLIPSIDE);
    d.shell[0].position[1] = d.shell[0].size[1] / 2; // bottom at y = 0
    expect(scrutineer(d, heavy).some((i) => i.level === 'error' && /scrapes the floor/.test(i.text))).toBe(true);
  });

  test('a 36 V battery on 12 V motors is rejected', () => {
    const d = cloneDesign(FLIPSIDE);
    d.drive.motor = 'dm250';
    d.battery.part = 'nicd36';
    expect(isLegal(scrutineer(d, heavy))).toBe(false);
  });
});

describe('builder operations', () => {
  test('a blank chassis is legal and drives', () => {
    const d = blankDesign();
    expect(isLegal(scrutineer(d, heavy))).toBe(true);
    const m = new Match([d], { skipCountdown: true });
    run(m, 0.3);
    run(m, 1.5, () => [drive(1)]);
    expect(m.robots[0].position.z).toBeGreaterThan(-3.5 + 1);
    m.free();
  });

  test('changing the drive layout keeps wheels on the floor and adds skids for 2WD only', () => {
    const d = blankDesign();
    applyDriveLayout(d, { perSide: 2, track: 0.6, wheelbase: 0.4, axleZ: 0 }, 'solid200');
    expect(d.drive.wheels).toHaveLength(4);
    expect(d.drive.wheels.every((w) => w.position[1] === 0.1)).toBe(true);
    expect(d.skids).toHaveLength(0);
    expect(driveLayout(d)).toMatchObject({ perSide: 2, track: 0.6, wheelbase: 0.4 });
    applyDriveLayout(d, { ...driveLayout(d), perSide: 1 });
    expect(d.skids).toHaveLength(2);
  });

  test('added panels and default weapons build into a working robot', () => {
    const d = blankDesign();
    d.shell.push(newPanel(d, 'wedge'));
    for (const weapon of [defaultFlipper(d), defaultSpinner(d)]) {
      const w = cloneDesign(d);
      w.weapons = [weapon];
      expect(isLegal(scrutineer(w, heavy))).toBe(true);
      const m = new Match([w, CRASH_TEST_DUMMY], { sandbox: true, skipCountdown: true });
      run(m, 1, () => [{ ...drive(0), weapon: true }]);
      m.free();
    }
  });
});

describe('saving and sharing', () => {
  test('a design survives a JSON round trip', () => {
    const d = parseDesign(JSON.stringify(FLIPSIDE));
    expect(d).toEqual(FLIPSIDE);
  });

  test('broken JSON and unknown parts are rejected with a reason', () => {
    expect(() => parseDesign('{nope')).toThrow(/valid JSON/);
    const bad = cloneDesign(FLIPSIDE);
    bad.drive.motor = 'warp-drive';
    expect(() => checkDesign(bad)).toThrow(/Unknown motor/);
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
