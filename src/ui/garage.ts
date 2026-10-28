import { deleteDesign, loadDesigns, parseDesign, saveDesign } from '../data/garage';
import { MATERIALS } from '../data/materials';
import { BATTERIES, MOTORS, RAMS, TANKS, VALVES, WHEELS } from '../data/parts';
import { TEMPLATES } from '../data/templates';
import { applyDriveLayout, autoSkids, blankDesign, cloneDesign, defaultFlipper, defaultSpinner, driveLayout, newPanel } from '../sim/build';
import { conditionLabel } from '../sim/damage';
import type { FlipperDef, RobotDesign, ShellPanel, SpinnerDef } from '../sim/design';
import type { Match } from '../sim/match';
import { BUDGETS, DEFAULT_RULES, WEIGHT_CLASSES, isLegal, scrutineer, type Rules } from '../sim/rules';
import { computeStats } from '../sim/stats';
import { h } from './dom';
import { statLines } from './format';

type Tab = 'robot' | 'armour' | 'drive' | 'power' | 'weapon';

export interface GarageHost {
  /** (Re)build the test bay with this design. Throws if the design can't be built. */
  startBay(d: RobotDesign): void;
  bay(): Match | null;
  exit(): void;
}

const TEMPLATE_IDS = new Set(TEMPLATES.map((t) => t.id));
const fmt = (v: number, d = 0) => v.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * The garage: edit a RobotDesign part by part, see what it weighs and costs
 * and whether it passes scrutineering, and drive it in the test bay behind.
 */
export class Garage {
  readonly el: HTMLDivElement;
  private draft: RobotDesign;
  private rules: Rules = DEFAULT_RULES;
  private tab: Tab = 'robot';
  private left: HTMLDivElement;
  private right: HTMLDivElement;
  private summary: HTMLDivElement;
  private telemetry: HTMLDivElement;
  private status: HTMLDivElement;
  private rebuildTimer = 0;
  private telemetryClock = 0;
  private buildError = '';

  constructor(private host: GarageHost, initial?: RobotDesign) {
    this.draft = cloneDesign(initial ?? TEMPLATES[1]);
    this.left = h('div', { class: 'gpanel' });
    this.summary = h('div');
    this.telemetry = h('div', { class: 'telemetry' });
    this.status = h('div', { class: 'gstatus' });
    this.right = h('div', { class: 'gpanel' }, this.summary,
      h('h4', {}, 'Test bay'),
      h('div', { class: 'hint' }, 'Drive with player 1\'s controls (W A S D, E to fire). Drag the view to orbit, scroll to zoom.'),
      this.telemetry,
      h('div', { class: 'gactions' },
        h('button', { class: 'small', onclick: () => this.rebuild() }, 'Reset bay'),
        h('button', { class: 'small primary', onclick: () => this.save() }, 'Save'),
        h('button', { class: 'small', onclick: () => this.host.exit() }, 'Exit')),
      this.status);
    this.el = h('div', { class: 'garage' }, this.left, this.right);
    this.renderEditor();
    this.renderSummary();
    this.rebuild();
  }

  // ---------------------------------------------------------------- change plumbing

  /** A value changed: refresh numbers now, rebuild the test bay shortly. */
  private changed(structural = false) {
    if (structural) this.renderEditor();
    this.renderSummary();
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => this.rebuild(), 350);
  }

  private rebuild() {
    try {
      this.host.startBay(this.draft);
      this.buildError = '';
    } catch (e) {
      this.buildError = `Can't build this yet: ${(e as Error).message}`;
    }
    this.renderSummary();
  }

  private load(d: RobotDesign) {
    this.draft = cloneDesign(d);
    this.changed(true);
    this.rebuild();
  }

  private save() {
    if (TEMPLATE_IDS.has(this.draft.id)) {
      // Never overwrite a starter robot: saving makes it yours.
      this.draft.id = `custom-${Date.now().toString(36)}`;
      if (TEMPLATES.some((t) => t.name === this.draft.name)) this.draft.name = `${this.draft.name} Mk II`;
    }
    saveDesign(cloneDesign(this.draft));
    const legal = isLegal(scrutineer(this.draft, this.rules));
    this.flash(legal ? `Saved "${this.draft.name}". It's on the robot select screen.` : `Saved "${this.draft.name}" — but it won't pass scrutineering yet.`);
    if (this.tab === 'robot') this.renderEditor();
  }

  private flash(text: string) {
    this.status.textContent = text;
    window.setTimeout(() => { if (this.status.textContent === text) this.status.textContent = ''; }, 5000);
  }

  // ---------------------------------------------------------------- field helpers

  private num(label: string, value: number, set: (v: number) => void, o: { min: number; max: number; step: number; unit?: string; after?: () => void }) {
    const range = h('input', { type: 'range', min: o.min, max: o.max, step: o.step, value });
    const box = h('input', { type: 'number', class: 'numbox', min: o.min, max: o.max, step: o.step, value });
    const apply = (raw: string) => {
      const v = Math.min(o.max, Math.max(o.min, Number(raw)));
      if (!Number.isFinite(v)) return;
      set(v);
      o.after?.();
      this.changed();
    };
    range.addEventListener('input', () => { box.value = range.value; apply(range.value); });
    box.addEventListener('change', () => { range.value = box.value; apply(box.value); box.blur(); });
    return h('label', { class: 'field' }, h('span', { class: 'flabel' }, label), range, box, h('span', { class: 'unit' }, o.unit ?? ''));
  }

  /** Lengths are stored in metres but builders think in millimetres. */
  private mm(label: string, metres: number, set: (m: number) => void, min: number, max: number, after?: () => void) {
    return this.num(label, Math.round(metres * 1000), (v) => set(v / 1000), { min, max, step: 5, unit: 'mm', after });
  }

  private sel<T extends string>(label: string, options: Array<[T, string]>, value: T, set: (v: T) => void, structural = false) {
    // Blur after picking, so the keyboard goes back to driving the robot.
    const s = h('select', { onchange: () => { set(s.value as T); s.blur(); this.changed(structural); } },
      ...options.map(([v, text]) => h('option', { value: v, selected: v === value }, text)));
    return h('label', { class: 'field wide' }, h('span', { class: 'flabel' }, label), s);
  }

  private text(label: string, value: string, set: (v: string) => void) {
    return h('label', { class: 'field wide' }, h('span', { class: 'flabel' }, label),
      h('input', { type: 'text', value, oninput: (e: Event) => { set((e.target as HTMLInputElement).value); this.changed(); } }));
  }

  // ---------------------------------------------------------------- editor tabs

  private renderEditor() {
    const tabs: Array<[Tab, string]> = [['robot', 'Robot'], ['armour', 'Armour'], ['drive', 'Drive'], ['power', 'Power'], ['weapon', 'Weapon']];
    const body = { robot: () => this.robotTab(), armour: () => this.armourTab(), drive: () => this.driveTab(), power: () => this.powerTab(), weapon: () => this.weaponTab() }[this.tab]();
    this.left.replaceChildren(
      h('h3', {}, 'Garage'),
      h('div', { class: 'tabs' }, ...tabs.map(([t, label]) => h('button', { class: t === this.tab ? 'on' : '', onclick: () => { this.tab = t; this.renderEditor(); } }, label))),
      body);
  }

  private robotTab() {
    const d = this.draft;
    const saved = loadDesigns();
    const exportBox = h('textarea', { class: 'json', readOnly: true, rows: 4 }, JSON.stringify(d));
    const importBox = h('textarea', { class: 'json', rows: 3, placeholder: 'Paste a robot design (JSON) here' });
    const importErr = h('div', { class: 'err' });
    return h('div', {},
      this.text('Name', d.name, (v) => (d.name = v)),
      this.text('Description', d.description, (v) => (d.description = v)),
      h('label', { class: 'field wide' }, h('span', { class: 'flabel' }, 'Paint'),
        h('input', { type: 'color', value: d.colour, oninput: (e: Event) => { d.colour = (e.target as HTMLInputElement).value; this.changed(); } })),
      h('h4', {}, 'Start from'),
      h('div', { class: 'chips' },
        ...TEMPLATES.map((t) => h('button', { class: 'small', onclick: () => this.confirmLoad(t) }, t.name)),
        h('button', { class: 'small', onclick: () => this.confirmLoad(blankDesign()) }, 'Blank chassis')),
      h('h4', {}, 'My robots'),
      saved.length
        ? h('div', { class: 'saved' }, ...saved.map((s) => h('div', { class: 'saved-row' },
          h('span', { style: `color:${s.colour}` }, s.name),
          h('button', { class: 'small', onclick: () => this.confirmLoad(s) }, 'Load'),
          h('button', { class: 'small', onclick: () => { if (confirm(`Delete ${s.name}?`)) { deleteDesign(s.id); this.renderEditor(); } } }, 'Delete'))))
        : h('div', { class: 'hint' }, 'Nothing saved yet. Hit Save to keep a design — it will appear on the robot select screen.'),
      h('h4', {}, 'Share'),
      h('div', { class: 'hint' }, 'A design is plain JSON: copy it to share or back up, or paste one in.'),
      exportBox,
      h('div', { class: 'gactions' }, h('button', { class: 'small', onclick: () => { exportBox.select(); void navigator.clipboard?.writeText(exportBox.value); this.flash('Design copied.'); } }, 'Copy')),
      importBox,
      importErr,
      h('div', { class: 'gactions' }, h('button', { class: 'small', onclick: () => {
        try { this.load(parseDesign(importBox.value)); this.flash('Design loaded.'); } catch (e) { importErr.textContent = (e as Error).message; }
      } }, 'Load JSON')));
  }

  private confirmLoad(d: RobotDesign) {
    if (confirm(`Replace the robot on the bench with ${d.name}? Unsaved changes will be lost.`)) this.load(d);
  }

  private armourTab() {
    const d = this.draft;
    const materials = Object.values(MATERIALS).map((m) => [m.id, `${m.name} — ${m.density} kg/m³, £${m.costPerKg}/kg`] as [string, string]);
    const card = (p: ShellPanel, i: number) => {
      const clearance = p.position[1] - p.size[1] / 2;
      const setHeight = (v: number) => { const c = p.position[1] - p.size[1] / 2; p.size[1] = v; p.position[1] = c + v / 2; };
      return h('details', { class: 'pcard', open: i === 0 },
        h('summary', {}, `${p.label} · ${p.shape} · ${p.thickness} mm ${MATERIALS[p.material]?.name ?? p.material}`),
        this.text('Label', p.label, (v) => (p.label = v)),
        this.sel('Shape', [['box', 'Box'], ['wedge', 'Wedge (slopes down to the front)']], p.shape, (v) => { p.shape = v; if (v === 'wedge') p.lipHeight ??= 0.01; }, true),
        this.sel('Material', materials, p.material, (v) => (p.material = v)),
        this.num('Thickness', p.thickness, (v) => (p.thickness = v), { min: 1, max: 40, step: 0.5, unit: 'mm' }),
        this.mm('Width', p.size[0], (v) => (p.size[0] = v), 50, 1400),
        this.mm('Height', p.size[1], setHeight, 20, 600),
        this.mm('Length', p.size[2], (v) => (p.size[2] = v), 20, 1400, () => autoSkids(d)),
        p.shape === 'wedge' && this.mm('Front lip', p.lipHeight ?? 0, (v) => (p.lipHeight = v), 0, 200),
        this.mm('Forward offset', p.position[2], (v) => (p.position[2] = v), -800, 800, () => autoSkids(d)),
        this.mm('Sideways offset', p.position[0], (v) => (p.position[0] = v), -600, 600),
        this.mm('Ground clearance', clearance, (v) => (p.position[1] = v + p.size[1] / 2), 0, 400),
        h('div', { class: 'gactions' },
          h('button', { class: 'small', onclick: () => { d.shell.splice(i + 1, 0, { ...(JSON.parse(JSON.stringify(p)) as ShellPanel), id: `${p.id}-copy-${Date.now().toString(36)}`, label: `${p.label} (copy)` }); this.changed(true); } }, 'Duplicate'),
          h('button', { class: 'small', onclick: () => { d.shell.splice(i, 1); autoSkids(d); this.changed(true); } }, 'Remove')));
    };
    return h('div', {},
      h('div', { class: 'hint' }, 'Armour panels are hollow plate shells. Weight = surface area × thickness × density. Thicker, tougher plate shrugs off bigger hits and protects what\'s behind it.'),
      ...d.shell.map(card),
      h('div', { class: 'gactions' },
        h('button', { class: 'small', onclick: () => { d.shell.push(newPanel(d, 'box')); autoSkids(d); this.changed(true); } }, '+ Box panel'),
        h('button', { class: 'small', onclick: () => { d.shell.push(newPanel(d, 'wedge')); autoSkids(d); this.changed(true); } }, '+ Wedge')));
  }

  private driveTab() {
    const d = this.draft;
    const layout = driveLayout(d);
    const wheelId = d.drive.wheels[0]?.wheel ?? 'pneu250';
    const relayout = (change: Partial<typeof layout>, wheel = wheelId) => applyDriveLayout(d, { ...layout, ...change }, wheel);
    const motors = Object.values(MOTORS).filter((m) => m.id.startsWith('dm')).map((m) =>
      [m.id, `${m.name} — ${m.stallTorque} N·m, ${fmt(m.freeSpeed)} rpm, ${m.mass} kg, £${m.cost}`] as [string, string]);
    const wheels = Object.values(WHEELS).map((w) => [w.id, `${w.name} — grip ${w.grip}, ${w.mass} kg`] as [string, string]);
    return h('div', {},
      h('div', { class: 'hint' }, 'Gearing trades speed for torque: a higher ratio pushes harder but goes slower. Pushing is limited by whichever runs out first — motor torque, battery current, or grip.'),
      this.sel('Layout', [['1', '2-wheel drive + skids'], ['2', '4-wheel drive']], String(layout.perSide) as '1' | '2', (v) => relayout({ perSide: Number(v) as 1 | 2 }), true),
      this.sel('Wheels', wheels, wheelId, (v) => relayout({}, v)),
      this.mm('Track width', layout.track, (v) => relayout({ track: v }), 100, 1400),
      layout.perSide === 2 && this.mm('Wheelbase', layout.wheelbase, (v) => relayout({ wheelbase: v }), 100, 1200),
      this.mm('Axle position', layout.axleZ, (v) => relayout({ axleZ: v }), -600, 600),
      this.sel('Drive motor', motors, d.drive.motor, (v) => (d.drive.motor = v)),
      this.sel('Motors per side', [['1', 'One'], ['2', 'Two']], String(d.drive.motorsPerSide) as '1' | '2', (v) => (d.drive.motorsPerSide = Number(v))),
      this.num('Gear ratio', d.drive.gearRatio, (v) => (d.drive.gearRatio = v), { min: 2, max: 30, step: 0.5, unit: ': 1' }));
  }

  private powerTab() {
    const d = this.draft;
    const batteries = Object.values(BATTERIES).map((b) => [b.id, `${b.name} — ${b.capacity} Wh, ${b.maxCurrent} A max, ${b.mass} kg, £${b.cost}`] as [string, string]);
    const b = BATTERIES[d.battery.part];
    return h('div', {},
      h('div', { class: 'hint' }, 'Voltage sets how hard the motors are driven (over-volting is a classic trick, with a price). Capacity sets how long you last; maximum current caps your pushing power.'),
      this.sel('Battery', batteries, d.battery.part, (v) => (d.battery.part = v), true),
      b && h('div', { class: 'hint' }, `${b.chemistry} · ${b.voltage} V · ${b.capacity} Wh · ${b.maxCurrent} A · ${b.sourcing} part`),
      this.mm('Forward offset', d.battery.position[2], (v) => (d.battery.position[2] = v), -700, 700),
      this.mm('Height', d.battery.position[1], (v) => (d.battery.position[1] = v), 20, 400),
      h('div', { class: 'hint' }, 'Internals sit behind the armour. A hit near them passes some energy through — keep the battery and radio away from where you expect to get hit.'));
  }

  private weaponTab() {
    const d = this.draft;
    const w = d.weapons[0];
    const kind = w ? w.kind : 'none';
    const pick = this.sel('Weapon', [['none', 'None (pusher)'], ['flipper', 'Pneumatic flipper'], ['spinner', 'Spinner']], kind, (v) => {
      d.weapons = v === 'flipper' ? [defaultFlipper(d)] : v === 'spinner' ? [defaultSpinner(d)] : [];
    }, true);
    if (!w) return h('div', {}, pick, h('div', { class: 'hint' }, 'A pure pusher: spend the weight on armour and traction instead.'));
    return h('div', {}, pick, w.kind === 'flipper' ? this.flipperFields(w) : this.spinnerFields(w));
  }

  private flipperFields(f: FlipperDef) {
    const materials = Object.values(MATERIALS).map((m) => [m.id, m.name] as [string, string]);
    const rams = Object.values(RAMS).map((r) => [r.id, `${r.name} — max ${r.maxPressure} bar, ${r.mass} kg, £${r.cost}`] as [string, string]);
    const valves = Object.values(VALVES).map((v) => [v.id, `${v.name} — ${Math.round(v.timeConstant * 1000)} ms, £${v.cost}`] as [string, string]);
    const tanks = Object.values(TANKS).map((t) => [t.id, `${t.name} — ${t.mass} kg empty, £${t.cost}`] as [string, string]);
    return h('div', {},
      h('div', { class: 'hint' }, 'Force = pressure × ram area; torque = force × lever arm. Bigger rams and higher pressure throw harder but burn more gas per flip. A faster valve gets the plate moving before they slide off.'),
      this.sel('Ram', rams, f.ram, (v) => (f.ram = v)),
      this.num('Pressure', f.pressure, (v) => (f.pressure = v), { min: 5, max: 60, step: 1, unit: 'bar' }),
      this.sel('Valve', valves, f.valve, (v) => (f.valve = v)),
      this.sel('Gas bottle', tanks, f.tank, (v) => (f.tank = v)),
      this.mm('Lever arm', f.leverArm, (v) => (f.leverArm = v), 40, 300),
      this.num('Max opening', f.maxAngle, (v) => (f.maxAngle = v), { min: 20, max: 120, step: 1, unit: '°' }),
      h('h4', {}, 'Plate'),
      this.sel('Material', materials, f.plate.material, (v) => (f.plate.material = v)),
      this.num('Thickness', f.plate.thickness, (v) => (f.plate.thickness = v), { min: 2, max: 25, step: 0.5, unit: 'mm' }),
      this.mm('Width', f.plate.width, (v) => (f.plate.width = v), 100, 1200),
      this.mm('Length', f.plate.length, (v) => (f.plate.length = v), 100, 900),
      h('h4', {}, 'Hinge'),
      this.mm('Hinge height', f.hinge[1], (v) => (f.hinge[1] = v), 30, 500),
      this.mm('Hinge forward', f.hinge[2], (v) => (f.hinge[2] = v), -700, 700));
  }

  private spinnerFields(s: SpinnerDef) {
    const motors = Object.values(MOTORS).filter((m) => m.id.startsWith('wm')).map((m) =>
      [m.id, `${m.name} — ${m.stallTorque} N·m, ${fmt(m.freeSpeed)} rpm, ${m.mass} kg, £${m.cost}`] as [string, string]);
    const materials = Object.values(MATERIALS).map((m) => [m.id, m.name] as [string, string]);
    return h('div', {},
      h('div', { class: 'hint' }, 'Stored energy = ½ × inertia × speed². Heavier, longer blades store far more but take longer to spin up — and spinning up twists your own robot.'),
      this.sel('Weapon motor', motors, s.motor, (v) => (s.motor = v)),
      this.num('Belt reduction', s.beltRatio, (v) => (s.beltRatio = v), { min: 1, max: 10, step: 0.25, unit: ': 1' }),
      this.sel('Orientation', [['horizontal', 'Horizontal (spins flat)'], ['vertical', 'Vertical (drum / disc)']], s.orientation, (v) => (s.orientation = v), true),
      h('h4', {}, 'Blade'),
      this.sel('Shape', [['bar', 'Bar'], ['disc', 'Disc']], s.blade.shape, (v) => (s.blade.shape = v), true),
      this.sel('Material', materials, s.blade.material, (v) => (s.blade.material = v)),
      this.mm(s.blade.shape === 'disc' ? 'Diameter' : 'Length', s.blade.length, (v) => (s.blade.length = v), 100, 1200),
      s.blade.shape === 'bar' && this.mm('Width', s.blade.width, (v) => (s.blade.width = v), 20, 300),
      this.num('Thickness', s.blade.thickness, (v) => (s.blade.thickness = v), { min: 3, max: 60, step: 1, unit: 'mm' }),
      h('h4', {}, 'Mounting'),
      this.mm('Hub height', s.position[1], (v) => (s.position[1] = v), 10, 600),
      this.mm('Hub forward', s.position[2], (v) => (s.position[2] = v), -700, 900));
  }

  // ---------------------------------------------------------------- summary & telemetry

  private renderSummary() {
    const d = this.draft;
    let stats;
    try { stats = computeStats(d); } catch (e) {
      this.summary.replaceChildren(h('div', { class: 'err' }, (e as Error).message));
      return;
    }
    const issues = scrutineer(d, this.rules, stats);
    const legal = isLegal(issues);
    const bom = h('details', {}, h('summary', {}, `Parts list (${stats.bom.length})`),
      h('table', { class: 'bom' },
        h('tr', {}, h('th', {}, 'Part'), h('th', {}, 'kg'), h('th', {}, '£'), h('th', {}, 'Spares')),
        ...stats.bom.map((l) => h('tr', {}, h('td', {}, l.label), h('td', {}, fmt(l.mass, 1)), h('td', {}, fmt(l.cost)), h('td', {}, l.sourcing)))));
    this.summary.replaceChildren(h('div', {},
      h('h3', { style: `color:${d.colour}` }, d.name || 'Unnamed'),
      h('div', { class: 'class-row' },
        this.classSelect(WEIGHT_CLASSES.map((c) => [c.id, `${c.name} (${c.limit} kg)`]), this.rules.weight.id, (id) => (this.rules = { ...this.rules, weight: WEIGHT_CLASSES.find((c) => c.id === id)! })),
        this.classSelect(BUDGETS.map((b) => [b.id, b.name]), this.rules.budget.id, (id) => (this.rules = { ...this.rules, budget: BUDGETS.find((b) => b.id === id)! }))),
      h('div', { class: `scrut ${legal ? 'pass' : 'fail'}` }, legal ? '✓ Passes scrutineering' : '✗ Fails scrutineering'),
      issues.length ? h('ul', { class: 'issues' }, ...issues.map((i) => h('li', { class: i.level }, i.text))) : null,
      this.buildError ? h('div', { class: 'err' }, this.buildError) : null,
      h('dl', { class: 'stats' }, ...statLines(stats, this.rules.weight.limit).flatMap(([k, v, bad]) => [h('dt', {}, k), h('dd', { class: bad ? 'over' : '' }, v)])),
      bom));
  }

  private classSelect(options: Array<[string, string]>, value: string, set: (id: string) => void) {
    const s = h('select', { onchange: () => { set(s.value); this.renderSummary(); } }, ...options.map(([v, t]) => h('option', { value: v, selected: v === value }, t)));
    return s;
  }

  /** Live readings from the test bay, ~10 times a second. */
  update(dt: number) {
    this.telemetryClock -= dt;
    if (this.telemetryClock > 0) return;
    this.telemetryClock = 0.1;
    const m = this.host.bay();
    const r = m?.robots[0];
    if (!m || !r) { this.telemetry.textContent = ''; return; }
    const v = r.chassis.linvel();
    const rows: Array<[string, string]> = [
      ['Speed', `${fmt(Math.hypot(v.x, v.z), 1)} m/s`],
      ['Current', `${fmt(r.current)} A`],
      ['Battery', `${fmt((100 * r.energy) / r.battery.capacity)}%${r.powered ? '' : ' — NO POWER'}`],
    ];
    r.flippers.forEach((f) => rows.push(['Gas', `${fmt(f.gasLeft)} g (${Math.floor(f.gasLeft / f.gasPerShot)} flips)`]));
    r.spinners.forEach((s, i) => rows.push(['Spinner', `${fmt(r.spinnerRpm()[i])} rpm${s.on ? '' : ' (off)'}`]));
    const hit = m.biggestHit;
    rows.push(['Biggest hit', hit ? `${fmt(hit.energy)} J — ${hit.parts}` : '—']);
    const dummy = m.robots[1];
    const hurt = dummy ? dummy.parts.filter((p) => p.condition < 0.97).map((p) => `${p.label}: ${conditionLabel(p.condition)}`) : [];
    rows.push(['Dummy damage', hurt.length ? hurt.join(', ') : 'none']);
    const mine = r.parts.filter((p) => p.condition < 0.97).map((p) => `${p.label}: ${conditionLabel(p.condition)}`);
    rows.push(['Your damage', mine.length ? mine.join(', ') : 'none']);
    this.telemetry.replaceChildren(h('dl', { class: 'stats' }, ...rows.flatMap(([k, val]) => [h('dt', {}, k), h('dd', {}, val)])));
  }
}
