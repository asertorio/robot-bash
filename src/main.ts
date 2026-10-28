import RAPIER from '@dimforge/rapier3d-compat';
import { loadDesigns } from './data/garage';
import { HOUSE_ROBOTS } from './data/house';
import { CRASH_TEST_DUMMY, TEMPLATES } from './data/templates';
import { loadProfiles, saveProfiles, type ControlProfile } from './input/bindings';
import { InputManager } from './input/input';
import { MatchView } from './render/view';
import { CpuDriver } from './sim/ai';
import type { RobotDesign } from './sim/design';
import { Match } from './sim/match';
import { isLegal, scrutineer } from './sim/rules';
import { computeStats } from './sim/stats';
import { controlsScreen } from './ui/controls';
import { Garage } from './ui/garage';
import { h, mount } from './ui/dom';
import { statLines } from './ui/format';
import { Hud, PLAYER_COLOURS } from './ui/hud';

type Controller = 'Human' | 'CPU';

class App {
  private ui = document.getElementById('ui')!;
  private view = new MatchView(document.getElementById('view') as HTMLCanvasElement);
  private profiles: ControlProfile[] = loadProfiles();
  private input = new InputManager(this.profiles);
  private match: Match | null = null;
  private hud: Hud | null = null;
  private cpus: (CpuDriver | null)[] = [];
  private picks = [1, 2];
  private roster: RobotDesign[] = TEMPLATES;
  private garage: Garage | null = null;
  private pickHandler: ((id: string | null) => void) | null = null;
  private controllers: Controller[] = ['Human', 'CPU'];
  private houseCount = 2;
  private paused = false;
  private resultShown = false;
  private screenKeys: ((code: string) => void) | null = null;
  private last = performance.now();

  start() {
    // A click (not a drag) on the 3D view selects a part in the garage.
    const canvas = document.getElementById('view')!;
    let down = { x: 0, y: 0 };
    canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('pointerup', (e) => {
      if (!this.garage || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      this.pickHandler?.(this.view.pick(e.clientX, e.clientY));
    });
    this.attract();
    this.mainMenu();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Two CPU robots scrapping behind the menus. */
  private attract() {
    this.beginMatch([TEMPLATES[0], TEMPLATES[2]], ['CPU', 'CPU'], true, 2);
  }

  private fight() {
    this.beginMatch(this.picks.map((i) => this.roster[i]), this.controllers, false, this.houseCount);
  }

  private beginMatch(designs: RobotDesign[], controllers: Controller[], background = false, houseCount = 0) {
    this.match?.free();
    this.garage = null;
    this.view.cameraMode = 'tv';
    this.match = new Match(designs, { duration: background ? 1e9 : 180, house: HOUSE_ROBOTS.slice(0, houseCount) });
    this.cpus = controllers.map((c) => (c === 'CPU' ? new CpuDriver() : null));
    this.view.setMatch(this.match);
    this.paused = false;
    this.resultShown = false;
    this.hud = background ? null : new Hud(this.match, controllers);
    if (this.hud) mount(this.ui, this.hud.el);
    this.screenKeys = background ? this.screenKeys : (code) => this.fightKeys(code);
  }

  private frame(t: number) {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    const controls = this.input.poll(dt * 1000);
    for (const code of this.input.takePressed()) this.screenKeys?.(code);

    const m = this.match;
    if (m && this.garage) {
      m.update(dt, [controls[0], { left: 0, right: 0, weapon: false, weapon2: false }]);
      this.garage.update(dt);
    } else if (m && !this.paused) {
      const live = this.hud ? controls : [];
      const inputs = m.competitors.map((r, i) => {
        const cpu = this.cpus[i];
        if (cpu) return cpu.update(r, m.competitors.find((_, j) => j !== i && !m.eliminated[j]), m.arena.pitOpen, dt);
        return live[i] ?? { left: 0, right: 0, weapon: false, weapon2: false };
      });
      m.update(dt, inputs);
      // Attract mode: restart once something interesting has happened.
      if (!this.hud && (m.phase === 'over' || m.time > 60)) this.attract();
      if (this.hud && m.result && !this.resultShown && m.time > 0) this.showResultSoon();
    }
    this.view.render(this.paused ? 0 : dt);
    this.hud?.update(this.view, dt);
    requestAnimationFrame((n) => this.frame(n));
  }

  // ---------------------------------------------------------------- screens

  private mainMenu() {
    this.screenKeys = null;
    mount(this.ui, h('div', { class: 'screen' },
      h('h1', { class: 'title' }, 'Robot', h('br'), h('span', {}, 'Bash')),
      h('div', { class: 'tagline' }, 'Build it · Fight it · Break it'),
      h('div', { class: 'menu' },
        h('button', { class: 'primary', onclick: () => this.selectScreen() }, 'Fight'),
        h('button', { onclick: () => this.garageScreen() }, 'Garage'),
        h('button', { onclick: () => this.controlsScreen() }, 'Controls'),
        h('button', { onclick: () => this.howToScreen() }, 'How to play')),
      h('div', { class: 'hazard-bar' }),
      h('div', { class: 'footnote' }, 'A physics-simulated robot combat game in the spirit of the classic British TV show. Every hit is worked out from real forces — no health bars.')));
  }

  private garageScreen(initial?: RobotDesign) {
    this.screenKeys = null;
    this.hud = null;
    const garage = new Garage({
      startBay: (d) => {
        // Build first so a broken design leaves the old bay running.
        const bay = new Match([d, CRASH_TEST_DUMMY], {
          sandbox: true, skipCountdown: true,
          spawns: [{ pos: { x: -1.5, y: 0.01, z: -1.5 }, yaw: 0 }, { pos: { x: -1.5, y: 0.01, z: 1 }, yaw: Math.PI / 2 }],
        });
        this.match?.free();
        this.match = bay;
        this.cpus = [];
        this.view.setMatch(bay);
        this.view.cameraMode = 'follow';
        this.view.followIndex = 0;
      },
      bay: () => this.match,
      exit: () => { this.garage = null; this.view.highlight(null); this.attract(); this.mainMenu(); },
      highlight: (id) => this.view.highlight(id),
      onPick: (cb) => { this.pickHandler = cb; },
    }, initial);
    this.garage = garage;
    mount(this.ui, garage.el);
  }

  private selectScreen() {
    this.roster = [...TEMPLATES, ...loadDesigns()];
    this.picks = this.picks.map((p) => Math.min(p, this.roster.length - 1));
    const n = () => this.roster.length;
    const render = () => {
      const cards = [0, 1].map((p) => {
        const design = this.roster[this.picks[p]];
        const stats = computeStats(design);
        const mine = !TEMPLATES.includes(design);
        const issues = scrutineer(design);
        const cycle = (d: number) => { this.picks[p] = (this.picks[p] + d + n()) % n(); render(); };
        const setCtl = (c: Controller) => { this.controllers[p] = c; render(); };
        return h('div', { class: 'robot-card', style: `--pc:${PLAYER_COLOURS[p]}` },
          h('div', { class: 'who' }, `Player ${p + 1}`,
            h('span', { class: 'seg' },
              ...(['Human', 'CPU'] as Controller[]).map((c) => h('button', { class: this.controllers[p] === c ? 'on' : '', onclick: () => setCtl(c) }, c)))),
          h('div', { class: 'picker' },
            h('button', { onclick: () => cycle(-1), 'aria-label': 'Previous robot' }, '◀'),
            h('div', { class: 'name', style: `color:${design.colour}` }, design.name),
            h('button', { onclick: () => cycle(1), 'aria-label': 'Next robot' }, '▶')),
          mine && h('div', { class: 'mine' }, 'Your build'),
          h('div', { class: 'desc' }, design.description),
          h('dl', { class: 'stats' }, ...statLines(stats).flatMap(([k, v, bad]) => [h('dt', {}, k), h('dd', { class: bad ? 'over' : '' }, v)])),
          !isLegal(issues) && h('div', { class: 'legal bad' }, `Fails heavyweight scrutineering: ${issues.find((i) => i.level === 'error')!.text}`),
          h('div', { class: 'keys-hint' }, p === 0 ? 'A / D to change robot' : 'J / L to change robot'),
          mine && h('button', { class: 'small', style: 'margin-top:8px', onclick: () => this.garageScreen(design) }, 'Edit in garage'));
      });
      mount(this.ui, h('div', { class: 'screen top' },
        h('h2', {}, 'Choose your robots'),
        h('div', { class: 'select-row' }, ...cards),
        h('div', { class: 'house-row' }, h('span', {}, 'House robots'),
          h('span', { class: 'seg' }, ...[0, 2, 4].map((n) => h('button', { class: this.houseCount === n ? 'on' : '', onclick: () => { this.houseCount = n; render(); } }, n === 0 ? 'Off' : String(n)))),
          h('span', { class: 'hint' }, this.houseCount ? HOUSE_ROBOTS.slice(0, this.houseCount).map((d) => d.name).join(', ') + ' guard the corner patrol zones.' : 'No house robots — just you two.')),
        h('div', { class: 'actions' },
          h('button', { onclick: () => this.mainMenu() }, 'Back'),
          h('button', { class: 'primary', onclick: () => this.fight() }, 'Fight! (Enter)'))));
    };
    this.screenKeys = (code) => {
      const step = (p: number, d: number) => { this.picks[p] = (this.picks[p] + d + n()) % n(); render(); };
      if (code === 'KeyA') step(0, -1);
      if (code === 'KeyD') step(0, 1);
      if (code === 'KeyJ') step(1, -1);
      if (code === 'KeyL') step(1, 1);
      if (code === 'Enter') this.fight();
      if (code === 'Escape') this.mainMenu();
    };
    render();
  }

  private controlsScreen() {
    this.screenKeys = null;
    mount(this.ui, controlsScreen(this.profiles, this.input, (p) => {
      saveProfiles(p);
      this.input.setProfiles(p);
    }, () => this.mainMenu()));
  }

  private howToScreen() {
    this.screenKeys = (code) => { if (code === 'Escape') this.mainMenu(); };
    const kb = (k: string) => h('kbd', {}, k);
    mount(this.ui, h('div', { class: 'screen top' },
      h('h2', {}, 'How to play'),
      h('div', { class: 'howto' },
        h('h3', {}, 'Winning'),
        h('ul', {},
          h('li', {}, 'Immobilise your opponent: if a robot can\'t move under its own power for a few seconds, the referee counts to 10.'),
          h('li', {}, 'Throw them out of the arena, or into the pit — drive over the red pit release button to open it.'),
          h('li', {}, 'If both survive 3 minutes, the judges score aggression, control, damage and style.')),
        h('h3', {}, 'Default controls'),
        h('ul', {},
          h('li', {}, 'Player 1: ', kb('W'), kb('A'), kb('S'), kb('D'), ' drive · ', kb('E'), ' or ', kb('Space'), ' weapon · ', kb('Q'), ' weapon 2 · ', kb('C'), ' macro'),
          h('li', {}, 'Player 2: ', kb('I'), kb('J'), kb('K'), kb('L'), ' or arrows drive · ', kb('O'), ' or ', kb('/'), ' weapon · ', kb('U'), ' weapon 2 · ', kb('M'), ' macro'),
          h('li', {}, 'Gamepads: left stick drives, A / RT weapon, B / LT weapon 2.'),
          h('li', {}, kb('Esc'), ' pause · ', kb('Tab'), ' damage report')),
        h('h3', {}, 'It\'s physics, not hit points'),
        h('ul', {},
          h('li', {}, 'Flippers are driven by gas pressure on a ram, and you only have so much gas.'),
          h('li', {}, 'Spinners take seconds to spin up, store real energy, and lose speed every time they hit. Spinning up twists your own robot.'),
          h('li', {}, 'Armour dents, then tears off. Hits pass through to the motors, battery and radio behind it. Lose a wheel and you\'ll drive in circles.'),
          h('li', {}, 'Upside down? Your controls are reversed — just like the real thing. Flippers can self-right.'))),
      h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => this.mainMenu() }, 'Back'))));
  }

  private fightKeys(code: string) {
    if (code === 'Escape') this.togglePause();
    if (code === 'Tab' && this.hud) this.hud.showReport = !this.hud.showReport;
  }

  private togglePause() {
    if (!this.hud || this.resultShown) return;
    this.paused = !this.paused;
    this.ui.querySelector('.overlay')?.remove();
    if (!this.paused) return;
    this.ui.append(h('div', { class: 'overlay' },
      h('div', { class: 'dialog' },
        h('h2', {}, 'Paused'),
        h('div', { class: 'menu' },
          h('button', { class: 'primary', onclick: () => this.togglePause() }, 'Resume'),
          h('button', { onclick: () => this.fight() }, 'Restart fight'),
          h('button', { onclick: () => this.leaveFight(() => this.selectScreen()) }, 'Change robots'),
          h('button', { onclick: () => this.leaveFight(() => this.mainMenu()) }, 'Quit to menu')))));
  }

  private leaveFight(next: () => void) {
    this.hud = null;
    this.attract();
    next();
  }

  private showResultSoon() {
    this.resultShown = true;
    setTimeout(() => this.showResult(), 2500);
  }

  private showResult() {
    const m = this.match;
    if (!m?.result || !this.hud) return;
    const r = m.result;
    const winner = r.winner !== null ? m.robots[r.winner].design : null;
    const scores = r.scores;
    this.ui.append(h('div', { class: 'overlay' },
      h('div', { class: 'dialog' },
        h('div', { class: 'reason' }, 'Winner'),
        h('div', { class: 'winner', style: `color:${winner?.colour ?? '#fff'}` }, winner?.name ?? 'Nobody'),
        h('div', { class: 'reason' }, r.reason),
        scores && h('table', { class: 'judges' },
          h('tr', {}, h('th', {}, ''), ...m.competitors.map((rb) => h('th', {}, rb.design.name))),
          ...(['aggression', 'control', 'damage', 'style', 'total'] as const).map((k) =>
            h('tr', {}, h('td', { style: 'text-align:left;text-transform:capitalize' }, k), ...scores.map((s) => h('td', {}, s[k].toFixed(1)))))),
        h('div', { class: 'menu' },
          h('button', { class: 'primary', onclick: () => this.fight() }, 'Rematch'),
          h('button', { onclick: () => this.leaveFight(() => this.selectScreen()) }, 'Change robots'),
          h('button', { onclick: () => this.leaveFight(() => this.mainMenu()) }, 'Main menu')))));
  }
}

RAPIER.init().then(() => new App().start());
