import type { MatchView } from '../render/view';
import { conditionLabel } from '../sim/damage';
import type { Match } from '../sim/match';
import type { Robot } from '../sim/robot';
import { RobotDiagram, gauge, shotsLeft } from './diagram';
import { h } from './dom';
import { clock } from './format';

/** What the damage display shows: the little health diagrams, those plus the full report, or nothing. */
export type ReportMode = 'diagram' | 'full' | 'off';
const REPORT_KEY = 'robot-bash.hud.report.v1';
const REPORT_MODES: ReportMode[] = ['diagram', 'full', 'off'];

function loadReportMode(): ReportMode {
  try {
    const v = localStorage.getItem(REPORT_KEY) as ReportMode | null;
    return v && REPORT_MODES.includes(v) ? v : 'diagram';
  } catch { return 'diagram'; }
}

export const PLAYER_COLOURS = ['#e2412f', '#3a8ee6', '#4cc26b', '#c86be6'];

/** In-fight overlay: names, timer, instrument readouts, the count, commentary. */
export class Hud {
  readonly el: HTMLDivElement;
  private reportMode: ReportMode = loadReportMode();
  private diagrams: RobotDiagram[] = [];
  private gaugeBoxes: HTMLDivElement[] = [];
  private help: HTMLButtonElement;
  private timer: HTMLDivElement;
  private big: HTMLDivElement;
  private feed: HTMLDivElement;
  private metas: HTMLDivElement[] = [];
  private tags: HTMLDivElement[] = [];
  private reports: HTMLDivElement[] = [];
  private textClock = 0;
  /** A shout across the middle of the screen ("HUGE HIT"), and until when (match time). */
  private flashText = '';
  private flashUntil = -1;
  private finaleShown = false;

  constructor(private match: Match, controllers: string[], onPause?: () => void) {
    this.timer = h('div', { class: 'timer' }, '3:00');
    const boxes = match.competitors.map((r, i) => {
      const meta = h('div', { class: 'pmeta' });
      const gauges = h('div', { class: 'gauges' });
      const diagram = new RobotDiagram(110);
      const report = h('div', { class: 'report' });
      this.reports.push(report);
      this.metas.push(meta);
      this.gaugeBoxes.push(gauges);
      this.diagrams.push(diagram);
      return h('div', { class: `pbox${i % 2 ? ' right' : ''}`, style: `--pc:${PLAYER_COLOURS[i]}` },
        h('div', { class: 'pname' }, r.design.name),
        h('div', { class: 'pmeta who' }, `P${i + 1} · ${controllers[i]}`),
        gauges, meta, diagram.el, report);
    });
    // Tab cycles the damage display; tapping this does too (no Tab key on a phone).
    this.help = h('button', { class: 'help', onclick: (e: Event) => { (e.currentTarget as HTMLElement).blur(); this.cycleReport(); } });
    const pause = onPause && h('button', { class: 'small pause', title: 'Pause (Esc, or Start on a pad)', onclick: (e: Event) => { (e.currentTarget as HTMLElement).blur(); onPause(); } }, '❚❚ Pause');
    this.big = h('div', { class: 'big' });
    this.feed = h('div', { class: 'feed' });
    this.tags = match.robots.map((r, i) => i < match.competitors.length
      ? h('div', { class: 'tag', style: `--pc:${PLAYER_COLOURS[i]}` }, `P${i + 1}`)
      : h('div', { class: 'tag house' }, r.design.name));
    this.el = h('div', { class: 'hud' },
      h('div', { class: 'topbar' }, boxes[0], this.timer, boxes[1]),
      this.big, this.feed, ...this.tags,
      h('div', { class: 'hud-corner' }, this.help, pause));
    this.applyReportMode();
  }

  /** A big hit just landed: shout about it. */
  bigHit(energy: number) {
    const kj = energy / 1000;
    this.flashText = `${kj > 6 ? 'MASSIVE' : kj > 3 ? 'HUGE' : 'BIG'} HIT · ${kj.toFixed(1)} kJ`;
    this.flashUntil = this.match.time + 1.2;
    this.textClock = 0;
  }

  /** Tab: health diagrams → diagrams and the full report → nothing. */
  cycleReport() {
    this.reportMode = REPORT_MODES[(REPORT_MODES.indexOf(this.reportMode) + 1) % REPORT_MODES.length];
    try { localStorage.setItem(REPORT_KEY, this.reportMode); } catch { /* not saved */ }
    this.applyReportMode();
  }

  private applyReportMode() {
    const next = { diagram: 'Full damage report', full: 'Hide damage', off: 'Damage diagrams' }[this.reportMode];
    this.help.textContent = next;
    this.help.title = 'Tab cycles the damage display';
    for (const d of this.diagrams) d.el.style.display = this.reportMode === 'off' ? 'none' : 'block';
    this.textClock = 0;
  }

  update(view: MatchView, dt: number) {
    const m = this.match;
    // Name tags (and the referee's count) follow the robots every frame.
    m.robots.forEach((r, i) => {
      const tag = this.tags[i];
      const sp = view.screenPos(r);
      if (i >= m.competitors.length) {
        tag.style.display = sp ? 'block' : 'none';
        if (sp) { tag.style.left = `${sp.x}px`; tag.style.top = `${sp.y}px`; }
        return;
      }
      const count = m.counts[i];
      tag.style.display = sp && !m.eliminated[i] ? 'block' : 'none';
      if (sp) { tag.style.left = `${sp.x}px`; tag.style.top = `${sp.y}px`; }
      const label = `P${i + 1}`;
      if (count !== null && count !== undefined) tag.innerHTML = `${label}<span class="count">${Math.min(10, Math.floor(count) + 1)}</span>`;
      else if (tag.textContent !== label) tag.textContent = label;
    });

    this.textClock -= dt;
    if (this.textClock > 0) return;
    this.textClock = 0.1;

    if (m.phase === 'countdown') {
      this.timer.textContent = clock(m.duration);
      this.big.textContent = String(Math.ceil(-m.time));
    } else {
      const left = m.duration - (m.endTime ?? m.time);
      this.timer.textContent = clock(left);
      this.timer.classList.toggle('low', left < 30);
      if (m.finaleStarted && !this.finaleShown) { this.finaleShown = true; this.flashText = 'FINALE · PIT OPEN'; this.flashUntil = m.time + 2.5; }
      this.big.textContent = m.time < 1.2 ? 'Activate!' : m.time < this.flashUntil ? this.flashText : '';
      this.big.classList.toggle('flash', m.time >= 1.2 && m.time < this.flashUntil);
    }
    m.competitors.forEach((r, i) => {
      this.metas[i].innerHTML = this.instruments(r, m.eliminated[i]);
      this.gaugeBoxes[i].replaceChildren(...(m.eliminated[i] ? [] : this.gauges(r)));
      if (this.reportMode !== 'off') this.diagrams[i].draw(r);
    });

    const lines = m.commentary.slice(-5);
    this.feed.replaceChildren(...lines.map((l) => {
      const age = Math.max(0, m.time) - l.time;
      return h('div', { class: l.level, style: `opacity:${age > 8 ? 0 : age > 6 ? 0.4 : 1}` }, l.text);
    }));

    const full = this.reportMode === 'full';
    m.competitors.forEach((r, i) => {
      this.reports[i].style.display = full ? 'block' : 'none';
      if (full) this.reports[i].replaceChildren(this.damageTable(r));
    });
  }

  /** How much battery, gas and fuel is left. */
  private gauges(r: Robot): HTMLElement[] {
    const out = [gauge('Batt', r.energy / Math.max(1e-6, r.battery.capacity), `${Math.round((100 * r.energy) / Math.max(1e-6, r.battery.capacity))}%`)];
    if (r.gasCapacity > 0) out.push(gauge('Gas', r.gasLeft / r.gasCapacity, `${shotsLeft(r)} shots`, { colour: '#6cb6e8' }));
    for (const fl of r.flames) out.push(gauge('Fuel', fl.fuel / Math.max(1e-6, fl.def.fuel), `${fl.fuel.toFixed(1)} kg`, { colour: '#ff8a3a' }));
    return out;
  }

  private instruments(r: Robot, out: string | null): string {
    if (out) return `<span class="bad">OUT — ${out}</span>`;
    const bits: string[] = [];
    if (!r.hasControl) bits.push('<span class="bad">NO RADIO</span>');
    else if (!r.powered) bits.push('<span class="bad">NO POWER</span>');
    bits.push(`Drawing <b>${Math.round(r.current)} A</b>`);
    for (const rot of r.rotors()) {
      const gone = !rot.actuator.child.joint;
      bits.push(gone ? `<span class="bad">${rot.actuator.driven.label} gone</span>` : `${rot.actuator.driven.label} <b>${Math.round(rot.rpm).toLocaleString()} rpm</b>${rot.on ? '' : ' (off)'}`);
    }
    for (const ch of r.chains) bits.push(ch.part.detached ? `<span class="bad">${ch.part.label} gone</span>` : `${ch.part.label} <b>${ch.on ? 'running' : 'off'}</b>`);
    return bits.join('<br>');
  }

  private damageTable(r: Robot): HTMLTableElement {
    const rows = r.parts.map((p) => {
      const c = conditionLabel(p.condition);
      return h('tr', {}, h('td', {}, p.label), h('td', { class: `cond-${c}` }, p.detached && c !== 'Destroyed' ? 'Detached' : c));
    });
    return h('table', {}, ...rows);
  }
}
