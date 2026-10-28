import { deleteDesign, loadDesigns, parseDesign, saveDesign } from '../data/garage';
import { MATERIALS } from '../data/materials';
import { BATTERIES, MOTORS, RAMS, TANKS, VALVES, WHEELS } from '../data/parts';
import { TEMPLATES } from '../data/templates';
import { childrenOf, partMass, root } from '../sim/assembly';
import { NEW_PART_KINDS, blankDesign, cloneDesign, mirrorPart, newParts, removePart, validParents, type NewPartKind } from '../sim/build';
import { conditionLabel } from '../sim/damage';
import type { ActuatorDef, InputDef, InputSource, JointDef, PartDef, RobotDesign, Shape, Vec3 } from '../sim/design';
import type { Match } from '../sim/match';
import { BUDGETS, DEFAULT_RULES, WEIGHT_CLASSES, isLegal, scrutineer, type Rules } from '../sim/rules';
import { computeStats } from '../sim/stats';
import { h } from './dom';
import { statLines } from './format';

type Tab = 'robot' | 'parts';

export interface GarageHost {
  /** (Re)build the test bay with this design. Throws if the design can't be built. */
  startBay(d: RobotDesign): void;
  bay(): Match | null;
  exit(): void;
  /** Glow this part in the 3D view. */
  highlight(partId: string | null): void;
  /** Let the garage hear about clicks on parts in the 3D view. */
  onPick(cb: (partId: string | null) => void): void;
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
  private tab: Tab = 'parts';
  private selected: string;
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
    this.selected = root(this.draft).id;
    host.onPick((id) => { if (id && this.draft.parts.some((p) => p.id === id)) this.select(id); });
    this.left = h('div', { class: 'gpanel' });
    this.summary = h('div');
    this.telemetry = h('div', { class: 'telemetry' });
    this.status = h('div', { class: 'gstatus' });
    this.right = h('div', { class: 'gpanel' }, this.summary,
      h('h4', {}, 'Test bay'),
      h('div', { class: 'hint' }, 'Drive with player 1\'s controls (W A S D; weapon buttons E, Q, Z, X). Drag to orbit, scroll to zoom, click a part to select it.'),
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

  private select(id: string) {
    this.selected = id;
    this.tab = 'parts';
    this.host.highlight(id);
    this.renderEditor();
  }

  private load(d: RobotDesign) {
    this.draft = cloneDesign(d);
    this.selected = root(this.draft).id;
    this.host.highlight(this.selected);
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

  // ---------------------------------------------------------------- editor

  private renderEditor() {
    const tabs: Array<[Tab, string]> = [['parts', 'Parts'], ['robot', 'Robot & saves']];
    this.left.replaceChildren(
      h('h3', {}, 'Garage'),
      h('div', { class: 'tabs' }, ...tabs.map(([t, label]) => h('button', { class: t === this.tab ? 'on' : '', onclick: () => { this.tab = t; this.renderEditor(); } }, label))),
      this.tab === 'robot' ? this.robotTab() : this.partsTab());
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

  // ---------------------------------------------------------------- parts tree & inspector

  private partsTab() {
    const d = this.draft;
    if (!d.parts.some((p) => p.id === this.selected)) this.selected = root(d).id;
    const sel = d.parts.find((p) => p.id === this.selected)!;
    const rows: HTMLElement[] = [];
    const icon = (p: PartDef) => (p.role === 'wheel' ? '◎' : p.role === 'component' ? '▪' : p.joint.type === 'hinge' ? '↻' : p.joint.type === 'slider' ? '⇕' : '▢');
    const walk = (p: PartDef, depth: number) => {
      const act = p.joint.type !== 'fixed' && p.joint.actuator ? ` · ${p.joint.actuator.type}` : '';
      rows.push(h('button', {
        class: `tree-row${p.id === this.selected ? ' on' : ''}`, style: `padding-left:${8 + depth * 14}px`,
        onclick: () => this.select(p.id),
      }, h('span', { class: 'ticon' }, icon(p)), p.label, h('span', { class: 'tmeta' }, `${fmt(partMass(p), 1)} kg${act}`)));
      for (const c of childrenOf(d, p.id)) walk(c, depth + 1);
    };
    walk(root(d), 0);

    const groups = new Map<string, Array<[NewPartKind, string]>>();
    for (const [k, label, g] of NEW_PART_KINDS) { if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push([k, label]); }
    const addSel = h('select', {}, ...[...groups].map(([g, items]) => h('optgroup', { label: g }, ...items.map(([k, label]) => h('option', { value: k }, label)))));
    const add = () => {
      const made = newParts(d, addSel.value as NewPartKind, this.selected);
      d.parts.push(...made);
      if (made.some((p) => p.joint.type !== 'fixed' && p.joint.actuator?.type === 'pneumatic') && !d.parts.some((p) => p.component?.type === 'gasTank')) {
        d.parts.push(...newParts(d, 'gasTank', root(d).id));
      }
      this.selected = made[0].id;
      this.host.highlight(this.selected);
      this.changed(true);
    };
    return h('div', {},
      h('div', { class: 'tree' }, ...rows),
      h('div', { class: 'add-row' }, h('span', { class: 'flabel' }, `Add to ${sel.label}:`), addSel, h('button', { class: 'small primary', onclick: add }, 'Add')),
      this.inspector(sel));
  }

  private inspector(p: PartDef) {
    const d = this.draft;
    const isRoot = p.parent === null;
    const out: (HTMLElement | null | false)[] = [];
    out.push(h('h4', {}, p.label));
    out.push(h('label', { class: 'field wide' }, h('span', { class: 'flabel' }, 'Name'),
      h('input', { type: 'text', value: p.label, oninput: (e: Event) => { p.label = (e.target as HTMLInputElement).value; this.changed(); }, onchange: () => this.renderEditor() })));
    if (!isRoot) {
      out.push(this.sel('Attached to', validParents(d, p.id).map((q) => [q.id, q.label] as [string, string]), p.parent!, (v) => (p.parent = v), true));
    }
    out.push(h('div', { class: 'gactions' },
      !isRoot && h('button', { class: 'small', onclick: () => { const copy = mirrorPart(d, p.id); d.parts.push(...copy); this.select(copy[0].id); this.changed(true); } }, 'Mirror copy'),
      !isRoot && h('button', { class: 'small', onclick: () => {
        const copy = mirrorPart(d, p.id);
        // A mirror of a mirror is a straight copy; nudge it so it's visible.
        const twice = mirrorPart({ ...d, parts: [...d.parts, ...copy] }, copy[0].id);
        twice[0].position = [p.position[0] + 0.05, p.position[1], p.position[2] + 0.05];
        twice[0].label = `${p.label} copy`;
        d.parts.push(...twice);
        this.select(twice[0].id);
        this.changed(true);
      } }, 'Duplicate'),
      !isRoot && h('button', { class: 'small', onclick: () => { if (confirm(`Remove ${p.label} and everything attached to it?`)) { const parent = p.parent!; removePart(d, p.id); this.select(parent); this.changed(true); } } }, 'Remove'),
      isRoot && h('span', { class: 'hint' }, 'The chassis: everything else hangs off this part.')));

    // What it is.
    if (p.role === 'structure') out.push(...this.shapeFields(p));
    if (p.role === 'wheel') {
      out.push(this.sel('Wheel', Object.values(WHEELS).map((w) => [w.id, `${w.name} — grip ${w.grip}, ${w.mass} kg`] as [string, string]), p.wheel!, (v) => (p.wheel = v)));
    }
    if (p.role === 'component') out.push(...this.componentFields(p));
    out.push(h('label', { class: 'field wide' }, h('span', { class: 'flabel' }, 'Paint'),
      h('span', {},
        h('input', { type: 'color', value: p.colour ?? d.colour, oninput: (e: Event) => { p.colour = (e.target as HTMLInputElement).value; this.changed(); } }),
        p.colour && h('button', { class: 'small', style: 'margin-left:6px', onclick: () => { delete p.colour; this.changed(true); } }, 'Use robot colour'))));

    // Where it is.
    out.push(h('h4', {}, 'Placement'));
    out.push(h('div', { class: 'hint' }, isRoot ? 'Relative to the floor centre. +Z is forward, +Y up, +X left.' : `Relative to ${d.parts.find((q) => q.id === p.parent)?.label}. +Z forward, +Y up, +X left.`));
    out.push(...this.vec3mm(['Left / right', 'Up / down', 'Forward / back'], p.position, -1500, 1500));
    out.push(...this.vec3deg(['Tilt (about X)', 'Turn (about Y)', 'Roll (about Z)'], p.rotation));
    if (p.role === 'structure') {
      p.shapeOffset ??= [0, 0, 0];
      out.push(h('div', { class: 'hint' }, 'Shape offset: moves the shape away from the joint, e.g. so a flipper hinges at its back edge.'));
      out.push(...this.vec3mm(['Offset X', 'Offset Y', 'Offset Z'], p.shapeOffset, -1000, 1000));
    }

    // How it's attached and what drives it.
    if (!isRoot) out.push(...this.jointFields(p));
    return h('div', { class: 'inspector' }, ...out);
  }

  private shapeFields(p: PartDef): HTMLElement[] {
    const s = p.shape!;
    const types: Array<[Shape['type'], string]> = [['box', 'Box'], ['wedge', 'Wedge'], ['cylinder', 'Cylinder / disc'], ['cone', 'Cone'], ['sphere', 'Sphere'], ['capsule', 'Capsule / rod'], ['hull', 'Custom hull (points)']];
    const out: HTMLElement[] = [];
    out.push(this.sel('Shape', types, s.type, (t) => (p.shape = convertShape(s, t)), true));
    switch (s.type) {
      case 'box': case 'wedge':
        out.push(this.mm('Width (X)', s.size[0], (v) => (s.size[0] = v), 5, 1500), this.mm('Height (Y)', s.size[1], (v) => (s.size[1] = v), 2, 1500), this.mm('Length (Z)', s.size[2], (v) => (s.size[2] = v), 5, 1500));
        if (s.type === 'wedge') out.push(this.mm('Front lip', s.lip, (v) => (s.lip = v), 0, 500));
        break;
      case 'cylinder': case 'cone':
        out.push(this.mm('Radius', s.radius, (v) => (s.radius = v), 5, 750), this.mm('Length (Y)', s.length, (v) => (s.length = v), 2, 1500));
        break;
      case 'sphere': out.push(this.mm('Radius', s.radius, (v) => (s.radius = v), 5, 750)); break;
      case 'capsule': out.push(this.mm('Radius', s.radius, (v) => (s.radius = v), 5, 400), this.mm('Length (Y)', s.length, (v) => (s.length = v), 0, 1500)); break;
      case 'hull': {
        const err = h('div', { class: 'err' });
        out.push(h('div', { class: 'hint' }, 'Corner points in metres, [x, y, z] — any convex shape. The physics uses their convex hull.'));
        out.push(h('textarea', { class: 'json', rows: 5, oninput: (e: Event) => {
          try {
            const pts = JSON.parse((e.target as HTMLTextAreaElement).value) as Vec3[];
            if (!Array.isArray(pts) || pts.length < 4 || pts.some((q) => !Array.isArray(q) || q.length !== 3 || q.some((n) => typeof n !== 'number'))) throw new Error('Need at least 4 [x, y, z] points.');
            s.points = pts; err.textContent = ''; this.changed();
          } catch (x) { err.textContent = (x as Error).message; }
        } }, JSON.stringify(s.points)), err);
        break;
      }
    }
    const materials = Object.values(MATERIALS).map((m) => [m.id, `${m.name} — ${m.density} kg/m³, £${m.costPerKg}/kg`] as [string, string]);
    out.push(this.sel('Material', materials, p.material ?? 'aluminium', (v) => (p.material = v)));
    out.push(this.sel('Construction', [['shell', 'Hollow shell (plate)'], ['solid', 'Solid']], p.wall ? 'shell' : 'solid', (v) => { if (v === 'solid') delete p.wall; else p.wall = 5; }, true));
    if (p.wall) out.push(this.num('Wall thickness', p.wall, (v) => (p.wall = v), { min: 0.5, max: 50, step: 0.5, unit: 'mm' }));
    return out;
  }

  private componentFields(p: PartDef): HTMLElement[] {
    const c = p.component!;
    if (c.type === 'battery') return [this.sel('Battery', Object.values(BATTERIES).map((b) => [b.id, `${b.name} — ${b.capacity} Wh, ${b.maxCurrent} A, ${b.mass} kg`] as [string, string]), c.part, (v) => (c.part = v))];
    if (c.type === 'gasTank') return [this.sel('Gas bottle', Object.values(TANKS).map((t) => [t.id, `${t.name} — ${t.capacity} g CO2, ${t.mass} kg`] as [string, string]), c.part, (v) => (c.part = v))];
    return [this.num('Mass', c.mass, (v) => (c.mass = v), { min: 0.1, max: 60, step: 0.1, unit: 'kg' })];
  }

  private jointFields(p: PartDef): HTMLElement[] {
    const out: HTMLElement[] = [h('h4', {}, 'Joint')];
    const types: Array<[JointDef['type'], string]> = p.role === 'wheel' ? [['hinge', 'Hinge (axle)']] : [['fixed', 'Fixed (bolted on)'], ['hinge', 'Hinge (rotates)'], ['slider', 'Slider (moves in a line)']];
    out.push(this.sel('Type', types, p.joint.type, (t) => {
      const prev = p.joint;
      const axis: Vec3 = prev.type === 'fixed' ? [1, 0, 0] : prev.axis;
      p.joint = t === 'fixed' ? { type: 'fixed' } : t === 'hinge' ? { type: 'hinge', axis, limits: [-45, 45] } : { type: 'slider', axis: [0, 1, 0], limits: [0, 100] };
    }, true));
    const j = p.joint;
    if (j.type === 'fixed') return out;
    const axes: Array<[string, string]> = [['1,0,0', '+X (left)'], ['-1,0,0', '−X (right)'], ['0,1,0', '+Y (up)'], ['0,-1,0', '−Y (down)'], ['0,0,1', '+Z (forward)'], ['0,0,-1', '−Z (back)']];
    const key = j.axis.join(',');
    if (!axes.some(([k]) => k === key)) axes.push([key, `custom (${key})`]);
    out.push(this.sel('Axis', axes, key, (v) => (j.axis = v.split(',').map(Number) as Vec3)));
    if (j.type === 'hinge') {
      out.push(this.sel('Range', [['limited', 'Limited'], ['free', 'Spins freely']], j.limits ? 'limited' : 'free', (v) => { if (v === 'free') delete j.limits; else j.limits = [-45, 45]; }, true));
      if (j.limits) {
        const lim = j.limits;
        out.push(this.num('Min angle', lim[0], (v) => (lim[0] = v), { min: -360, max: 360, step: 1, unit: '°' }), this.num('Max angle', lim[1], (v) => (lim[1] = v), { min: -360, max: 360, step: 1, unit: '°' }));
      }
    } else {
      const lim = j.limits;
      out.push(this.num('Min travel', lim[0], (v) => (lim[0] = v), { min: -1000, max: 1000, step: 5, unit: 'mm' }), this.num('Max travel', lim[1], (v) => (lim[1] = v), { min: -1000, max: 1000, step: 5, unit: 'mm' }));
    }

    out.push(h('h4', {}, 'Actuator'));
    const a = j.actuator;
    const kinds: Array<[string, string]> = [['none', 'None (free)'], ...(j.type === 'hinge' ? [['motor', 'DC motor (spins)'] as [string, string]] : []), ['pneumatic', 'Pneumatic ram'], ['servo', 'Servo (holds a position)']];
    out.push(this.sel('Driven by', kinds, a?.type ?? 'none', (v) => (j.actuator = defaultActuator(v, a?.input)), true));
    if (!a) return out;
    const motors = Object.values(MOTORS).map((m) => [m.id, `${m.name} — ${m.stallTorque} N·m, ${fmt(m.freeSpeed)} rpm, ${m.mass} kg`] as [string, string]);
    if (a.type === 'motor' || a.type === 'servo') {
      out.push(this.sel('Motor', motors, a.motor, (v) => (a.motor = v)));
      out.push(this.num('Gear reduction', a.gear, (v) => (a.gear = v), { min: 1, max: 200, step: 0.5, unit: ': 1' }));
    }
    if (a.type === 'servo') {
      const unit = j.type === 'hinge' ? '°' : 'mm';
      out.push(this.num('Position at −1', a.targets[0], (v) => (a.targets[0] = v), { min: -360, max: 360, step: 1, unit }));
      out.push(this.num('Position at 0', a.targets[1], (v) => (a.targets[1] = v), { min: -360, max: 360, step: 1, unit }));
      out.push(this.num('Position at +1', a.targets[2], (v) => (a.targets[2] = v), { min: -360, max: 360, step: 1, unit }));
    }
    if (a.type === 'pneumatic') {
      out.push(this.sel('Ram', Object.values(RAMS).map((r) => [r.id, `${r.name} — max ${r.maxPressure} bar, ${r.mass} kg`] as [string, string]), a.ram, (v) => (a.ram = v)));
      out.push(this.sel('Valve', Object.values(VALVES).map((v) => [v.id, `${v.name} — ${Math.round(v.timeConstant * 1000)} ms${v.maxRate ? ', flow-limited' : ''}`] as [string, string]), a.valve, (v) => (a.valve = v)));
      out.push(this.num('Pressure', a.pressure, (v) => (a.pressure = v), { min: 2, max: 60, step: 1, unit: 'bar' }));
      if (j.type === 'hinge') out.push(this.mm('Lever arm', a.leverArm, (v) => (a.leverArm = v), 10, 500));
    }
    out.push(...this.inputFields(a));
    return out;
  }

  private inputFields(a: ActuatorDef): HTMLElement[] {
    const i = a.input;
    const sources: Array<[InputSource, string]> = [
      ['left', 'Left drive'], ['right', 'Right drive'], ['throttle', 'Throttle (forward/back)'], ['steer', 'Steering'],
      ['button1', 'Weapon button 1'], ['button2', 'Weapon button 2'], ['button3', 'Weapon button 3'], ['button4', 'Weapon button 4'],
      ['gait', 'Walking gait'],
    ];
    const out: HTMLElement[] = [h('h4', {}, 'Wired to')];
    out.push(this.sel('Control', sources, i.source, (v) => {
      i.source = v;
      if (v.startsWith('button')) i.mode ??= a.type === 'motor' ? 'toggle' : 'hold';
      if (v === 'gait') { i.side ??= 'left'; i.phase ??= 0; i.pattern ??= 'swing'; }
    }, true));
    if (i.source.startsWith('button')) {
      out.push(this.sel('Mode', [['hold', 'While held'], ['toggle', 'Press on, press off']], i.mode ?? 'hold', (v) => (i.mode = v)));
    } else {
      out.push(this.num('Scale', i.scale ?? 1, (v) => (i.scale = v), { min: -2, max: 2, step: 0.05, unit: '×' }));
    }
    if (i.source === 'gait') {
      out.push(this.sel('Side', [['left', 'Left stride'], ['right', 'Right stride']], i.side ?? 'left', (v) => (i.side = v)));
      out.push(this.sel('Pattern', [['swing', 'Swing (forward/back)'], ['lift', 'Lift (up on the return)']], i.pattern ?? 'swing', (v) => (i.pattern = v)));
      out.push(this.num('Phase', i.phase ?? 0, (v) => (i.phase = v), { min: -360, max: 360, step: 15, unit: '°' }));
    }
    return out;
  }

  private vec3mm(labels: [string, string, string], v: Vec3, min: number, max: number): HTMLElement[] {
    return labels.map((l, k) => this.mm(l, v[k], (x) => (v[k] = x), min, max));
  }

  private vec3deg(labels: [string, string, string], v: Vec3): HTMLElement[] {
    return labels.map((l, k) => this.num(l, v[k], (x) => (v[k] = x), { min: -180, max: 180, step: 1, unit: '°' }));
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
    if (r.gasCapacity) rows.push(['Gas', `${fmt(r.gasLeft)} of ${fmt(r.gasCapacity)} g`]);
    for (const rot of r.rotors()) rows.push([rot.actuator.driven.label, `${fmt(rot.rpm)} rpm${rot.on ? '' : ' (off)'}`]);
    for (const a of r.actuators.filter((x) => x.def.type !== 'motor' || x.locomotion).slice(0, 6)) {
      rows.push([a.driven.label, a.joint === 'hinge' ? `${fmt((a.position * 180) / Math.PI)}°` : `${fmt(a.position * 1000)} mm`]);
    }
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

/** Change a shape's type, keeping roughly the same size. */
function convertShape(s: Shape, t: Shape['type']): Shape {
  if (s.type === t) return s;
  const half = s.type === 'box' || s.type === 'wedge' ? { x: s.size[0] / 2, y: s.size[1] / 2, z: s.size[2] / 2 }
    : s.type === 'sphere' ? { x: s.radius, y: s.radius, z: s.radius }
    : s.type === 'hull' ? { x: 0.15, y: 0.1, z: 0.15 }
    : { x: s.radius, y: s.length / 2, z: s.radius };
  const r = Math.round(Math.max(half.x, half.z) * 1000) / 1000, l = Math.round(half.y * 2000) / 1000;
  const size: Vec3 = [half.x * 2, half.y * 2, half.z * 2];
  switch (t) {
    case 'box': return { type: 'box', size };
    case 'wedge': return { type: 'wedge', size, lip: 0.01 };
    case 'cylinder': return { type: 'cylinder', radius: r, length: l };
    case 'cone': return { type: 'cone', radius: r, length: l };
    case 'sphere': return { type: 'sphere', radius: r };
    case 'capsule': return { type: 'capsule', radius: Math.min(r, l / 2), length: l };
    case 'hull': {
      const [x, y, z] = [half.x, half.y, half.z];
      return { type: 'hull', points: [[-x, -y, -z], [x, -y, -z], [-x, -y, z], [x, -y, z], [0, y, 0]] };
    }
  }
}

function defaultActuator(kind: string, input?: InputDef): ActuatorDef | undefined {
  switch (kind) {
    case 'motor': return { type: 'motor', motor: 'dm750', gear: 9, input: input ?? { source: 'button1', mode: 'toggle' } };
    case 'pneumatic': return { type: 'pneumatic', ram: 'ram63', valve: 'std', pressure: 20, leverArm: 0.12, input: input ?? { source: 'button1', mode: 'hold' } };
    case 'servo': return { type: 'servo', motor: 'dm750', gear: 30, targets: [-30, 0, 30], input: input ?? { source: 'steer', scale: 1 } };
    default: return undefined;
  }
}

