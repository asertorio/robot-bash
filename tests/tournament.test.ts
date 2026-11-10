import { describe, expect, test } from 'vitest';
import { FLIPSIDE, WEDGEHOG, WHIRLWIND } from '../src/data/templates';
import { Match } from '../src/sim/match';
import { Bout, PIT, cpuRepairs, pairUp, pitList, repair, wearOf, type Entrant } from '../src/sim/tournament';
import { run } from './helpers';

const entrant = (design: typeof WEDGEHOG, wear: number[] | null = null): Entrant => ({ design, human: false, wear });

describe('championship', () => {
  test('damage carries into the next fight: a wheel left at 0 comes off as it starts', () => {
    const fresh = new Match([WEDGEHOG], { skipCountdown: true });
    const wear = fresh.robots[0].parts.map(() => 1);
    const wheel = fresh.robots[0].parts.findIndex((p) => p.kind === 'wheel');
    const plate = fresh.robots[0].parts.findIndex((p) => p.kind === 'structure' && p.def?.parent);
    wear[wheel] = 0;
    wear[plate] = 0.5;
    fresh.free();
    const m = new Match([WEDGEHOG, FLIPSIDE], { skipCountdown: true, wear: [wear, null] });
    run(m, 0.1);
    const r = m.robots[0];
    expect(r.parts[wheel].detached).toBe(true);
    expect(r.parts[plate].condition).toBeCloseTo(0.5, 3);
    // Already-known damage isn't announced as news.
    expect(m.commentary.some((l) => l.text.includes('buckling'))).toBe(false);
    expect(m.robots[1].parts.every((p) => p.condition === 1)).toBe(true);
    m.free();
  });

  test('the pit lists what is damaged, worst first, and repairs put it back to new', () => {
    const m = new Match([WEDGEHOG], { skipCountdown: true });
    const r = m.robots[0];
    const wear = wearOf(r);
    wear[1] = 0.4;
    wear[2] = 0;
    const items = pitList(r, wear);
    expect(items.map((i) => i.index)).toEqual([2, 1]);
    expect(items[0].minutes).toBeGreaterThan(items[1].minutes * 0.5);
    const fixed = repair(wear, items.slice(0, 1));
    expect(fixed[2]).toBe(1);
    expect(fixed[1]).toBe(0.4);
    m.free();
  });

  test('a CPU crew fixes what stops the robot first, within the time it has', () => {
    const items = [
      { index: 1, label: 'Armour', kind: 'structure' as const, condition: 0.1, minutes: 25 },
      { index: 2, label: 'Radio', kind: 'electronics' as const, condition: 0.3, minutes: 15 },
      { index: 3, label: 'Wheel', kind: 'wheel' as const, condition: 0, minutes: 30 },
    ];
    const chosen = cpuRepairs(items, 50);
    expect(chosen.map((i) => i.index)).toEqual([3, 2]);
    expect(chosen.reduce((s, i) => s + i.minutes, 0)).toBeLessThanOrEqual(50);
    expect(cpuRepairs(items, PIT.minutes).length).toBeGreaterThan(0);
  });

  test('a CPU bout is fought to a result, headless, a slice at a time', () => {
    const entrants = [entrant(WEDGEHOG), entrant(WHIRLWIND)];
    const bout = new Bout(0, 1, entrants, { duration: 30 });
    const t0 = performance.now();
    let slices = 0;
    while (!bout.done && slices < 10000) { bout.advance(400); slices++; }
    const ms = performance.now() - t0;
    expect(bout.done).toBe(true);
    expect([0, 1]).toContain(bout.winner());
    // A guide to how long the page spends on it: logged, not asserted (machines vary).
    console.log(`30 s CPU bout: ${ms.toFixed(0)} ms, ${slices} slices of 400 steps`);
    bout.free();
  });

  test('winners pair off for the next round', () => {
    expect(pairUp([3, 0, 5, 6])).toEqual([[3, 0], [5, 6]]);
    expect(pairUp([2, 7])).toEqual([[2, 7]]);
  });
});
