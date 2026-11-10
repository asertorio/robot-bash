import RAPIER from '@dimforge/rapier3d-compat';
import { checkDesign, loadDesigns } from './data/garage';
import { HOUSE_ROBOTS, MONSTER_HOUSE, houseLineup, type HouseSet } from './data/house';
import { damageScale, loadSettings, saveSettings, type Settings } from './data/settings';
import { CRASH_TEST_DUMMY, TEMPLATES, OPEN_CLASS } from './data/templates';
import { describeBinding, loadProfiles, saveProfiles, type ControlProfile } from './input/bindings';
import { InputManager } from './input/input';
import { MatchView } from './render/view';
import { CpuDriver } from './sim/ai';
import type { RobotDesign } from './sim/design';
import { BIG_HIT, Match, type MatchOptions } from './sim/match';
import { applyState, captureState, fromWire, toWire, type NetState } from './sim/netstate';
import { NetLink, newRoomCode, type NetMessage } from './net/link';
import type { ControlState } from './sim/control';
import { isLegal, scrutineer } from './sim/rules';
import { computeStats } from './sim/stats';
import { controlsScreen } from './ui/controls';
import { Garage, takeSharedDesign } from './ui/garage';
import { h, mount } from './ui/dom';
import { statLines } from './ui/format';
import { Hud, PLAYER_COLOURS } from './ui/hud';
import { TouchControls, buttonLabel } from './ui/touch';
import { SoundEngine } from './audio/sound';
import { Commentator } from './audio/voice';
import { REPLAY, ReplayPlayer, ReplayRecorder, type Clip } from './render/replay';
import type { Robot } from './sim/robot';

type Controller = 'Human' | 'CPU' | 'Remote';

/** Snapshots a second the host sends the guest. */
const NET_RATE = 30;
const IDLE: ControlState = { left: 0, right: 0, weapon: false, weapon2: false };

/** An online fight in progress (or its lobby). */
interface NetSession {
  link: NetLink;
  /** Host: the guest's robot once it's said hello. */
  guestDesign: RobotDesign | null;
  /** Host: the guest's latest controls. */
  remote: ControlState;
  /** Host: commentary already sent, and big hits / impacts since the last snapshot. */
  sentLines: number;
  bigHits: Array<{ point: { x: number; y: number; z: number }; energy: number }>;
  impacts: Array<{ point: { x: number; y: number; z: number }; energy: number }>;
  lastSend: number;
  /** Guest: the last two snapshots and when the newer arrived (ms), for blending. */
  prev: NetState | null;
  latest: NetState | null;
  latestAt: number;
  /** Host: show the lobby again (after a fight). */
  lobby: (() => void) | null;
}

class App {
  private ui = document.getElementById('ui')!;
  private view = new MatchView(document.getElementById('view') as HTMLCanvasElement);
  private profiles: ControlProfile[] = loadProfiles();
  private input = new InputManager(this.profiles);
  private match: Match | null = null;
  private hud: Hud | null = null;
  private cpus: (CpuDriver | null)[] = [];
  /** Each player's robot, by design id (indices would shift when a saved robot is deleted). */
  private pickIds = [TEMPLATES[1].id, TEMPLATES[2].id, TEMPLATES[0].id, TEMPLATES[3].id];
  private roster: RobotDesign[] = TEMPLATES;
  private garage: Garage | null = null;
  private pickHandler: ((id: string | null) => void) | null = null;
  private controllers: Controller[] = ['Human', 'CPU', 'CPU', 'CPU'];
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
  private sound = new SoundEngine();
  private voice = new Commentator();
  private recorder = new ReplayRecorder();
  /** An action replay on screen, and the banner over it. */
  private replay: { player: ReplayPlayer; banner: HTMLElement; then: () => void } | null = null;
  /** A touch screen is in use: show on-screen controls where they're needed. */
  private net: NetSession | null = null;
  /** Who's driving each competitor in the fight that's on now. */
  private live: Controller[] = [];
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
    // Browsers only start audio from a click, tap or key press.
    this.sound.setLevel(this.settings.sound);
    this.voice.setMode(this.settings.voice);
    const unlock = () => this.sound.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    this.ui.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest?.('button')) this.sound.click(); });
    this.attract();
    this.mainMenu();
    // Opened from a share link (#robot=…): put that robot on the garage bench.
    void takeSharedDesign().then((d) => { if (d) this.garageScreen(d); });
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
        const i = this.live.indexOf('Human');
        // Online, this device's player is always local player 1, whichever robot that is.
        if (i >= 0) { player = this.net ? 0 : i; robot = m.competitors[i]; }
      }
    }
    this.touch.show(player !== null);
    this.input.touch = player !== null ? this.touch.state : null;
    this.input.touchPlayer = player ?? 0;
    this.input.touchPose = robot && this.settings.stick === 'point'
      ? { camera: this.view.groundForward(), rotation: robot.rotation, inverted: robot.uprightness < 0 }
      : null;
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
    // A different scrap each time: two random starter robots, sometimes a four-way melee.
    const n = Math.random() < 0.35 ? 4 : 2;
    const pool = [...TEMPLATES].sort(() => Math.random() - 0.5).slice(0, n);
    try {
      this.beginMatch(pool, pool.map(() => 'CPU'), true, 2);
    } catch {
      this.beginMatch([TEMPLATES[0], TEMPLATES[2]], ['CPU', 'CPU'], true, 2);
    }
  }

  /** How many competitors: 2 for a duel, 3 or 4 for a melee (the show's first round). */
  private get robotCount(): number {
    return Math.min(4, Math.max(2, Math.round(this.settings.robots) || 2));
  }

  private fight() {
    const n = this.robotCount;
    this.beginMatch([...Array(n).keys()].map((p) => this.pick(p)), this.controllers.slice(0, n), false, this.houseCount);
  }

  /** All the house robots, both sets. */
  private get allHouse(): RobotDesign[] {
    return [...HOUSE_ROBOTS, ...MONSTER_HOUSE];
  }

  /** The options a fight starts with, from Settings. */
  private fightOptions(background: boolean, houseCount: number): MatchOptions {
    const st = this.settings;
    return {
      duration: background ? 1e9 : st.fightLength,
      house: (background ? HOUSE_ROBOTS : houseLineup(st.houseSet)).slice(0, houseCount),
      damageScale: background ? 1 : damageScale(st),
      breaks: st.breaks,
      finale: !background && st.finale,
    };
  }

  private beginMatch(designs: RobotDesign[], controllers: Controller[], background = false, houseCount = 0, preset?: MatchOptions) {
    // Build the new fight before throwing the old one away, so a robot that
    // can't be built leaves things as they were.
    const st = this.settings;
    let match: Match;
    try {
      match = new Match(designs, preset ?? this.fightOptions(background, houseCount));
    } catch (e) {
      if (background) throw e;
      alert(`That fight can't start: ${(e as Error).message}`);
      return false;
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
    this.live = controllers;
    this.cpus = controllers.map((c) => (c === 'CPU' ? new CpuDriver() : null));
    this.view.setMatch(this.match);
    this.stopReplay();
    this.recorder.reset(background ? null : this.match);
    this.sound.setMatch(this.match, background);
    this.voice.setMatch(background ? null : this.match);
    this.paused = false;
    this.resultShown = false;
    this.hud = background ? null : new Hud(this.match, controllers, () => this.togglePause(), () => this.cycleCamera());
    if (!background && st.camera === 'chase') {
      this.view.startChase(this.chaseDefault());
      this.hud?.cameraLabel(this.match.competitors[this.view.followIndex]?.design.name ?? null);
    }
    if (this.hud) mount(this.ui, this.hud.el);
    this.screenKeys = background ? this.screenKeys : (code) => this.fightKeys(code);
    return true;
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
    } else if (m && (!this.paused || this.net)) {
      // Online the fight goes on while a menu is open: the other player's still driving.
      const net = this.net;
      // The guest mirrors the host only while a fight's on (behind the lobby it's an ordinary attract fight).
      const guest = net?.link.role === 'guest' && this.hud !== null;
      if (guest) {
        // Send my controls; draw the host's fight, blended between its last two snapshots.
        net!.link.send({ type: 'ctl', c: this.paused ? IDLE : controls[0] });
        if (net!.latest) {
          const alpha = Math.min(1, (performance.now() - net!.latestAt) / (1000 / NET_RATE));
          applyState(m, net!.latest, net!.prev, alpha);
        }
      }
      const live = this.hud && !this.paused ? controls : [];
      const inputs = m.competitors.map((r, i) => {
        const cpu = this.cpus[i];
        if (cpu) return cpu.update(r, cpu.chooseFoe(r, m.competitors.filter((_, j) => j !== i && !m.eliminated[j])), m.arena.pitOpen, dt);
        if (this.live[i] === 'Remote') return net?.remote ?? IDLE;
        return live[i] ?? IDLE;
      });
      // Slow motion for a moment after a really big hit (real time keeps running for the timer).
      if (this.hud) {
        for (const hit of m.bigHits) {
          if (this.settings.shake) this.view.shake(Math.min(1, hit.energy / 8000));
          this.hud.bigHit(hit.energy);
          this.sound.bigHit(hit.energy);
          this.recorder.bigHit(m.time, hit.energy, hit.point);
          if (!net && this.settings.slowMotion && hit.energy > BIG_HIT * 2 && m.time - this.lastSlowmo > 4) { this.slowmo = 0.9; this.lastSlowmo = m.time; }
        }
      }
      m.bigHits.length = 0;
      if (!guest) {
        const scale = this.slowmo > 0 ? 0.25 : 1;
        this.slowmo -= dt;
        m.update(dt * scale, inputs);
      }
      if (net && !guest && this.hud) this.sendState(m, net);
      // Attract mode: restart once something interesting has happened.
      if (!this.hud && (m.phase === 'over' || m.time > 60)) this.attract();
      if (this.hud && m.result && !this.resultShown && m.time > 0) this.showResultSoon();
    }
    if (m && this.replay) this.playReplay(m, dt);
    else if (m && this.hud && !this.garage) this.recorder.record(m);
    if (m && (!this.paused || this.net)) this.sound.update(m, dt, this.view.camera.position);
    this.voice.update();
    this.view.render(this.paused && !this.net ? 0 : dt);
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
    if (fighting) { if (name === 'Start') this.togglePause(); if (name === 'Back') this.cycleCamera(); return; }
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
    // The main menu is the way out of an online session.
    this.endNet();
    this.screenKeys = null;
    this.input.mode = 'menu';
    const touchOnly = window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;
    mount(this.ui, h('div', { class: 'screen' },
      h('h1', { class: 'title' }, 'Robot', h('br'), h('span', {}, 'Bash')),
      h('div', { class: 'tagline' }, 'Build it · Fight it · Break it'),
      h('div', { class: 'menu' },
        h('button', { class: 'primary', onclick: () => this.selectScreen() }, 'Fight'),
        h('button', { onclick: () => this.onlineScreen() }, 'Play online'),
        h('button', { onclick: () => this.garageScreen() }, 'Garage'),
        h('button', { onclick: () => this.controlsScreen() }, 'Controls'),
        h('button', { onclick: () => this.settingsScreen() }, 'Settings'),
        h('button', { onclick: () => this.howToScreen() }, 'How to play')),
      (touchOnly || this.touchSeen) && h('div', { class: 'touch-note' }, 'On a phone or tablet: turn it sideways, push the stick bottom left the way you want to go on screen and fire with the buttons bottom right. In the garage, tap Hide panels to test-drive.'),
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
        this.sound.setMatch(bay);
        this.voice.setMatch(null);
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
    this.roster = [...TEMPLATES, ...OPEN_CLASS, ...this.allHouse, ...saved];
    this.pickIds = [0, 1, 2, 3].map((p) => this.pick(p).id);
    const n = () => this.roster.length;
    const step = (p: number, d: number) => {
      const i = this.roster.indexOf(this.pick(p));
      this.pickIds[p] = this.roster[(i + d + n()) % n()].id;
      render();
    };
    // Change robot with each player's own turn-left / turn-right keys.
    const turnKeys = (p: number) => (['left', 'right'] as const).map((a) => this.profiles[p]?.bindings[a].find((b) => b.device === 'key'));
    const render = () => {
      const n = this.robotCount;
      const cards = [...Array(n).keys()].map((p) => {
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
        return h('div', { class: `robot-card${n > 2 ? ' compact' : ''}`, style: `--pc:${PLAYER_COLOURS[p]}` },
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
            : OPEN_CLASS.includes(design) ? h('div', { class: 'legal' }, 'Open class: its weapon is banned in the weight classes, but anything goes here.')
            : !isLegal(issues) && h('div', { class: 'legal bad' }, `Fails heavyweight scrutineering: ${issues.find((i) => i.level === 'error')!.text}`),
          h('div', { class: 'keys-hint' }, kl && kr ? `${describeBinding(kl)} / ${describeBinding(kr)} to change robot` : 'Use ◀ ▶ to change robot', ` · pad ${p + 1} D-pad`),
          p >= 2 && this.controllers[p] === 'Human' && h('div', { class: 'legal' }, `Drives with gamepad ${p + 1}.`),
          h('button', { class: 'small', style: 'margin-top:8px', onclick: () => this.garageScreen(design, () => this.selectScreen()) }, mine ? 'Edit in garage' : 'Open a copy in the garage'));
      });
      const sets: Array<[HouseSet, string]> = [['classic', 'Classic'], ['overpowered', 'Overpowered'], ['mixed', 'Mixed']];
      const setHouse = (v: HouseSet) => { this.settings.houseSet = v; saveSettings(this.settings); render(); };
      const setCount = (c: number) => { this.settings.robots = c; saveSettings(this.settings); render(); };
      mount(this.ui, h('div', { class: 'screen top' },
        h('h2', {}, 'Choose your robots'),
        h('div', { class: 'house-row', style: 'margin:0 0 14px' }, h('span', {}, 'Robots'),
          h('span', { class: 'seg' }, ...[2, 3, 4].map((c) => h('button', { class: n === c ? 'on' : '', onclick: () => setCount(c) }, c === 2 ? '1 v 1' : `${c}-way melee`))),
          h('span', { class: 'hint' }, n === 2 ? 'A straight duel.' : 'Everyone for themselves, like the first round of a heat: last robot standing wins, or the judges decide.')),
        h('div', { class: 'select-row' }, ...cards),
        h('div', { class: 'house-row' }, h('span', {}, 'House robots'),
          h('span', { class: 'seg' }, ...[0, 1, 2, 4].map((n) => h('button', { class: this.houseCount === n ? 'on' : '', onclick: () => { this.houseCount = n; render(); } }, n === 0 ? 'Off' : String(n)))),
          this.houseCount > 0 && h('span', { class: 'seg' }, ...sets.map(([v, label]) => h('button', { class: this.settings.houseSet === v ? 'on' : '', onclick: () => setHouse(v) }, label))),
          h('span', { class: 'hint' }, this.houseCount ? houseLineup(this.settings.houseSet).slice(0, this.houseCount).map((d) => d.name).join(', ') + ' guard the corner patrol zones.' : n === 2 ? 'No house robots — just you two.' : 'No house robots.')),
        h('div', { class: 'actions' },
          h('button', { onclick: () => this.mainMenu() }, 'Back'),
          h('button', { class: 'primary', onclick: () => this.fight() }, 'Fight! (Enter)'))));
    };
    this.screenKeys = (code) => {
      for (let p = 0; p < this.robotCount; p++) {
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
    const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
      st[k] = v;
      saveSettings(st);
      this.sound.setLevel(st.sound);
      this.voice.setMode(st.voice);
      render();
    };
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
        row('Sound', 'sound', [['loud', 'Loud'], ['quiet', 'Quiet'], ['off', 'Off']], 'Motors, spinners, impacts, pneumatics and the crowd — all made from what the physics is doing.'),
        row('Commentary voice', 'voice', [['highlights', 'Big moments'], ['full', 'Everything'], ['off', 'Off']], this.voice.available ? 'A spoken commentator, using your browser\'s voice. Big moments: knock-outs, big hits, the clock. Everything: every line in the feed, and some colour.' : 'Your browser has no speech voice, so the commentary is text only.'),
        row('Slow motion', 'slowMotion', onOff, 'Time slows for a moment after a really big hit.'),
        row('Action replays', 'replays', onOff, 'Before the result: the knockout (into the pit, over the wall) or the fight\'s biggest hit again, in slow motion.'),
        row('Camera shake', 'shake', onOff, 'The camera shakes on big hits.'),
        row('Fight camera', 'camera', [['tv', 'TV gantry'], ['chase', 'Behind your robot']], 'Where the camera starts. Press V (or Back on a pad, or the camera button) mid-fight to switch between the TV view and behind each robot.'),
        row('Touch stick', 'stick', [['point', 'Point to drive'], ['robot', 'Robot\'s view']], 'Phones and tablets. Point to drive: the robot goes the way you push the stick on screen. Robot\'s view: up is the robot\'s forward and sideways steers, like an RC transmitter.')),
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
    }, () => this.mainMenu(), { value: this.settings.stick, set: (v) => { this.settings.stick = v; saveSettings(this.settings); } }));
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
          h('li', {}, 'If both survive 3 minutes, the judges score aggression, control, damage and style.'),
          h('li', {}, 'Melees (3 or 4 robots, chosen on the select screen): last robot standing wins, or the judges score everyone. Players 3 and 4 use gamepads 3 and 4.'),
          h('li', {}, 'Play online: one device hosts and shows a four-letter code, the other joins with it. The host\'s device runs the fight.')),
        h('h3', {}, 'Default controls'),
        h('ul', {},
          h('li', {}, 'Player 1: ', kb('W'), kb('A'), kb('S'), kb('D'), ' drive · ', kb('E'), ' or ', kb('Space'), ' weapon 1 · ', kb('Q'), ' weapon 2 · ', kb('Z'), kb('X'), ' weapons 3 and 4 · ', kb('C'), ' macro'),
          h('li', {}, 'Player 2: ', kb('I'), kb('J'), kb('K'), kb('L'), ' or arrows drive · ', kb('O'), ', ', kb('/'), ' or right ', kb('Shift'), ' weapon 1 · ', kb('U'), ' or ', kb('.'), ' weapon 2 · ', kb('H'), kb('N'), ' weapons 3 and 4 · ', kb('M'), ' macro'),
          h('li', {}, 'Gamepads: left stick drives, A / RT weapon 1, B / LT weapon 2, X and Y weapons 3 and 4, Start pauses. In menus the D-pad moves, A picks, B goes back.'),
          h('li', {}, kb('Esc'), ' pauses (or the Pause button) · ', kb('Tab'), ' cycles the damage display: health diagrams, full report, off · ', kb('V'), ' (or a pad\'s Back, or the 🎥 button) switches between the TV camera and a camera behind each robot'),
          h('li', {}, 'Everything can be remapped under Controls, including tank-style steering.'),
          h('li', {}, 'Phone or tablet: turn it sideways. Push the stick bottom left the way you want to go on screen — the robot turns and drives that way (Settings → Touch stick switches to the robot\'s-view RC mix). The buttons bottom right fire (labelled with what they do). Tap the damage label at the top to cycle the display. In the garage, Hide panels to test-drive; pinch to zoom.')),
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

  /** Whose robot the chase camera starts behind: the first human's, else player 1's. */
  private chaseDefault(): number {
    return Math.max(0, this.live.indexOf('Human'));
  }

  /** V / pad Back / the camera button: TV → behind each competitor in turn (humans first) → TV. */
  private cycleCamera() {
    const m = this.match;
    if (!m || !this.hud) return;
    const n = m.competitors.length;
    const order = [...Array(n).keys()].sort((a, b) => Number(this.live[b] === 'Human') - Number(this.live[a] === 'Human'));
    const v = this.view;
    const at = v.cameraMode === 'chase' ? order.indexOf(v.followIndex) : -1;
    const next = order.slice(at + 1).find((i) => !m.eliminated[i]);
    if (next === undefined) v.cameraMode = 'tv';
    else v.startChase(next);
    this.hud.cameraLabel(v.cameraMode === 'chase' ? m.competitors[v.followIndex].design.name : null);
  }

  // ---------------------------------------------------------------- online

  /** Host: a snapshot for the guest, NET_RATE times a second. */
  private sendState(m: Match, net: NetSession) {
    // Collect every frame's big hits and impacts (they're cleared each frame here).
    for (const h of m.bigHits) net.bigHits.push(h);
    for (const h of m.impacts) if (net.impacts.length < 24) net.impacts.push(h);
    const now = performance.now();
    if (now - net.lastSend < 1000 / NET_RATE || !net.link.connected) return;
    net.lastSend = now;
    const st = captureState(m, net.sentLines);
    st.bigHits = net.bigHits.map((h) => ({ x: h.point.x, y: h.point.y, z: h.point.z, e: h.energy }));
    st.impacts = net.impacts.map((h) => ({ x: h.point.x, y: h.point.y, z: h.point.z, e: h.energy }));
    net.bigHits = [];
    net.impacts = [];
    net.sentLines = m.commentary.length;
    net.link.send({ type: 'state', s: toWire(st) });
  }

  private newSession(link: NetLink): NetSession {
    return { link, guestDesign: null, remote: IDLE, sentLines: 0, bigHits: [], impacts: [], lastSend: 0, prev: null, latest: null, latestAt: 0, lobby: null };
  }

  /** Close any online session (quietly: we're the ones leaving). */
  private endNet() {
    const net = this.net;
    if (!net) return;
    this.net = null;
    net.link.close();
  }

  /** The other side went away: say so and go back to the menu. */
  private netLost(why: string) {
    if (!this.net) return;
    this.net = null;
    this.hud = null;
    this.paused = false;
    this.attract();
    this.onlineScreen(why);
  }

  /** Every device's robot choice for online play: the starter robots, house robots and your builds. */
  private onlineRoster(): RobotDesign[] {
    return [...TEMPLATES, ...OPEN_CLASS, ...this.allHouse, ...loadDesigns()];
  }

  private robotPicker(onPick: () => void): HTMLSelectElement {
    const roster = this.onlineRoster();
    const current = roster.find((d) => d.id === this.pickIds[0]) ?? roster[0];
    this.pickIds[0] = current.id;
    const sel = h('select', { class: 'robot-pick', 'aria-label': 'Your robot', onchange: () => { this.pickIds[0] = sel.value; onPick(); } },
      ...roster.map((d) => h('option', { value: d.id, selected: d === current }, d.name)));
    return sel;
  }

  private onlineScreen(message?: string) {
    this.screenKeys = (code) => { if (code === 'Escape') this.mainMenu(); };
    this.input.mode = 'menu';
    mount(this.ui, h('div', { class: 'screen top' },
      h('h2', {}, 'Play online'),
      h('div', { class: 'howto', style: 'max-width:560px' },
        h('p', {}, 'Two phones, tablets or computers, each with this page open. One hosts and gets a four-letter code; the other joins with it. Same Wi-Fi or anywhere online.'),
        h('p', { class: 'hint' }, 'The host\'s device runs the physics and uses its own Settings; the other player\'s robot can be anything, even one from their own garage.'),
        message && h('p', { class: 'legal bad' }, message)),
      h('div', { class: 'menu' },
        h('button', { class: 'primary', onclick: () => this.hostLobby() }, 'Host a fight'),
        h('button', { onclick: () => this.joinScreen() }, 'Join with a code'),
        h('button', { onclick: () => this.mainMenu() }, 'Back'))));
  }

  private hostLobby() {
    this.endNet();
    const code = newRoomCode();
    let status = 'Connecting to the matchmaking server…';
    let ready = false;
    const link = NetLink.host(code, () => { ready = true; status = 'Waiting for someone to join…'; render(); }, (why) => { status = why; render(); });
    const net = this.newSession(link);
    this.net = net;
    const lobby = () => link.send({ type: 'lobby', host: this.pick0().name, guest: net.guestDesign?.name ?? null });
    link.onOpen = () => { status = 'Connected!'; lobby(); render(); };
    link.onClose = (why) => { net.guestDesign = null; status = `${why} Waiting for someone to join…`; if (this.hud) this.netLost(why); else render(); };
    link.onMessage = (msg) => {
      if (msg.type === 'hello') {
        try { net.guestDesign = checkDesign(msg.design); } catch (e) { status = `Their robot won't load: ${(e as Error).message}`; }
        lobby();
        if (!this.hud) render();
      } else if (msg.type === 'ctl') net.remote = msg.c;
      else if (msg.type === 'leave') { net.guestDesign = null; if (this.hud) this.netLost('The other player left.'); else { status = 'They left. Waiting for someone to join…'; render(); } }
    };
    this.screenKeys = (code2) => { if (code2 === 'Escape') { this.endNet(); this.onlineScreen(); } };
    const render = () => {
      if (this.net !== net || this.hud) return;
      const houseSeg = h('span', { class: 'seg' }, ...[0, 1, 2, 4].map((n) => h('button', { class: this.houseCount === n ? 'on' : '', onclick: () => { this.houseCount = n; render(); } }, n === 0 ? 'Off' : String(n))));
      mount(this.ui, h('div', { class: 'screen top' },
        h('h2', {}, 'Host a fight'),
        h('div', { class: 'room-code' }, ready ? code : '····'),
        h('div', { class: 'hint', style: 'text-align:center' }, ready ? 'On the other device: Play online → Join with a code, and type this in.' : ''),
        h('div', { class: 'house-row' }, h('span', {}, 'Your robot'), this.robotPicker(() => { lobby(); render(); })),
        h('div', { class: 'house-row' }, h('span', {}, 'Opponent'), h('span', { class: 'hint' }, net.guestDesign ? net.guestDesign.name : status)),
        h('div', { class: 'house-row' }, h('span', {}, 'House robots'), houseSeg),
        h('div', { class: 'actions' },
          h('button', { onclick: () => { this.endNet(); this.onlineScreen(); } }, 'Back'),
          h('button', { class: 'primary', disabled: !net.guestDesign || !link.connected, onclick: () => this.hostFight() }, 'Fight!'))));
    };
    net.lobby = () => { this.hud = null; this.paused = false; this.attract(); lobby(); render(); this.screenKeys = (c) => { if (c === 'Escape') { this.endNet(); this.onlineScreen(); } }; };
    render();
  }

  private pick0(): RobotDesign {
    return this.onlineRoster().find((d) => d.id === this.pickIds[0]) ?? TEMPLATES[0];
  }

  /** Host: start (or restart) the online fight and tell the guest. */
  private hostFight() {
    const net = this.net;
    if (!net || net.link.role !== 'host' || !net.guestDesign) return;
    const designs = [this.pick0(), net.guestDesign];
    const opts = this.fightOptions(false, this.houseCount);
    if (!this.beginMatch(designs, ['Human', 'Remote'], false, 0, opts)) return;
    net.sentLines = 0;
    net.bigHits = [];
    net.impacts = [];
    net.link.send({ type: 'start', designs, house: opts.house ?? [], duration: opts.duration ?? 180, damageScale: opts.damageScale ?? 1, breaks: opts.breaks ?? true, finale: opts.finale ?? false });
  }

  private joinScreen(message = '') {
    this.endNet();
    let status = message;
    let joined = false;
    let host: string | null = null;
    const input = h('input', { type: 'text', class: 'code-input', maxlength: '4', placeholder: 'CODE', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
    const join = () => {
      const code = input.value.trim().toUpperCase();
      if (code.length !== 4) { status = 'The code is four letters.'; render(); return; }
      this.endNet();
      status = 'Connecting…';
      const link = NetLink.join(code, (why) => { status = why; joined = false; this.net = null; render(); });
      const net = this.newSession(link);
      this.net = net;
      link.onOpen = () => { joined = true; status = 'Connected — waiting for the host to start the fight.'; link.send({ type: 'hello', design: this.pick0() }); render(); };
      link.onClose = (why) => this.hud ? this.netLost(why) : (this.net = null, joined = false, status = why, render());
      link.onMessage = (msg) => this.guestMessage(net, msg, (m) => {
        host = m.host;
        // Back from a fight: the lobby again, where you can change robot for the next one.
        if (this.hud) { this.hud = null; this.paused = false; this.attract(); status = `${m.host} is choosing the next fight…`; this.screenKeys = keys; }
        render();
      });
      render();
    };
    const keys = (code: string) => {
      if (code === 'Escape') { this.endNet(); this.onlineScreen(); }
      if (code === 'Enter' && !joined) join();
    };
    this.screenKeys = keys;
    const render = () => {
      if (this.hud) return;
      mount(this.ui, h('div', { class: 'screen top' },
        h('h2', {}, 'Join a fight'),
        !joined && h('div', { class: 'house-row' }, h('span', {}, 'Room code'), input),
        h('div', { class: 'house-row' }, h('span', {}, 'Your robot'), this.robotPicker(() => { if (joined) this.net?.link.send({ type: 'hello', design: this.pick0() }); })),
        host && h('div', { class: 'house-row' }, h('span', {}, 'Host'), h('span', { class: 'hint' }, host)),
        status && h('p', { class: 'hint', style: 'text-align:center' }, status),
        h('div', { class: 'actions' },
          h('button', { onclick: () => { this.endNet(); this.onlineScreen(); } }, 'Back'),
          !joined && h('button', { class: 'primary', onclick: join }, 'Join'))));
      if (!joined) setTimeout(() => input.focus(), 0);
    };
    render();
  }

  private guestMessage(net: NetSession, msg: NetMessage, lobby: (m: Extract<NetMessage, { type: 'lobby' }>) => void) {
    if (this.net !== net) return;
    if (msg.type === 'lobby') lobby(msg);
    else if (msg.type === 'leave') this.netLost('The host left.');
    else if (msg.type === 'start') {
      // The same fight as the host's, built from the same designs: it's never stepped here.
      let designs: RobotDesign[], house: RobotDesign[];
      try { designs = msg.designs.map(checkDesign); house = msg.house.map(checkDesign); } catch (e) { this.netLost(`Couldn't load the host's fight: ${(e as Error).message}`); return; }
      net.prev = net.latest = null;
      this.beginMatch(designs, ['Remote', 'Human'], false, 0, { duration: msg.duration, house, damageScale: msg.damageScale, breaks: msg.breaks, finale: msg.finale });
    } else if (msg.type === 'state') {
      const m = this.match;
      if (!m || !this.hud) return;
      const s = fromWire(msg.s);
      net.prev = net.latest;
      net.latest = s;
      net.latestAt = performance.now();
      // Sparks, clangs and big-hit effects, once each.
      for (const p of s.impacts) m.impacts.push({ point: { x: p.x, y: p.y, z: p.z }, energy: p.e });
      for (const p of s.bigHits) m.bigHits.push({ point: { x: p.x, y: p.y, z: p.z }, energy: p.e });
      // Commentary goes straight in (the blend between snapshots only moves things).
      applyState(m, s, net.prev, 0);
    }
  }

  private fightKeys(code: string) {
    if (this.replay) { this.stopReplay(true); return; }
    // Result on screen: Enter is a rematch (online, only the host can start one).
    if (code === 'Enter' && this.resultShown && this.ui.querySelector('.overlay .winner') && !(document.activeElement instanceof HTMLButtonElement)) {
      if (!this.net) this.fight();
      else if (this.net.link.role === 'host') this.hostFight();
      return;
    }
    if (code === 'KeyV') this.cycleCamera();
    if (code === 'Escape') this.togglePause();
    if (code === 'Tab' && this.hud) this.hud.cycleReport();
  }

  private togglePause() {
    if (!this.hud || this.resultShown) return;
    this.paused = !this.paused;
    this.sound.pause(this.paused);
    if (this.paused) this.voice.stop();
    this.input.mode = this.paused ? 'menu' : 'fight';
    this.ui.querySelector('.overlay')?.remove();
    if (!this.paused) return;
    if (this.net) {
      // Online nothing stops: this is just a menu over the fight.
      this.ui.append(h('div', { class: 'overlay' },
        h('div', { class: 'dialog' },
          h('h2', {}, 'Menu'),
          h('p', { class: 'hint' }, 'The fight carries on — your robot sits still while this is open.'),
          h('div', { class: 'menu' },
            h('button', { class: 'primary', onclick: () => this.togglePause() }, 'Back to the fight'),
            this.net.link.role === 'host' && h('button', { onclick: () => this.hostFight() }, 'Restart fight'),
            h('button', { onclick: () => this.leaveFight(() => this.onlineScreen()) }, 'Leave online fight')))));
      return;
    }
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
    this.endNet();
    this.hud = null;
    this.attract();
    next();
  }

  private showResultSoon() {
    this.resultShown = true;
    const m = this.match;
    setTimeout(() => {
      // Still the same fight (not a rematch or a quit in the meantime)?
      if (this.match !== m || !this.hud) return;
      const clip = this.settings.replays ? this.pickClip() : null;
      if (clip) this.startReplay(clip, () => this.showResult());
      else this.showResult();
    }, clipDelay(this.settings.replays));
  }

  /** The moment worth seeing again: a robot going in the pit or over the wall, else the biggest hit. */
  private pickClip(): Clip | null {
    const m = this.match!;
    const out = m.outOrder[m.outOrder.length - 1];
    const how = out !== undefined ? m.eliminated[out] : null;
    if (how === 'into the pit' || how === 'out of the arena') {
      const clip = this.recorder.last(REPLAY.knockout, this.recorder.chassisIndex(m, out), `${m.competitors[out].design.name} goes ${how}`);
      if (clip) return clip;
    }
    const best = this.recorder.bestHit();
    return best ? { ...best, title: `The biggest hit · ${(best.energy / 1000).toFixed(1)} kJ` } : null;
  }

  private startReplay(clip: Clip, then: () => void) {
    this.stopReplay();
    const banner = h('div', { class: 'replay-banner', onclick: () => this.stopReplay(true) },
      h('div', { class: 'rb-title' }, 'Action replay'),
      h('div', { class: 'rb-sub' }, clip.title),
      h('div', { class: 'rb-skip' }, this.touchSeen ? 'Tap to skip' : 'Any key to skip'));
    this.ui.append(banner);
    if (this.hud) this.hud.el.style.visibility = 'hidden';
    this.replay = { player: new ReplayPlayer(clip), banner, then };
    this.voice.say(['Let\'s see that again!', 'Here it is again, in slow motion.', 'Watch this!'][Math.floor(Math.random() * 3)]);
  }

  private playReplay(m: Match, dt: number) {
    const rp = this.replay!;
    const frame = rp.player.advance(dt);
    this.view.setReplay(frame);
    // Sparks and clangs as the hits come round again.
    for (const i of frame.impacts) if (m.impacts.length < 48) m.impacts.push(i);
    if (rp.player.done) this.stopReplay(true);
  }

  /** End a replay; `next` runs what was waiting for it (the result). */
  private stopReplay(next = false) {
    const rp = this.replay;
    if (!rp) return;
    this.replay = null;
    rp.banner.remove();
    this.view.setReplay(null);
    if (this.hud) this.hud.el.style.visibility = '';
    if (next) rp.then();
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
        m.competitors.length > 2 && m.outOrder.length > 0 && h('div', { class: 'reason', style: 'font-size:13px;opacity:0.8' },
          'Out: ' + m.outOrder.map((i) => `${m.competitors[i].design.name} (${m.eliminated[i]})`).join(' → ')),
        scores && h('table', { class: 'judges' },
          h('tr', {}, h('th', {}, ''), ...m.competitors.map((rb) => h('th', {}, rb.design.name))),
          ...(['aggression', 'control', 'damage', 'style', 'total'] as const).map((k) =>
            h('tr', {}, h('td', { style: 'text-align:left;text-transform:capitalize' }, k), ...scores.map((s) => h('td', {}, s[k].toFixed(1)))))),
        this.resultButtons())));
  }

  private resultButtons(): HTMLElement {
    const net = this.net;
    if (net?.link.role === 'host') {
      return h('div', { class: 'menu' },
        h('button', { class: 'primary', onclick: () => this.hostFight() }, 'Rematch (Enter)'),
        h('button', { onclick: () => net.lobby?.() }, 'Change robots'),
        h('button', { onclick: () => this.leaveFight(() => this.onlineScreen()) }, 'Leave online fight'));
    }
    if (net) {
      return h('div', { class: 'menu' },
        h('p', { class: 'hint' }, 'Waiting for the host: a rematch, or new robots…'),
        h('button', { onclick: () => this.leaveFight(() => this.onlineScreen()) }, 'Leave online fight'));
    }
    return h('div', { class: 'menu' },
      h('button', { class: 'primary', onclick: () => this.fight() }, 'Rematch (Enter)'),
      h('button', { onclick: () => this.leaveFight(() => this.selectScreen()) }, 'Change robots'),
      h('button', { onclick: () => this.leaveFight(() => this.mainMenu()) }, 'Main menu'));
  }
}

/** How long after the fight's decided until the replay (or the result) comes up, ms. */
const clipDelay = (replays: boolean) => (replays ? 1400 : 2500);

RAPIER.init().then(() => new App().start());
