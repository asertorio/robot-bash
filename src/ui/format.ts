import type { RobotStats } from '../sim/stats';

const n = (v: number, d = 0) => v.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Human-readable stat lines for a robot card: [label, value, isProblem]. */
export function statLines(s: RobotStats, weightLimit = 100): Array<[string, string, boolean?]> {
  const lines: Array<[string, string, boolean?]> = [
    ['Weight', `${n(s.mass, 1)} kg of ${weightLimit} kg`, s.mass > weightLimit],
    ['Cost', `£${n(s.cost)}`],
    ['Drive', s.locomotion, s.locomotion === 'none'],
  ];
  if (s.topSpeed !== null) lines.push(['Top speed', `${n(s.topSpeed, 1)} m/s (${n(s.topSpeed * 2.237, 1)} mph)`]);
  if (s.pushForce !== null) lines.push(['Pushing force', `${n(s.pushForce)} N (${s.pushLimit}-limited)`]);
  if (s.acceleration !== null) lines.push(['0 to top speed', `${n(s.acceleration, 1)} s`]);
  lines.push(['Battery life', Number.isFinite(s.runtime) ? `${n(s.runtime / 60, 1)} min of fighting` : 'no motors fitted', s.runtime === 0]);
  for (const w of s.weapons) {
    lines.push([w.label, w.lines[0]]);
    for (const extra of w.lines.slice(1)) lines.push(['', extra]);
  }
  if (!s.weapons.length) lines.push(['Weapon', 'None — a pusher']);
  const spares = { common: 'Off-the-shelf', specialist: 'Some specialist parts', custom: 'Custom-made parts' }[s.hardestSpare];
  lines.push(['Spares', spares, s.hardestSpare === 'custom']);
  lines.push(['Full rebuild', `£${n(s.rebuildCost)} · ${n(s.rebuildMinutes / 60, 1)} h pit time`]);
  return lines;
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
