import { describe, expect, test } from 'vitest';
import { CAREER, budgetOf, fieldFor, newCareer, recordWeek, seasonOver } from '../src/data/career';
import { TEMPLATES } from '../src/data/templates';
import { computeStats } from '../src/sim/stats';

describe('career', () => {
  test('prize money raises the build budget, week by week, to the end of the season', () => {
    let c = newCareer();
    expect(budgetOf(c)).toBe(CAREER.startBudget);
    c = recordWeek(c, 'Flipside', 'semi');
    c = recordWeek(c, 'Flipside', 'champion');
    expect(budgetOf(c)).toBe(CAREER.startBudget + CAREER.prizes.semi + CAREER.prizes.champion);
    expect(c.week).toBe(3);
    for (let w = 3; w <= CAREER.weeks; w++) c = recordWeek(c, 'Flipside', 'quarter');
    expect(seasonOver(c)).toBe(true);
    expect(c.history).toHaveLength(CAREER.weeks);
  });

  test('a good choice of starters is affordable in week one (not all of them), and the field gets dearer later on', () => {
    const affordable = TEMPLATES.filter((d) => computeStats(d).cost <= CAREER.startBudget);
    expect(affordable.length).toBeGreaterThanOrEqual(10);
    expect(affordable.length).toBeLessThan(TEMPLATES.length);
    const you = TEMPLATES[0];
    const cost = (ds: typeof TEMPLATES) => ds.reduce((s, d) => s + computeStats(d).cost, 0) / ds.length;
    const early = fieldFor(1, TEMPLATES, you, () => 0.5), late = fieldFor(5, TEMPLATES, you, () => 0.5);
    expect(early).toHaveLength(7);
    expect(early).not.toContain(you);
    expect(cost(late)).toBeGreaterThan(cost(early));
  });
});
