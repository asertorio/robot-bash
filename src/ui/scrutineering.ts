import { designBounds } from '../sim/assembly';
import type { RobotDesign } from '../sim/design';
import { DEFAULT_RULES, MAX_SIZE, isLegal, scrutineer, type Rules } from '../sim/rules';
import { computeStats } from '../sim/stats';
import { h } from './dom';

/**
 * The weigh-in and tech check before a fight, as the show did it: each robot
 * on the scales (the needle sweeps up to its real mass against the class
 * limit), its footprint against the arena doors, its cost against the
 * budget if there is one, then the scrutineers' list — what passed, what
 * they'd warn a team about, and what stops it fighting.
 */
export interface ScrutineeringOptions {
  rules?: Rules;
  /** Everyone passed (or the player chose to fight anyway). */
  onPass: () => void;
  onBack: () => void;
  /** A failed robot can still fight an exhibition bout (ordinary fights, not competitions). */
  allowExhibition: boolean;
  /** Take a failed robot to the garage to fix it. */
  onGarage?: (d: RobotDesign) => void;
  title?: string;
}

export function scrutineeringScreen(designs: RobotDesign[], o: ScrutineeringOptions): HTMLElement {
  const rules = o.rules ?? DEFAULT_RULES;
  let allPass = true;
  const cards = designs.map((d, i) => {
    const stats = computeStats(d);
    const issues = scrutineer(d, rules, stats);
    const legal = isLegal(issues);
    if (!legal) allPass = false;
    const limit = rules.weight.limit;
    const frac = Number.isFinite(limit) ? Math.min(1.08, stats.mass / limit) : 0.5;
    const b = designBounds(d);
    const size = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
    const budget = rules.budget.limit;
    const passes = [
      `Weight: ${stats.mass.toFixed(1)} kg${Number.isFinite(limit) ? ` of ${limit} kg` : ''}`,
      `Footprint: ${size.toFixed(2)} m of ${MAX_SIZE} m`,
      budget !== null ? `Cost: £${Math.round(stats.cost).toLocaleString()} of £${budget.toLocaleString()}` : `Cost: £${Math.round(stats.cost).toLocaleString()}`,
    ];
    const needle = h('div', { class: 'scale-needle' });
    // Sweep up once it's on screen (and wobble a little, like a real dial settling).
    setTimeout(() => { needle.style.transform = `rotate(${-90 + 180 * frac}deg)`; }, 150 + i * 350);
    return h('div', { class: `scrut-card${legal ? '' : ' failed'}`, style: `--rc:${d.colour}` },
      h('div', { class: 'scrut-name' }, d.name),
      h('div', { class: 'scale' }, h('div', { class: 'scale-face' }), needle,
        h('div', { class: 'scale-read' }, `${stats.mass.toFixed(1)} kg`)),
      h('ul', { class: 'scrut-list' },
        ...passes.map((t) => h('li', { class: issues.some((x) => x.level === 'error' && x.text.toLowerCase().includes(t.split(':')[0].toLowerCase())) ? 'bad' : 'ok' }, t)),
        ...issues.map((x) => h('li', { class: x.level === 'error' ? 'bad' : 'warn' }, x.text))),
      h('div', { class: `stamp${legal ? '' : ' fail'}`, style: `animation-delay:${0.9 + i * 0.35}s` }, legal ? 'Passed' : 'Failed'));
  });
  const failed = designs.find((d) => !isLegal(scrutineer(d, rules)));
  return h('div', { class: 'screen top' },
    h('h2', {}, o.title ?? 'Weigh-in & scrutineering'),
    h('div', { class: 'hint', style: 'text-align:center' }, `${rules.weight.name} rules${rules.budget.limit !== null ? `, ${rules.budget.name}` : ''}.`),
    h('div', { class: 'scrut-row' }, ...cards),
    h('div', { class: 'actions' },
      h('button', { onclick: o.onBack }, 'Back'),
      failed && o.onGarage && h('button', { onclick: () => o.onGarage!(failed) }, `Fix ${failed.name} in the garage`),
      allPass ? h('button', { class: 'primary', onclick: o.onPass }, 'Into the arena! (Enter)')
        : o.allowExhibition && h('button', { class: 'primary', onclick: o.onPass }, 'Fight anyway (exhibition)')));
}
