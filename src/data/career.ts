import type { RobotDesign } from '../sim/design';
import { computeStats } from '../sim/stats';

/**
 * A season: five weekly championships, the last of them the Grand Final.
 * Placings pay prize money, and the team's build budget is its starting
 * money plus everything it has won — so winning is what pays for a better
 * robot (built in the garage, checked against the budget at the weigh-in).
 * Each week's field is drawn from robots a richer team could afford.
 */
export const CAREER = {
  weeks: 5,
  /** £ to build with before you've won anything: enough for most starters. */
  startBudget: 3500,
  /** Prize money by how far you got (£). */
  prizes: { champion: 6000, final: 3000, semi: 1500, quarter: 500 },
  /** The richest robot in week w's field costs at most this (£). */
  fieldBudget: (week: number) => 2900 + 550 * week,
};

export type Placing = 'champion' | 'final' | 'semi' | 'quarter';

export interface CareerWeek {
  week: number;
  robot: string;
  placing: Placing;
  prize: number;
}

export interface CareerState {
  schema: 1;
  /** The week to play next (1-based); weeks + 1 once the season's over. */
  week: number;
  winnings: number;
  history: CareerWeek[];
}

const KEY = 'robot-bash.career.v1';

export const newCareer = (): CareerState => ({ schema: 1, week: 1, winnings: 0, history: [] });

export function loadCareer(): CareerState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as CareerState;
    if (c?.schema !== 1 || typeof c.week !== 'number' || typeof c.winnings !== 'number' || !Array.isArray(c.history)) return null;
    return c;
  } catch {
    return null;
  }
}

export function saveCareer(c: CareerState | null) {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: the season lasts this session only.
  }
}

/** What the team can spend on its robot this week (£). */
export const budgetOf = (c: CareerState): number => CAREER.startBudget + c.winnings;

export const seasonOver = (c: CareerState): boolean => c.week > CAREER.weeks;

/** Bank a week's result and move on. */
export function recordWeek(c: CareerState, robot: string, placing: Placing): CareerState {
  const prize = CAREER.prizes[placing];
  return { ...c, week: c.week + 1, winnings: c.winnings + prize, history: [...c.history, { week: c.week, robot, placing, prize }] };
}

/**
 * This week's seven opponents: robots a team with this week's money could
 * have built, most expensive first, shuffled a little. If there aren't seven
 * that cheap, the cheapest of the rest fill in.
 */
export function fieldFor(week: number, pool: RobotDesign[], you: RobotDesign, random = Math.random): RobotDesign[] {
  const cap = CAREER.fieldBudget(week);
  const priced = pool.filter((d) => d.id !== you.id).map((d) => ({ d, cost: computeStats(d).cost }));
  const affordable = priced.filter((p) => p.cost <= cap).sort((a, b) => b.cost - a.cost + (random() - 0.5) * 900);
  const rest = priced.filter((p) => p.cost > cap).sort((a, b) => a.cost - b.cost);
  return [...affordable, ...rest].slice(0, 7).map((p) => p.d);
}

export const PLACING_TEXT: Record<Placing, string> = {
  champion: 'Champion',
  final: 'Runner-up',
  semi: 'Semi-finalist',
  quarter: 'Quarter-finalist',
};
