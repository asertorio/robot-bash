import type { MatchView } from '../render/view';
import { conditionLabel } from '../sim/damage';
import type { Match } from '../sim/match';
import type { Robot } from '../sim/robot';
import { h } from './dom';
import { clock } from './format';

export const PLAYER_COLOURS = ['#e2412f', '#3a8ee6', '#4cc26b', '#c86be6'];

/** In-fight overlay: names, timer, instrument readouts, the count, commentary. */
export class Hud {
  readonly el: HTMLDivElement;
  showReport = false;
  private timer: HTMLDivElement;
  private big: HTMLDivElement;
  private feed: HTMLDivElement;
  private metas: HTMLDivElement[] = [];
  private tags: HTMLDivElement[] = [];
  private report: HTMLDivElement;
  private textClock = 0;

  constructor(private match: Match, controllers: string[]) {
    this.timer = h('div', { class: 'timer' }, '3:00');
    const boxes = match.robots.map((r, i) => {
      const meta = h('div', { class: 'pmeta' });
      this.metas.push(meta);
      return h('div', { class: `pbox${i % 2 ? ' right' : ''}`, style: `--pc:${PLAYER_COLOURS[i]}` },
        h('div', { class: 'pname' }, r.design.name),
        h('div', { class: 'pmeta' }, `P${i + 1} · ${controllers[i]}`),
        meta);
    });
    this.big = h('div', { class: 'big' });
    this.feed = h('div', { class: 'feed' });
    this.report = h('div', { class: 'report' });
    this.tags = match.robots.map((_, i) => h('div', { class: 'tag', style: `--pc:${PLAYER_COLOURS[i]}` }, `P${i + 1}`));
    this.el = h('div', { class: 'hud' },
      h('div', { class: 'topbar' }, boxes[0], this.timer, boxes[1]),
      this.report, this.big, this.feed, ...this.tags,
      h('div', { class: 'help' }, 'Esc pause · Tab damage report'));
  }

  update(view: MatchView, dt: number) {
    const m = this.match;
    // Name tags (and the referee's count) follow the robots every frame.
    m.robots.forEach((r, i) => {
      const tag = this.tags[i];
      const sp = view.screenPos(r);
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
      const left = m.duration - m.time;
      this.timer.textContent = clock(left);
      this.timer.classList.toggle('low', left < 30);
      this.big.textContent = m.time < 1.2 ? 'Activate!' : '';
    }
    m.robots.forEach((r, i) => (this.metas[i].innerHTML = this.instruments(r, m.eliminated[i])));

    const lines = m.commentary.slice(-5);
    this.feed.replaceChildren(...lines.map((l) => {
      const age = Math.max(0, m.time) - l.time;
      return h('div', { class: l.level, style: `opacity:${age > 8 ? 0 : age > 6 ? 0.4 : 1}` }, l.text);
    }));

    this.report.style.display = this.showReport ? 'flex' : 'none';
    if (this.showReport) this.report.replaceChildren(...m.robots.map((r) => this.damageTable(r)));
  }

  private instruments(r: Robot, out: string | null): string {
    if (out) return `<span class="bad">OUT — ${out}</span>`;
    const bits: string[] = [];
    const pct = Math.round((100 * r.energy) / r.battery.capacity);
    if (!r.hasControl) bits.push('<span class="bad">NO RADIO</span>');
    else if (!r.powered) bits.push('<span class="bad">NO POWER</span>');
    bits.push(`Battery <b class="${pct < 20 ? 'warn' : ''}">${pct}%</b> · ${Math.round(r.current)} A`);
    r.flippers.forEach((f) => {
      const shots = Math.floor(f.gasLeft / f.gasPerShot);
      bits.push(f.joint ? `Gas <b class="${shots < 4 ? 'warn' : ''}">${Math.round(f.gasLeft)} g</b> (${shots} flips)` : '<span class="bad">Flipper gone</span>');
    });
    r.spinners.forEach((s, i) => {
      const rpm = Math.round(r.spinnerRpm()[i]);
      bits.push(s.joint ? `Spinner <b>${rpm.toLocaleString()} rpm</b>${s.on ? '' : ' (off)'}` : '<span class="bad">Spinner gone</span>');
    });
    return bits.join('<br>');
  }

  private damageTable(r: Robot): HTMLTableElement {
    const rows = r.parts.map((p) => {
      const c = conditionLabel(p.condition);
      return h('tr', {}, h('td', {}, p.label), h('td', { class: `cond-${c}` }, p.detached && c !== 'Destroyed' ? 'Detached' : c));
    });
    return h('table', {}, h('tr', {}, h('th', { colSpan: 2 }, r.design.name)), ...rows);
  }
}
