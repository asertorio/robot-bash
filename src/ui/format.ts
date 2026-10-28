import type { RobotStats } from '../sim/stats';

const n = (v: number, d = 0) => v.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Human-readable stat lines for a robot card: [label, value, isProblem]. */
export function statLines(s: RobotStats, weightLimit = 100): Array<[string, string, boolean?]> {
  const lines: Array<[string, string, boolean?]> = [
    ['Weight', `${n(s.mass, 1)} kg of ${weightLimit} kg`, s.mass > weightLimit],
    ['Cost', `£${n(s.cost)}`],
    ['Top speed', `${n(s.topSpeed, 1)} m/s (${n(s.topSpeed * 2.237, 1)} mph)`],
    ['Pushing force', `${n(s.pushForce)} N (${s.pushLimit}-limited)`],
    ['0 to top speed', `${n(s.acceleration, 1)} s`],
    ['Battery life', `${n(s.runtime / 60, 1)} min of fighting`],
  ];
  for (const w of s.weapons) {
    if (w.kind === 'flipper') {
      const f = w.numbers;
      lines.push(['Flipper', `${n(f.ramForce / 1000, 1)} kN ram at ${f.pressure} bar · ${n(f.energyPerShot / 1000, 1)} kJ per flip`]);
      lines.push(['Gas', `${f.shots} flips per bottle`]);
    } else {
      const sp = w.numbers;
      lines.push(['Spinner', `${n(sp.maxRpm)} rpm · ${n(sp.tipSpeed)} m/s tip · ${n(sp.energy / 1000, 1)} kJ stored`]);
      lines.push(['Spin-up', `${n(sp.spinUpTime, 1)} s to 90%`]);
    }
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
