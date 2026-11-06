import RAPIER from '@dimforge/rapier3d-compat';
import { loadDesigns } from './data/garage';
import { HOUSE_ROBOTS, MONSTER_HOUSE, houseLineup, type HouseSet } from './data/house';
import { damageScale, loadSettings, saveSettings, type Settings } from './data/settings';
import { CRASH_TEST_DUMMY, TEMPLATES } from './data/templates';
import { describeBinding, loadProfiles, saveProfiles, type ControlProfile } from './input/bindings';
import { InputManager } from './input/input';
import { MatchView } from './render/view';
import { CpuDriver } from './sim/ai';
import type { RobotDesign } from './sim/design';
import { BIG_HIT, Match } from './sim/match';
import { isLegal, scrutineer } from './sim/rules';
import { computeStats } from './sim/stats';
import { controlsScreen } from './ui/controls';
import { Garage } from './ui/garage';
import { h, mount } from './ui/dom';
import { statLines } from './ui/format';
import { Hud, PLAYER_COLOURS } from './ui/hud';
import { TouchControls, buttonLabel } from './ui/touch';
import type { Robot } from './sim/robot';

type Controller = 'Human' | 'CPU';

class App {
  private ui = document.getElementById('ui')!;
  private view = new MatchView(document.getElementById('view') as HTMLCanvasElement);
  private profiles: ControlProfile[] = loadProfiles();
  private input = new InputManager(this.profiles);
  private match: Match | null = null;
  private hud: Hud | null = null;
  private cpus: (CpuDriver | null)[] = [];
  /** Each player's robot, by design id (indices would shift when a saved robot is deleted). */
  private pickIds = [TEMPLATES[1].id, TEMPLATES[2].id];
  private roster: RobotDesign[] = TEMPLATES;
  private garage: Garage | null = null;
  private pickHandler: ((id: string | null) => void) | null = null;
  private controllers: Controller[] = ['Human', 'CPU'];
  private houseCount = 2;
  private settings: Settings = loadSettings();
  /** Real seconds of slow motion left, and when the last one started. */
  private slowmo = 0;
  private lastSlowmo = -99;
  private paused = false;
  private resultShown = false;
  /** The current screen's key handler; return true to say a pad press was dealt with. */
  private screenKeys: ((code: string) => boolean | void) | null = null;
  private last = performance.now();
  private touch = new TouchControls();
  /** A touch screen is in use: show on-screen controls where they're needed. */
  private touchSeen = window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

  start() {
    // A click (not a drag) on the 3D view selects a part in the garage.
    const canvas = document.getElementById('view')!;
    let down = { x: 0, y: 0, gizmo: false };
    canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY, gizmo: this.view.gizmoBusy() }));
    canvas.addEventListener('pointerup', (e) => {
      if (!this.garage || down.gizmo || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      this.pickHandler?.(this.view.pick(e.clientX, e.clientY));
    });
    // On-screen controls for phones and tablets (they show themselves when needed).
    document.body.append(this.touch.el);
    document.body.classList.toggle('touch', this.touchSeen);
    window.addEventListener('touchstart', () => {
      if (this.touchSeen) return;
      this.touchSeen = true;
      document.body.classList.add('touch');
      if (this.screenKeys === null && this.ui.querySelector('h1.title')) this.mainMenu();
    }, { passive: true });
    // Switching apps mid-press must not leave a finger "held down".
    document.addEventListener('visibilitychange', () => this.touch.release());
    this.attract();
    this.mainMenu();
    requestAnimationFrame((t) => this.frame(t));
  }

  /**
   * Show the touch controls when someone could use them: for the first human
   * player in a fight, or for the test bay in the garage (on a phone, once the
   * side panels are hidden — otherwise they'd cover the editor).
   */
  private updateTouch() {
    let player: number | null = null;
    let robot: Robot | undefined;
    const m = this.match;
    if (this.touchSeen && m) {
      if (this.garage) {
        if (window.innerWidth >= 900 || this.garage.el.classList.contains('panels-hidden')) { player = 0; robot = m.robots[0]; }
      } else if (this.hud && !this.paused && !this.resultShown) {
        const i = this.controllers.indexOf('Human');
        if (i >= 0) { player = i; robot = m.competitors[i]; }
      }
    }
    this.touch.show(player !== null);
    this.input.touch = player !== null ? this.touch.state : null;
    this.input.touchPlayer = player ?? 0;
    if (robot) {
      const uses = robot.buttonUses();
      this.touch.setButtons([1, 2, 3, 4].map((n) => buttonLabel(uses.get(`button${n}`), robot!.flames.some((f) => f.def.input.source === `button${n}`))));
    }
  }

  private pick(p: number): RobotDesign {
    return this.roster.find((d) => d.id === this.pickIds[p]) ?? this.roster[Math.min(p + 1, this.roster.length - 1)];
  }

  /** Two CPU robots scrapping behind the menus. */
  private attract() {
    this.beginMatch([TEMPLATES[0], TEMPLATES[2]], ['CPU', 'CPU'], true, 2);
  }

  private fight() {
    this.beginMatch([0, 1].map((p) => this.pick(p)), this.controllers, false, this.houseCount);
  }

  /** All the house robots, both sets. */
  private get allHouse(): RobotDesign[] {
    return [...HOUSE_ROBOTS, ...MONSTER_HOUSE];
  }

  private beginMatch(designs: RobotDesign[], controllers: Controller[], background = false, houseCount = 0) {
    // Build the new fight before throwing the old one away, so a robot that
    // can't be built leaves things as they were.
    const st = this.settings;
    let match: Match;
    try {
      match = new Match(designs, {
        duration: background ? 1e9 : st.fightLength,
        house: (background ? HOUSE_ROBOTS : houseLineup(st.houseSet)).slice(0, houseCount),
        damageScale: background ? 1 : damageScale(st),
        breaks: st.breaks,
        finale: !background && st.finale,
      });
    } catch (e) {
      if (background) throw e;
      alert(`That fight can't start: ${(e as Error).message}`);
      return;
    }
    // Only one physics world at a time: Rapier worlds are WASM memory.
    this.match?.free();
    this.match = match;
    this.garage = null;
    this.view.setGizmo(null);
    this.view.cameraMode = 'tv';
    this.slowmo = 0;
    this.lastSlowmo = -99;
    this.input.mode = background ? 'menu' : 'fight';
    this.cpus = controllers.map((c) => (c === 'CPU' ? new CpuDriver() : null));
    this.view.setMatch(this.match);
    this.paused = false;
    this.resultShown = false;
    this.hud = background ? null : new Hud(this.match, controllers, () => this.togglePause());
    if (this.hud) mount(this.ui, this.hud.el);
    this.screenKeys = background ? this.screenKeys : (code) => this.fightKeys(code);
  }

  private frame(t: number) {
    // Whatever goes wrong this frame, keep the loop going.
    try {
      this.tick(t);
    } catch (e) {
      console.error(e);
    }
    requestAnimationFrame((n) => this.frame(n));
  }

  private tick(t: number) {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    this.updateTouch();
    const controls = this.input.poll(dt * 1000);
    for (const code of this.input.takePressed()) {
      if (code.startsWith('Pad')) this.padPress(code);
      else this.screenKeys?.(code);
    }

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
      // Slow motion for a moment after a really big hit (real time keeps running for the timer).
      if (this.hud) {
        for (const hit of m.bigHits) {
          if (this.settings.shake) this.view.shake(Math.min(1, hit.energy / 8000));
          this.hud.bigHit(hit.energy);
          if (this.settings.slowMotion && hit.energy > BIG_HIT * 2 && m.time - this.lastSlowmo > 4) { this.slowmo = 0.9; this.lastSlowmo = m.time; }
        }
      }
      m.bigHits.length = 0;
      const scale = this.slowmo > 0 ? 0.25 : 1;
      this.slowmo -= dt;
      m.update(dt * scale, inputs);
      // Attract mode: restart once something interesting has happened.
      if (!this.hud && (m.phase === 'over' || m.time > 60)) this.attract();
      if (this.hud && m.result && !this.resultShown && m.time > 0) this.showResultSoon();
    }
    this.view.render(this.paused ? 0 : dt);
    this.hud?.update(this.view, dt);
  }

  /**
   * A gamepad menu button. Mid-fight only Start (pause) counts — everything
   * else is driving. Otherwise the screen gets first go (robot select uses the
   * D-pad to change robots), then the D-pad moves between buttons, A presses,
   * B goes back.
   */
  private padPress(code: string) {
    const name = code.split(':')[1];
    const fighting = this.hud && !this.paused && !this.resultShown;
    if (this.garage) return;
    if (fighting) { if (name === 'Start') this.togglePause(); return; }
    if (this.screenKeys?.(code)) return;
    if (name === 'Start' && this.hud && this.paused) { this.togglePause(); return; }
    if (name === 'B' || name === 'Back') { this.screenKeys?.('Escape'); return; }
    if (name === 'A' || name === 'Start') {
      const el = document.activeElement;
      if (el instanceof HTMLButtonElement && this.ui.contains(el)) el.click();
      else this.moveFocus(1);
      return;
    }
    this.moveFocus(name === 'Up' || name === 'Left' ? -1 : 1);
  }

  /** Step focus through the buttons on screen (topmost dialog first). */
  private moveFocus(dir: 1 | -1) {
    const layer = [...this.ui.querySelectorAll('.overlay')].pop() ?? this.ui;
    const all = [...layer.querySelectorAll<HTMLElement>('button:not([disabled]), select')].filter((b) => b.offsetParent !== null);
    if (!all.length) return;
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next = all[at < 0 ? (dir > 0 ? 0 : all.length - 1) : (at + dir + all.length) % all.length];
    this.ui.querySelector('.pad-focus')?.classList.remove('pad-focus');
    next.classList.add('pad-focus');
    next.focus();
  }

  // ---------------------------------------------------------------- screens

  private mainMenu() {
    this.screenKeys = null;
    this.input.mode = 'menu';
    const touchOnly = window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;
    mount(this.ui, h('div', { class: 'screen' },
      h('h1', { class: 'title' }, 'Robot', h('br'), h('span', {}, 'Bash')),
      h('div', { class: 'tagline' }, 'Build it · Fight it · Break it'),
      h('div', { class: 'menu' },
        h('button', { class: 'primary', onclick: () => this.selectScreen() }, 'Fight'),
        h('button', { onclick: () => this.garageScreen() }, 'Garage'),
        h('button', { onclick: () => this.controlsScreen() }, 'Controls'),
        h('button', { onclick: () => this.settingsScreen() }, 'Settings'),
        h('button', { onclick: () => this.howToScreen() }, 'How to play')),
      (touchOnly || this.touchSeen) && h('div', { class: 'touch-note' }, 'On a phone or tablet: turn it sideways, steer with the stick bottom left and fire with the buttons bottom right. In the garage, tap Hide panels to test-drive.'),
      h('div', { class: 'hazard-bar' }),
      h('div', { class: 'footnote' }, 'A physics-simulated robot combat game in the spirit of the classic British TV show. Every hit is worked out from real forces — no hit points.')));
  }

  /** The garage, optionally with a robot on the bench; `back` is where Exit goes. */
  private garageScreen(initial?: RobotDesign, back: () => void = () => this.mainMenu()) {
    this.screenKeys = null;
    this.hud = null;
    this.input.mode = 'garage';
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
        // Rebuilding after an edit: keep looking from where you were.
        this.view.setMatch(bay, this.garage !== null);
        this.view.cameraMode = 'follow';
        this.view.followIndex = 0;
      },
      bay: () => this.match,
      exit: () => { this.garage = null; this.view.highlight(null); this.view.setGizmo(null); this.attract(); back(); },
      highlight: (id) => this.view.highlight(id),
      gizmo: (opts) => this.view.setGizmo(opts),
      onPick: (cb) => { this.pickHandler = cb; },
    }, initial);
    this.garage = garage;
    mount(this.ui, garage.el);
  }

  private selectScreen() {
    this.input.mode = 'menu';
    const saved = loadDesigns();
    this.roster = [...TEMPLATES, ...this.allHouse, ...saved];
    this.pickIds = [0, 1].map((p) => this.pick(p).id);
    const n = () => this.roster.length;
    const step = (p: number, d: number) => {
      const i = this.roster.indexOf(this.pick(p));
      this.pickIds[p] = this.roster[(i + d + n()) % n()].id;
      render();
    };
    // Change robot with each player's own turn-left / turn-right keys.
    const turnKeys = (p: number) => (['left', 'right'] as const).map((a) => this.profiles[p].bindings[a].find((b) => b.device === 'key'));
    const render = () => {
      const cards = [0, 1].map((p) => {
        const design = this.pick(p);
        const stats = computeStats(design);
        const mine = saved.includes(design);
        const house = this.allHouse.includes(design);
        const issues = scrutineer(design);
        const group = (label: string, list: RobotDesign[]) => list.length
          ? h('optgroup', { label }, ...list.map((d) => h('option', { value: d.id, selected: d === design }, d.name)))
          : null;
        const pick = h('select', {
          class: 'robot-pick', 'aria-label': `Player ${p + 1} robot`,
          onchange: () => { this.pickIds[p] = pick.value; pick.blur(); render(); },
        }, group('Starter robots', TEMPLATES), group('House robots', HOUSE_ROBOTS), group('Overpowered house robots', MONSTER_HOUSE), group('Your builds', saved));
        const cycle = (d: number) => step(p, d);
        const [kl, kr] = turnKeys(p);
        const setCtl = (c: Controller) => { this.controllers[p] = c; render(); };
        return h('div', { class: 'robot-card', style: `--pc:${PLAYER_COLOURS[p]}` },
          h('div', { class: 'who' }, `Player ${p + 1}`,
            h('span', { class: 'seg' },
              ...(['Human', 'CPU'] as Controller[]).map((c) => h('button', { class: this.controllers[p] === c ? 'on' : '', onclick: () => setCtl(c) }, c)))),
          h('div', { class: 'picker' },
            h('button', { onclick: () => cycle(-1), 'aria-label': 'Previous robot' }, '◀'),
            h('div', { class: 'name', style: `color:${design.colour}` }, design.name),
            h('button', { onclick: () => cycle(1), 'aria-label': 'Next robot' }, '▶')),
          pick,
          mine && h('div', { class: 'mine' }, 'Your build'),
          house && h('div', { class: 'mine' }, 'House robot'),
          h('div', { class: 'desc' }, design.description),
          h('dl', { class: 'stats' }, ...statLines(stats).flatMap(([k, v, bad]) => [h('dt', {}, k), h('dd', { class: bad ? 'over' : '' }, v)])),
          house
            ? h('div', { class: 'legal' }, 'Built to house-robot rules, not the competition\'s: far over the heavyweight limit.')
            : !isLegal(issues) && h('div', { class: 'legal bad' }, `Fails heavyweight scrutineering: ${issues.find((i) => i.level === 'error')!.text}`),
          h('div', { class: 'keys-hint' }, kl && kr ? `${describeBinding(kl)} / ${describeBinding(kr)} to change robot` : 'Use ◀ ▶ to change robot', ` · pad ${p + 1} D-pad`),
          h('button', { class: 'small', style: 'margin-top:8px', onclick: () => this.garageScreen(design, () => this.selectScreen()) }, mine ? 'Edit in garage' : 'Open a copy in the garage'));
      });
      const sets: Array<[HouseSet, string]> = [['classic', 'Classic'], ['overpowered', 'Overpowered'], ['mixed', 'Mixed']];
      const setHouse = (v: HouseSet) => { this.settings.houseSet = v; saveSettings(this.settings); render(); };
      mount(this.ui, h('div', { class: 'screen top' },
        h('h2', {}, 'Choose your robots'),
        h('div', { class: 'select-row' }, ...cards),
        h('div', { class: 'house-row' }, h('span', {}, 'House robots'),
          h('span', { class: 'seg' }, ...[0, 1, 2, 4].map((n) => h('button', { class: this.houseCount === n ? 'on' : '', onclick: () => { this.houseCount = n; render(); } }, n === 0 ? 'Off' : String(n)))),
          this.houseCount > 0 && h('span', { class: 'seg' }, ...sets.map(([v, label]) => h('button', { class: this.settings.houseSet === v ? 'on' : '', onclick: () => setHouse(v) }, label))),
          h('span', { class: 'hint' }, this.houseCount ? houseLineup(this.settings.houseSet).slice(0, this.houseCount).map((d) => d.name).join(', ') + ' guard the corner patrol zones.' : 'No house robots — just you two.')),
        h('div', { class: 'actions' },
          h('button', { onclick: () => this.mainMenu() }, 'Back'),
          h('button', { class: 'primary', onclick: () => this.fight() }, 'Fight! (Enter)'))));
    };
    this.screenKeys = (code) => {
      for (const p of [0, 1]) {
        const [kl, kr] = turnKeys(p);
        if (code === kl?.code || code === `Pad${p}:Left`) { step(p, -1); return true; }
        if (code === kr?.code || code === `Pad${p}:Right`) { step(p, 1); return true; }
      }
      // Enter on a focused button presses that button, not Fight.
      const focused = document.activeElement instanceof HTMLButtonElement || document.activeElement instanceof HTMLSelectElement;
      if ((code === 'Enter' && !focused) || code.endsWith(':Start')) { this.fight(); return true; }
      if (code === 'Escape') this.mainMenu();
      return false;
    };
    render();
  }

  private settingsScreen() {
    this.screenKeys = (code) => { if (code === 'Escape') this.mainMenu(); };
    const st = this.settings;
    const set = <K extends keyof Settings>(k: K, v: Settings[K]) => { st[k] = v; saveSettings(st); render(); };
    const row = <K extends keyof Settings>(label: string, k: K, options: Array<[Settings[K], string]>, hint: string) =>
      h('div', { class: 'setting' },
        h('div', { class: 'slabel' }, label),
        h('span', { class: 'seg' }, ...options.map(([v, text]) => h('button', { class: st[k] === v ? 'on' : '', onclick: () => set(k, v) }, text))),
        h('div', { class: 'hint' }, hint));
    const onOff: Array<[boolean, string]> = [[true, 'On'], [false, 'Off']];
    const render = () => mount(this.ui, h('div', { class: 'screen top' },
      h('h2', {}, 'Settings'),
      h('div', { class: 'settings' },
        row('Damage', 'damage', [['realistic', 'Realistic'], ['brutal', 'Brutal']], 'Brutal doubles every hit: armour tears off sooner and more fights end in a knockout.'),
        row('Fight length', 'fightLength', [[90, '1:30'], [180, '3:00'], [300, '5:00']], 'How long until the judges decide.'),
        row('Finale', 'finale', onOff, 'In the last 30 seconds the pit opens and the house robots leave their corners and come for everyone.'),
        row('Referee breaks', 'breaks', onOff, 'Two robots shoving nose to nose and going nowhere for 5 seconds get pulled apart by the referee.'),
        row('House robots', 'houseSet', [['classic', 'Classic'], ['overpowered', 'Overpowered'], ['mixed', 'Mixed']], 'Overpowered: a 1.3 m full-body spinner, a 125 kN hydraulic spike, a giant clamp-lifter and a flame-throwing flipper.'),
        row('Slow motion', 'slowMotion', onOff, 'Time slows for a moment after a really big hit.'),
        row('Camera shake', 'shake', onOff, 'The camera shakes on big hits.')),
      h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => this.mainMenu() }, 'Back'))));
    render();
  }

  private controlsScreen() {
    // Esc while binding a key just cancels the binding (the capture eats it); otherwise it's Back.
    this.screenKeys = (code) => { if (code === 'Escape') { this.input.cancelCapture(); this.mainMenu(); } };
    this.input.mode = 'menu';
    mount(this.ui, controlsScreen(this.profiles, this.input, (p) => {
      saveProfiles(p);
      this.input.setProfiles(p);
    }, () => this.mainMenu()));
  }

  private howToScreen() {
    this.screenKeys = (code) => { if (code === 'Escape') this.mainMenu(); };
    this.input.mode = 'menu';
    const kb = (k: string) => h('kbd', {}, k);
    mount(this.ui, h('div', { class: 'screen top' },
      h('h2', {}, 'How to play'),
      h('div', { class: 'howto' },
        h('h3', {}, 'Winning'),
        h('ul', {},
          h('li', {}, 'Immobilise your opponent: if a robot can\'t move under its own power for a few seconds, the referee counts to 10. Being shoved about by a house robot doesn\'t count as moving.'),
          h('li', {}, 'Throw them out of the arena, or into the pit — drive over the red pit release button to open it.'),
          h('li', {}, 'If both survive 3 minutes, the judges score aggression, control, damage and style.')),
        h('h3', {}, 'Default controls'),
        h('ul', {},
          h('li', {}, 'Player 1: ', kb('W'), kb('A'), kb('S'), kb('D'), ' drive · ', kb('E'), ' or ', kb('Space'), ' weapon 1 · ', kb('Q'), ' weapon 2 · ', kb('Z'), kb('X'), ' weapons 3 and 4 · ', kb('C'), ' macro'),
          h('li', {}, 'Player 2: ', kb('I'), kb('J'), kb('K'), kb('L'), ' or arrows drive · ', kb('O'), ', ', kb('/'), ' or right ', kb('Shift'), ' weapon 1 · ', kb('U'), ' or ', kb('.'), ' weapon 2 · ', kb('H'), kb('N'), ' weapons 3 and 4 · ', kb('M'), ' macro'),
          h('li', {}, 'Gamepads: left stick drives, A / RT weapon 1, B / LT weapon 2, X and Y weapons 3 and 4, Start pauses. In menus the D-pad moves, A picks, B goes back.'),
          h('li', {}, kb('Esc'), ' pauses (or the Pause button) · ', kb('Tab'), ' cycles the damage display: health diagrams, full report, off'),
          h('li', {}, 'Everything can be remapped under Controls, including tank-style steering.'),
          h('li', {}, 'Phone or tablet: turn it sideways. The stick bottom left drives, the buttons bottom right fire (labelled with what they do). Tap the damage label at the top to cycle the display. In the garage, Hide panels to test-drive; pinch to zoom.')),
        h('h3', {}, 'Driving'),
        h('ul', {},
          h('li', {}, 'Drive keys build up to full power over a quarter of a second: tap for a small nudge, hold to charge. Let go and the motors brake.'),
          h('li', {}, 'Spinner and drum buttons are on/off switches: press once to spin up, again to stop. Flippers, axes, crushers and rams fire while you hold the button.'),
          h('li', {}, 'The default macro (', kb('C'), ' / ', kb('M'), ') fires weapon 1 and backs off. On a spinner that flicks it off — change it under Controls.'),
          h('li', {}, 'Upside down? Your controls are reversed — just like the real thing. Flippers can self-right, and invertible robots (wheels poking out top and bottom) just keep going.')),
        h('h3', {}, 'The arena'),
        h('ul', {},
          h('li', {}, 'House robots guard the four corner patrol zones and attack anything that strays in. Once a robot is being counted out, they come out for it. You can also pick them to fight with.'),
          h('li', {}, 'The striped floor flipper throws whatever parks on it. The flame pit burns on a cycle: tyres and plastic cook, steel shrugs it off.')),
        h('h3', {}, 'It\'s physics, not hit points'),
        h('ul', {},
          h('li', {}, 'Flippers are driven by gas pressure on a ram, and you only have so much gas — watch the gauge.'),
          h('li', {}, 'Spinners take seconds to spin up, store real energy, and lose speed every time they hit.'),
          h('li', {}, 'Armour dents, then tears off. Hard landings and big hits shake up the battery, speed controllers and motors inside. Lose a wheel and you\'ll drive in circles.'),
          h('li', {}, 'What you\'re made of matters: hardened-steel teeth bite deep into aluminium and plastic, and barely mark hardened steel. Saws and chainsaws cut as they slide; crushers and spikes pierce once they push hard enough.')),
        h('h3', {}, 'The referee'),
        h('ul', {},
          h('li', {}, 'Locked together nose to nose for 5 seconds, going nowhere? The referee breaks you up.'),
          h('li', {}, 'With the finale on, the last 30 seconds open the pit and let the house robots loose. Try the Overpowered house robots in Settings if you\'re feeling brave.'))),
      h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => this.mainMenu() }, 'Back'))));
  }

  private fightKeys(code: string) {
    if (code === 'Escape') this.togglePause();
    if (code === 'Tab' && this.hud) this.hud.cycleReport();
  }

  private togglePause() {
    if (!this.hud || this.resultShown) return;
    this.paused = !this.paused;
    this.input.mode = this.paused ? 'menu' : 'fight';
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
    this.input.mode = 'menu';
    this.ui.append(h('div', { class: 'overlay' },
      h('div', { class: 'dialog' },
        h('div', { class: 'reason' }, winner ? 'Winner' : 'Result'),
        h('div', { class: 'winner', style: `color:${winner?.colour ?? '#fff'}` }, winner?.name ?? (scores ? 'Draw' : 'Nobody')),
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
