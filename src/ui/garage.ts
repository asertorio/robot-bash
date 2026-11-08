import { deleteDesign, loadDesigns, parseDesign, saveDesign } from '../data/garage';
import { MATERIALS, type Material } from '../data/materials';
import { BATTERIES, MOTORS, RAMS, TANKS, VALVES, WHEELS, type BatterySpec, type MotorSpec, type RamSpec, type TankSpec, type ValveSpec, type WheelSpec } from '../data/parts';
import { HOUSE_ROBOTS, MONSTER_HOUSE } from '../data/house';
import { TEMPLATES } from '../data/templates';
import { actuatorOf, childrenOf, partMass, registerCatalog, root } from '../sim/assembly';
import { convexPieces, shapeHalf } from '../sim/shapes';
import { importModel } from './importModel';
import { OUTLINE_PRESETS, PROFILE_PRESETS, sketchEditor } from './sketch';
import { NEW_PART_KINDS, blankDesign, cloneDesign, mirrorPart, newParts, removePart, scaleShape, validParents, type NewPartKind } from '../sim/build';
import { conditionLabel } from '../sim/damage';
import type { ActuatorDef, EdgeKind, CustomCatalog, InputDef, InputSource, JointDef, PartDef, RobotDesign, Shape, Vec3 } from '../sim/design';
import type { Match } from '../sim/match';
import type { GizmoOptions } from '../render/view';
import { BUDGETS, DEFAULT_RULES, WEIGHT_CLASSES, isLegal, scrutineer, type Rules } from '../sim/rules';
import { computeStats } from '../sim/stats';
import { h } from './dom';
import { statLines } from './format';
import { RobotDiagram, gauge, shotsLeft } from './diagram';

type Tab = 'robot' | 'parts';
/** What dragging in the 3D view does to the selected part. */
type Tool = 'select' | 'translate' | 'rotate' | 'scale';
const TOOLS: Array<[Tool, string, string]> = [
  ['select', 'Select', 'Click parts to select them; drag to look around (1)'],
  ['translate', 'Move', 'Drag the arrows to move the part, or the squares to slide it in a plane (2)'],
  ['rotate', 'Rotate', 'Drag the rings to turn the part (3)'],
  ['scale', 'Resize', 'Drag the handles to stretch the part along its own axes (4)'],
];

export interface GarageHost {
  /** (Re)build the test bay with this design. Throws if the design can't be built. */
  startBay(d: RobotDesign): void;
  bay(): Match | null;
  exit(): void;
  /** Glow this part in the 3D view. */
  highlight(partId: string | null): void;
  /** Put drag handles on a part in the 3D view (or take them away). */
  gizmo(opts: GizmoOptions | null): void;
  /** Let the garage hear about clicks on parts in the 3D view. */
  onPick(cb: (partId: string | null) => void): void;
}

const TEMPLATE_IDS = new Set([...TEMPLATES, ...HOUSE_ROBOTS, ...MONSTER_HOUSE].map((t) => t.id));
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
  private tool: Tool = 'translate';
  private space: 'world' | 'local' = 'world';
  private snap = true;
  private tools: HTMLDivElement;
  private readout: HTMLSpanElement;
  /** Undo history: the design as JSON after each settled change. */
  private history: string[] = [];
  private historyAt = -1;
  private diagram = new RobotDiagram(150);
  private onKey = (e: KeyboardEvent) => this.key(e);
  private exited = false;

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
      h('div', { class: 'hint' }, 'Drive with player 1\'s controls (W A S D; weapon buttons E, Q, Z, X). Click a part to select it, drag its handles to move, turn or resize it (tools 1–4), drag anywhere else to orbit, scroll to zoom. Ctrl+Z undoes, Delete removes, Ctrl+D duplicates.'),
      this.telemetry,
      h('div', { class: 'gactions' },
        h('button', { class: 'small', onclick: () => this.rebuild() }, 'Reset bay'),
        h('button', { class: 'small primary', onclick: () => this.save() }, 'Save'),
        h('button', { class: 'small', onclick: () => this.exit() }, 'Exit')),
      this.status);
    this.readout = h('span', { class: 'readout' });
    this.tools = h('div', { class: 'gtools' });
    this.el = h('div', { class: 'garage' }, this.left, this.tools, this.right);
    window.addEventListener('keydown', this.onKey);
    this.renderEditor();
    this.renderSummary();
    this.renderTools();
    this.rebuild();
  }

  private exit() {
    // A change made just before leaving must not rebuild the bay behind the menu.
    clearTimeout(this.rebuildTimer);
    this.exited = true;
    window.removeEventListener('keydown', this.onKey);
    this.host.gizmo(null);
    this.host.exit();
  }

  // ---------------------------------------------------------------- mouse tools

  private renderTools() {
    const p = this.draft.parts.find((q) => q.id === this.selected);
    const canResize = p?.role === 'structure';
    const toggle = (on: boolean, label: string, title: string, click: () => void) =>
      h('button', { class: on ? 'on' : '', title, onclick: (e: Event) => { click(); (e.currentTarget as HTMLElement).blur(); } }, label);
    this.tools.replaceChildren(
      h('span', { class: 'seg' }, ...TOOLS.map(([t, label, title]) =>
        h('button', {
          class: this.tool === t ? 'on' : '', title, disabled: t === 'scale' && !canResize,
          onclick: (e: Event) => { this.setTool(t); (e.currentTarget as HTMLElement).blur(); },
        }, label))),
      this.tool === 'translate' ? h('span', { class: 'seg' },
        toggle(this.space === 'world', 'World', 'Move along the robot-on-the-floor axes', () => { this.space = 'world'; this.refreshTools(); }),
        toggle(this.space === 'local', 'Part', "Move along the part's own (tilted) axes", () => { this.space = 'local'; this.refreshTools(); })) : '',
      h('span', { class: 'seg' }, toggle(this.snap, 'Snap', 'Snap to 5 mm / 5° / 5% steps (off: 1 mm / 1°)', () => { this.snap = !this.snap; this.refreshTools(); })),
      h('span', { class: 'seg' },
        h('button', { title: 'Undo (Ctrl+Z)', disabled: this.historyAt <= 0, onclick: () => this.undo(-1) }, '↶'),
        h('button', { title: 'Redo (Ctrl+Y)', disabled: this.historyAt >= this.history.length - 1, onclick: () => this.undo(1) }, '↷')),
      h('span', { class: 'seg' }, toggle(this.el?.classList.contains('panels-hidden') ?? false, 'Hide panels', 'Hide the side panels to see the robot (press again to bring them back)', () => { this.el.classList.toggle('panels-hidden'); this.renderTools(); })),
      this.readout);
  }

  private setTool(t: Tool) {
    this.tool = t;
    this.refreshTools();
  }

  private refreshTools() {
    this.renderTools();
    this.updateGizmo();
  }

  /** Point the 3D handles at the selected part with its current numbers. */
  private updateGizmo() {
    const p = this.draft.parts.find((q) => q.id === this.selected);
    if (!p || this.tool === 'select' || (this.tool === 'scale' && p.role !== 'structure')) { this.host.gizmo(null); return; }
    const mm = (v: number) => Math.round(v * 1000);
    this.host.gizmo({
      partId: p.id, mode: this.tool, space: this.space, snap: this.snap,
      position: [...p.position], rotation: [...p.rotation],
      onPose: (pos, rot, done) => {
        if (done) { this.readout.textContent = ''; this.commitDrag(); return; }
        if (pos) p.position = pos;
        if (rot) p.rotation = rot;
        this.readout.textContent = this.tool === 'rotate'
          ? `${p.rotation.map((a) => `${Math.round(a)}°`).join(' · ')}`
          : `X ${mm(p.position[0])} · Y ${mm(p.position[1])} · Z ${mm(p.position[2])} mm`;
      },
      onResize: (scale, done) => {
        this.readout.textContent = done ? '' : `× ${scale.map((v) => v.toFixed(2)).join(' · ')}`;
        if (!done) return;
        if (p.shape) p.shape = scaleShape(p.shape, scale);
        this.commitDrag();
      },
    });
  }

  /** A drag in the 3D view finished: show the numbers and rebuild straight away. */
  private commitDrag() {
    this.renderEditor();
    this.renderSummary();
    clearTimeout(this.rebuildTimer);
    this.rebuild();
  }

  // ---------------------------------------------------------------- undo & keys

  private record() {
    const json = JSON.stringify(this.draft);
    if (this.history[this.historyAt] === json) return;
    this.history = this.history.slice(0, this.historyAt + 1);
    this.history.push(json);
    if (this.history.length > 200) this.history.shift();
    this.historyAt = this.history.length - 1;
    this.renderTools();
  }

  private undo(dir: -1 | 1) {
    const at = this.historyAt + dir;
    if (at < 0 || at >= this.history.length) return;
    this.historyAt = at;
    this.draft = JSON.parse(this.history[at]) as RobotDesign;
    registerCatalog(this.draft);
    if (!this.draft.parts.some((p) => p.id === this.selected)) this.selected = root(this.draft).id;
    this.host.highlight(this.selected);
    this.renderEditor();
    clearTimeout(this.rebuildTimer);
    this.rebuild();
    this.flash(dir < 0 ? 'Undone.' : 'Redone.');
  }

  private key(e: KeyboardEvent) {
    const t = e.target;
    if ((t instanceof HTMLInputElement && t.type !== 'range') || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const p = this.draft.parts.find((q) => q.id === this.selected);
    if (ctrl && e.code === 'KeyZ') { e.preventDefault(); this.undo(e.shiftKey ? 1 : -1); return; }
    if (ctrl && e.code === 'KeyY') { e.preventDefault(); this.undo(1); return; }
    if (ctrl && e.code === 'KeyD' && p && p.parent !== null) { e.preventDefault(); this.duplicate(p); return; }
    if ((e.code === 'Delete' || e.code === 'Backspace') && p && p.parent !== null) { e.preventDefault(); this.remove(p); return; }
    if (ctrl || e.altKey) return;
    const tool = ({ Digit1: 'select', Digit2: 'translate', Digit3: 'rotate', Digit4: 'scale' } as Record<string, Tool>)[e.code];
    if (tool && !(tool === 'scale' && p?.role !== 'structure')) this.setTool(tool);
  }

  private duplicate(p: PartDef) {
    const d = this.draft;
    const copy = mirrorPart(d, p.id);
    // A mirror of a mirror is a straight copy; nudge it so it's visible.
    const twice = mirrorPart({ ...d, parts: [...d.parts, ...copy] }, copy[0].id);
    twice[0].position = [p.position[0] + 0.05, p.position[1], p.position[2] + 0.05];
    twice[0].label = `${p.label} copy`;
    d.parts.push(...twice);
    this.select(twice[0].id);
    this.changed(true);
  }

  private remove(p: PartDef) {
    if (!confirm(`Remove ${p.label} and everything attached to it?`)) return;
    const parent = p.parent!;
    removePart(this.draft, p.id);
    this.select(parent);
    this.changed(true);
  }

  // ---------------------------------------------------------------- change plumbing

  /** A value changed: refresh numbers now, rebuild the test bay shortly. */
  private changed(structural = false) {
    if (structural) this.renderEditor();
    this.renderSummary();
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => this.rebuild(), 200);
  }

  private rebuild() {
    if (this.exited) return;
    try {
      this.host.startBay(this.draft);
      this.buildError = '';
    } catch (e) {
      this.buildError = `Can't build this yet: ${(e as Error).message}`;
    }
    this.record();
    this.renderSummary();
    this.updateGizmo();
  }

  private select(id: string) {
    this.selected = id;
    this.tab = 'parts';
    this.host.highlight(id);
    this.renderEditor();
    if (this.tool === 'scale' && this.draft.parts.find((p) => p.id === id)?.role !== 'structure') this.tool = 'translate';
    this.refreshTools();
  }

  private load(d: RobotDesign) {
    this.draft = cloneDesign(d);
    this.selected = root(this.draft).id;
    this.host.highlight(this.selected);
    this.changed(true);
    clearTimeout(this.rebuildTimer);
    this.rebuild();
    this.refreshTools();
  }

  private save() {
    if (TEMPLATE_IDS.has(this.draft.id)) {
      // Never overwrite a starter robot: saving makes it yours.
      this.draft.id = `custom-${Date.now().toString(36)}`;
      if ([...TEMPLATES, ...HOUSE_ROBOTS, ...MONSTER_HOUSE].some((t) => t.name === this.draft.name)) this.draft.name = `${this.draft.name} Mk II`;
    }
    saveDesign(cloneDesign(this.draft));
    const legal = isLegal(scrutineer(this.draft, this.rules));
    this.flash(this.buildError ? `Saved "${this.draft.name}" — but it can't be built yet, so it can't fight. ${this.buildError}`
      : legal ? `Saved "${this.draft.name}". It's on the robot select screen.` : `Saved "${this.draft.name}" — but it won't pass scrutineering yet.`);
    if (this.tab === 'robot') this.renderEditor();
  }

  private flash(text: string) {
    this.status.textContent = text;
    window.setTimeout(() => { if (this.status.textContent === text) this.status.textContent = ''; }, 5000);
  }

  // ---------------------------------------------------------------- field helpers

  /**
   * A number with a slider for the usual range — but no limits: type any
   * value into the box. `floor` only stops physically meaningless values (a
   * negative size).
   */
  private num(label: string, value: number, set: (v: number) => void, o: { min: number; max: number; step: number; unit?: string; after?: () => void; floor?: number }) {
    const range = h('input', { type: 'range', min: Math.min(o.min, value), max: Math.max(o.max, value), step: o.step, value });
    const box = h('input', { type: 'number', class: 'numbox', step: 'any', value });
    const apply = (raw: string) => {
      let v = Number(raw);
      if (!Number.isFinite(v)) return;
      if (o.floor !== undefined) v = Math.max(o.floor, v);
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
    return this.num(label, Math.round(metres * 10000) / 10, (v) => set(v / 1000), { min, max, step: 1, unit: 'mm', after, floor: min > 0 ? 0.5 : undefined });
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
      h('h4', {}, 'House robots'),
      h('div', { class: 'hint' }, 'See how the arena\'s heavies are built, or make your own. They\'re far over the competitor limits — set the weight class to Open to pass scrutineering.'),
      h('div', { class: 'chips' }, ...[...HOUSE_ROBOTS, ...MONSTER_HOUSE].map((t) => h('button', { class: 'small', onclick: () => this.confirmLoad(t) }, t.name))),
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
    const icon = (p: PartDef) => (p.role === 'wheel' ? '◎' : p.role === 'component' ? '▪' : p.joint.type === 'hinge' ? '↻' : p.joint.type === 'slider' ? '⇕' : p.joint.type === 'ball' ? '◍' : '▢');
    const walk = (p: PartDef, depth: number) => {
      const act = actuatorOf(p) ? ` · ${actuatorOf(p)!.type}` : '';
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
      if (made.some((p) => actuatorOf(p)?.type === 'pneumatic') && !d.parts.some((p) => p.component?.type === 'gasTank')) {
        d.parts.push(...newParts(d, 'gasTank', root(d).id));
      }
      this.select(made[0].id);
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
      !isRoot && h('button', { class: 'small', title: 'Ctrl+D', onclick: () => this.duplicate(p) }, 'Duplicate'),
      !isRoot && h('button', { class: 'small', title: 'Delete key', onclick: () => this.remove(p) }, 'Remove'),
      isRoot && h('span', { class: 'hint' }, 'The chassis: everything else hangs off this part.')));

    // What it is.
    if (p.role === 'structure') out.push(...this.shapeFields(p));
    if (p.role === 'wheel') {
      out.push(...this.catalogSel('Wheel', 'wheels', p.wheel!, (v) => (p.wheel = v), (w: WheelSpec) => `${w.name} — Ø${Math.round(w.radius * 2000)} mm, grip ${w.grip}, ${w.mass} kg`));
    }
    if (p.role === 'component') out.push(...this.componentFields(p));
    out.push(h('label', { class: 'field wide' }, h('span', { class: 'flabel' }, 'Paint'),
      h('span', {},
        h('input', { type: 'color', value: p.colour ?? d.colour, oninput: (e: Event) => { p.colour = (e.target as HTMLInputElement).value; this.changed(); } }),
        p.colour && h('button', { class: 'small', style: 'margin-left:6px', onclick: () => { delete p.colour; this.changed(true); } }, 'Use robot colour'))));

    // Where it is.
    out.push(h('h4', {}, 'Placement'));
    out.push(h('div', { class: 'hint' }, `${isRoot ? 'Relative to the floor centre.' : `Relative to ${d.parts.find((q) => q.id === p.parent)?.label}.`} +Z forward, +Y up, +X left. Or drag it in the 3D view with the Move / Rotate / Resize tools.`));
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
    const types: Array<[Shape['type'], string]> = [
      ['box', 'Box'], ['armour', 'Armour shell — sloped sides, raked front/back'], ['wedge', 'Wedge'], ['cylinder', 'Cylinder / disc'], ['cone', 'Cone'], ['sphere', 'Sphere'], ['capsule', 'Capsule / rod'],
      ['extrude', 'Drawn outline (extruded) — any 2D shape'], ['lathe', 'Drawn profile (spun) — drums, domes, bells'],
      ['mesh', 'Imported 3D model (STL / OBJ)'], ['hull', 'Convex hull of points'],
    ];
    const out: HTMLElement[] = [];
    out.push(this.sel('Shape', types, s.type, (t) => (p.shape = convertShape(s, t)), true));
    switch (s.type) {
      case 'box': case 'wedge':
        out.push(this.mm('Width (X)', s.size[0], (v) => (s.size[0] = v), 5, 1500), this.mm('Height (Y)', s.size[1], (v) => (s.size[1] = v), 2, 1500), this.mm('Length (Z)', s.size[2], (v) => (s.size[2] = v), 5, 1500));
        if (s.type === 'wedge') out.push(this.mm('Front lip', s.lip, (v) => (s.lip = v), 0, 500));
        break;
      case 'armour':
        out.push(this.mm('Width (X)', s.size[0], (v) => (s.size[0] = v), 5, 1500), this.mm('Height (Y)', s.size[1], (v) => (s.size[1] = v), 2, 1500), this.mm('Length (Z)', s.size[2], (v) => (s.size[2] = v), 5, 1500));
        out.push(h('div', { class: 'hint' }, 'Sloped armour deflects hits and is harder to get under. The sides rise straight to the belt line, then lean in.'));
        out.push(this.num('Belt line', Math.round(s.belt * 100), (v) => (s.belt = v / 100), { min: 0, max: 100, step: 1, unit: '% up' }));
        out.push(this.mm('Side slope (each side)', s.sides, (v) => (s.sides = v), 0, 400), this.mm('Front rake', s.front, (v) => (s.front = v), 0, 600), this.mm('Rear rake', s.rear, (v) => (s.rear = v), 0, 600));
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
      case 'extrude': {
        const planes: Array<['top' | 'side' | 'front', string]> = [['top', 'Drawn from above, extruded up'], ['side', 'Drawn from the side, extruded across'], ['front', 'Drawn from the front, extruded back']];
        const plane = s.plane ?? 'top';
        out.push(this.sel('Drawing plane', planes, plane, (v) => (s.plane = v), true));
        out.push(this.mm('Thickness', s.depth, (v) => (s.depth = v), 1, 1000));
        const axes: Record<string, [string, string]> = { top: ['left', 'forward'], side: ['forward', 'up'], front: ['left', 'up'] };
        out.push(this.presetRow(OUTLINE_PRESETS, (pts) => (s.outline = pts)));
        out.push(sketchEditor(s.outline, { mode: 'outline', axes: axes[plane], onChange: (pts) => { s.outline = pts; this.changed(); } }));
        break;
      }
      case 'lathe': {
        out.push(this.num('Smoothness', s.segments ?? 24, (v) => (s.segments = Math.round(v)), { min: 8, max: 48, step: 1, unit: 'sides', floor: 8 }));
        out.push(this.presetRow(PROFILE_PRESETS, (pts) => (s.profile = pts)));
        out.push(sketchEditor(s.profile, { mode: 'profile', axes: ['radius', 'up (part Y)'], onChange: (pts) => { s.profile = pts; this.changed(); } }));
        break;
      }
      case 'mesh': {
        const status = h('div', { class: 'hint' }, `${s.indices.length / 3} triangles · physics as ${convexPieces(s).length} boxes`);
        const units = h('select', {}, h('option', { value: '0.001' }, 'File is in mm'), h('option', { value: '0.01' }, 'File is in cm'), h('option', { value: '1' }, 'File is in m'), h('option', { value: '0.0254' }, 'File is in inches'));
        const file = h('input', { type: 'file', accept: '.stl,.obj' });
        file.addEventListener('change', async () => {
          const f = file.files?.[0];
          if (!f) return;
          try {
            const m = await importModel(f, Number(units.value));
            s.vertices = m.vertices; s.indices = m.indices;
            if (!p.label || p.label === 'Model') p.label = f.name.replace(/\.[^.]+$/, '');
            this.flash(`Imported ${m.triangles} triangles, ${m.size.map((x) => Math.round(x * 1000)).join(' × ')} mm.`);
            this.changed(true);
          } catch (e) { status.textContent = (e as Error).message; status.className = 'err'; }
        });
        out.push(h('label', { class: 'field wide' }, h('span', { class: 'flabel' }, 'Units'), units));
        out.push(h('label', { class: 'field wide' }, h('span', { class: 'flabel' }, 'Model file'), file));
        out.push(this.mm('Physics detail', s.voxel ?? 0, (v) => (s.voxel = v > 0 ? v : undefined), 0, 200));
        out.push(h('div', { class: 'hint' }, 'The physics approximates the model with boxes this size (0 = automatic). Smaller is more accurate but slower.'));
        out.push(status);
        break;
      }
    }
    out.push(...this.catalogSel('Material', 'materials', p.material ?? 'aluminium', (v) => (p.material = v), (m: Material) => `${m.name} — ${m.density} kg/m³, £${m.costPerKg}/kg`));
    out.push(this.sel('Construction', [['shell', 'Hollow shell (plate)'], ['solid', 'Solid']], p.wall ? 'shell' : 'solid', (v) => { if (v === 'solid') delete p.wall; else p.wall = 5; }, true));
    if (p.wall) out.push(this.num('Wall thickness', p.wall, (v) => (p.wall = v), { min: 0.5, max: 50, step: 0.5, unit: 'mm', floor: 0.1 }));
    const edges: Array<[EdgeKind | 'auto', string]> = [['auto', 'Automatic'], ['blunt', 'Blunt (plate, wedge)'], ['blade', 'Blade / tooth'], ['spike', 'Spike / point'], ['saw', 'Saw teeth']];
    out.push(this.sel('Edge', edges, p.edge ?? 'auto', (v) => { if (v === 'auto') delete p.edge; else p.edge = v; if (v !== 'saw') delete p.chain; }, true));
    out.push(h('div', { class: 'hint' }, {
      auto: 'Hard-metal parts of a spinning weapon count as teeth; anything else is blunt.',
      blunt: 'Dents what it hits. Harder dents softer.',
      blade: 'Hits bite deeper — far deeper into anything softer than it.',
      spike: 'Hits punch through, and it pierces under steady force once it pushes hard enough (crushers, lances).',
      saw: 'Cuts as it slides: spin it, or fit a chain. Eats soft materials, struggles with hardened steel.',
    }[p.edge ?? 'auto']));
    if (p.edge === 'saw') {
      out.push(this.sel('Chain', [['none', 'No chain (a spinning saw)'], ['chain', 'Chainsaw chain']], p.chain ? 'chain' : 'none', (v) => {
        if (v === 'none') delete p.chain;
        else p.chain = { input: { source: 'button2', mode: 'toggle' }, speed: 20 };
      }, true));
      if (p.chain) {
        const ch = p.chain;
        out.push(this.num('Chain speed', ch.speed, (v) => (ch.speed = v), { min: 2, max: 40, step: 1, unit: 'm/s', floor: 0 }));
        out.push(...this.inputFields({ type: 'motor', motor: 'wm400', gear: 1, input: ch.input }));
      }
    }
    return out;
  }

  private componentFields(p: PartDef): HTMLElement[] {
    const c = p.component!;
    if (c.type === 'battery') return this.catalogSel('Battery', 'batteries', c.part, (v) => (c.part = v), (b: BatterySpec) => `${b.name} — ${b.voltage} V, ${b.capacity} Wh, ${b.maxCurrent} A, ${b.mass} kg`);
    if (c.type === 'gasTank') return this.catalogSel('Gas bottle', 'tanks', c.part, (v) => (c.part = v), (t: TankSpec) => `${t.name} — ${t.capacity} g CO2, ${t.mass} kg`);
    if (c.type === 'flamethrower') {
      return [
        h('div', { class: 'hint' }, 'Shoots flame along this part\'s forward (+Z) direction. A banned weapon: Open class only.'),
        this.mm('Reach', c.range, (v) => (c.range = v), 100, 2000),
        this.num('Fuel', c.fuel, (v) => (c.fuel = v), { min: 0.1, max: 10, step: 0.1, unit: 'kg', floor: 0 }),
        ...this.inputFields({ input: c.input } as ActuatorDef),
      ];
    }
    return [this.num('Mass', c.mass, (v) => (c.mass = v), { min: 0.1, max: 60, step: 0.1, unit: 'kg', floor: 0 })];
  }

  private jointFields(p: PartDef): HTMLElement[] {
    const out: HTMLElement[] = [h('h4', {}, 'Joint')];
    const types: Array<[JointDef['type'], string]> = p.role === 'wheel' ? [['hinge', 'Hinge (axle)']]
      : [['fixed', 'Fixed (bolted on)'], ['hinge', 'Hinge (rotates)'], ['slider', 'Slider (moves in a line)'], ['ball', 'Ball joint (swings any way — flails, chains)']];
    out.push(this.sel('Type', types, p.joint.type, (t) => {
      const prev = p.joint;
      const axis: Vec3 = prev.type === 'hinge' || prev.type === 'slider' ? prev.axis : [1, 0, 0];
      p.joint = t === 'fixed' ? { type: 'fixed' } : t === 'ball' ? { type: 'ball' } : t === 'hinge' ? { type: 'hinge', axis, limits: [-45, 45] } : { type: 'slider', axis: [0, 1, 0], limits: [0, 100] };
    }, true));
    const j = p.joint;
    if (j.type === 'fixed' || j.type === 'ball') return out;
    const axes: Array<[string, string]> = [['1,0,0', '+X (left)'], ['-1,0,0', '−X (right)'], ['0,1,0', '+Y (up)'], ['0,-1,0', '−Y (down)'], ['0,0,1', '+Z (forward)'], ['0,0,-1', '−Z (back)'], ['custom', 'Any direction…']];
    const key = j.axis.join(',');
    const preset = axes.some(([k]) => k === key);
    out.push(this.sel('Axis', axes, preset ? key : 'custom', (v) => { if (v !== 'custom') j.axis = v.split(',').map(Number) as Vec3; else if (preset) j.axis = [1, 1, 0]; }, true));
    if (!preset) {
      out.push(h('div', { class: 'hint' }, 'Axis direction in this part\'s frame (any numbers; it\'s normalised).'));
      (['X', 'Y', 'Z'] as const).forEach((n, k) => out.push(this.num(`Axis ${n}`, j.axis[k], (v) => (j.axis[k] = v), { min: -1, max: 1, step: 0.05 })));
    }
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

    out.push(h('h4', {}, 'Spring'));
    const unitK = j.type === 'hinge' ? 'N·m/°' : 'N/mm';
    out.push(this.sel('Spring', [['none', 'None'], ['spring', 'Spring back to the built position']], j.spring ? 'spring' : 'none', (v) => { if (v === 'none') delete j.spring; else j.spring = { stiffness: j.type === 'hinge' ? 2 : 20, damping: j.type === 'hinge' ? 0.05 : 0.5 }; }, true));
    if (j.spring) {
      const sp = j.spring;
      out.push(this.num('Stiffness', sp.stiffness, (v) => (sp.stiffness = v), { min: 0, max: j.type === 'hinge' ? 50 : 500, step: 0.1, unit: unitK, floor: 0 }));
      out.push(this.num('Damping', sp.damping, (v) => (sp.damping = v), { min: 0, max: j.type === 'hinge' ? 2 : 20, step: 0.01, unit: `${unitK}·s`, floor: 0 }));
    }

    out.push(h('h4', {}, 'Actuator'));
    const a = j.actuator;
    const kinds: Array<[string, string]> = [['none', 'None (free)'], ...(j.type === 'hinge' ? [['motor', 'DC motor (spins)'] as [string, string]] : []), ['pneumatic', 'Pneumatic ram'], ['servo', 'Servo (holds a position)']];
    out.push(this.sel('Driven by', kinds, a?.type ?? 'none', (v) => (j.actuator = defaultActuator(v, a?.input)), true));
    if (!a) return out;
    if (a.type === 'motor' || a.type === 'servo') {
      out.push(...this.catalogSel('Motor', 'motors', a.motor, (v) => (a.motor = v), (m: MotorSpec) => `${m.name} — ${m.voltage} V, ${m.stallTorque} N·m, ${fmt(m.freeSpeed)} rpm, ${m.mass} kg`));
      out.push(this.num('Gear reduction', a.gear, (v) => (a.gear = v), { min: 1, max: 200, step: 0.5, unit: ': 1', floor: 0.01 }));
    }
    if (a.type === 'motor') {
      out.push(this.num('Soft start', a.softStart ?? 0, (v) => { if (v > 0) a.softStart = v; else delete a.softStart; }, { min: 0, max: 10, step: 0.1, unit: 's', floor: 0 }));
      out.push(h('div', { class: 'hint' }, 'Seconds the speed controller takes to ramp up to full power. Spinning a heavy weapon up gently stops it twisting the whole robot round the other way.'));
    }
    if (a.type === 'servo') {
      const unit = j.type === 'hinge' ? '°' : 'mm';
      out.push(this.num('Position at −1', a.targets[0], (v) => (a.targets[0] = v), { min: -360, max: 360, step: 1, unit }));
      out.push(this.num('Position at 0', a.targets[1], (v) => (a.targets[1] = v), { min: -360, max: 360, step: 1, unit }));
      out.push(this.num('Position at +1', a.targets[2], (v) => (a.targets[2] = v), { min: -360, max: 360, step: 1, unit }));
    }
    if (a.type === 'pneumatic') {
      out.push(...this.catalogSel('Ram', 'rams', a.ram, (v) => (a.ram = v), (r: RamSpec) => `${r.name} — ${r.bore} mm bore, ${r.stroke} mm stroke, max ${r.maxPressure} bar`));
      out.push(...this.catalogSel('Valve', 'valves', a.valve, (v) => (a.valve = v), (v: ValveSpec) => `${v.name} — ${Math.round(v.timeConstant * 1000)} ms${v.maxRate ? ', flow-limited' : ''}`));
      out.push(this.num('Pressure', a.pressure, (v) => (a.pressure = v), { min: 2, max: 60, step: 1, unit: 'bar', floor: 0 }));
      if (j.type === 'hinge') out.push(this.mm('Lever arm', a.leverArm, (v) => (a.leverArm = v), 10, 500));
    }
    out.push(...this.inputFields(a));
    if (j.type === 'slider' && a.type === 'pneumatic' && p.role === 'structure') out.push(...this.launchFields(p));
    return out;
  }

  /** A ram slider can fire its part off the end: a cannon, or a harpoon on a cable. */
  private launchFields(p: PartDef): HTMLElement[] {
    const out: HTMLElement[] = [h('h4', {}, 'Launch')];
    const l = p.launch;
    const kind = !l ? 'none' : l.tether ? 'harpoon' : 'cannon';
    out.push(this.sel('Fires it', [['none', 'No — it stays on the slider'], ['harpoon', 'Harpoon — on a steel cable'], ['cannon', 'Cannon — flies free (Open class only)']], kind, (v) => {
      if (v === 'none') delete p.launch;
      else if (v === 'harpoon') p.launch = { tether: { length: 6 } };
      else p.launch = { rounds: 5, reload: 1.5 };
    }, true));
    if (!l) return out;
    out.push(h('div', { class: 'hint' }, 'At the end of the ram\'s stroke this part (and anything bolted to it) leaves with whatever speed the gas gave it — a light round goes faster, a heavy one shoves harder. Pointed (spike-edged) rounds stick into plate they can pierce.'));
    if (l.tether) {
      const t = l.tether;
      out.push(this.num('Cable length', t.length, (v) => (t.length = v), { min: 0.5, max: 15, step: 0.5, unit: 'm', floor: 0.5 }));
      out.push(this.sel('Winch', [['none', 'None — the cable just ties you together'], ['winch', 'Motor winch']], t.winch ? 'winch' : 'none', (v) => {
        if (v === 'none') delete t.winch;
        else t.winch = { motor: 'wm900', gear: 25, drum: 30, input: { source: 'button2', mode: 'hold' } };
      }, true));
      if (t.winch) {
        const w = t.winch;
        out.push(...this.catalogSel('Winch motor', 'motors', w.motor, (v) => (w.motor = v), (m: MotorSpec) => `${m.name} — ${m.voltage} V, ${m.stallTorque} N·m, ${fmt(m.freeSpeed)} rpm, ${m.mass} kg`));
        out.push(this.num('Gear reduction', w.gear, (v) => (w.gear = v), { min: 1, max: 200, step: 0.5, unit: ': 1', floor: 1 }));
        out.push(this.num('Drum radius', w.drum, (v) => (w.drum = v), { min: 5, max: 200, step: 1, unit: 'mm', floor: 5 }));
        out.push(h('div', { class: 'hint' }, 'Pull = motor torque × gear ÷ drum radius; speed the other way round. It pulls both ends: a lighter robot reels itself in. Reel in a miss and it drops back into the barrel; press fire again to cut the cable.'));
        out.push(...this.inputFields({ type: 'motor', motor: w.motor, gear: w.gear, input: w.input }));
      }
    } else {
      out.push(this.num('Spare rounds', l.rounds ?? 0, (v) => (l.rounds = Math.round(v)), { min: 0, max: 50, step: 1, floor: 0 }));
      out.push(this.num('Reload time', l.reload ?? 1.5, (v) => (l.reload = v), { min: 0.2, max: 30, step: 0.1, unit: 's', floor: 0.2 }));
    }
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

  private presetRow(presets: Record<string, Array<[number, number]>>, apply: (pts: Array<[number, number]>) => void) {
    const s = h('select', { onchange: () => { if (s.value) { apply(presets[s.value].map((q) => [q[0], q[1]])); this.changed(true); } } },
      h('option', { value: '' }, 'Start from a preset…'), ...Object.keys(presets).map((k) => h('option', { value: k }, k)));
    return h('label', { class: 'field wide' }, h('span', { class: 'flabel' }, 'Preset'), s);
  }

  /**
   * A catalogue picker that also lets you make your own part: "New custom…"
   * copies the current spec into the design's own catalogue, where every
   * number is editable.
   */
  private catalogSel<T extends { id: string; name: string }>(label: string, kind: keyof CustomCatalog, value: string, set: (id: string) => void, describe: (spec: T) => string): HTMLElement[] {
    const table = CATALOG_TABLES[kind] as unknown as Record<string, T>;
    const d = this.draft;
    const mine = d.catalog?.[kind] as Record<string, T> | undefined;
    const options: Array<[string, string]> = Object.values(table).map((t) => [t.id, `${mine?.[t.id] ? '★ ' : ''}${describe(t)}`]);
    options.push(['__new', '＋ New custom part (copy this one)…']);
    const out: HTMLElement[] = [this.sel(label, options, value, (v) => {
      if (v !== '__new') { set(v); return; }
      const base = table[value] ?? Object.values(table)[0];
      const id = `custom-${kind}-${Date.now().toString(36)}`;
      const spec = { ...JSON.parse(JSON.stringify(base)), id, name: `Custom ${base.name}` } as T;
      d.catalog ??= {};
      ((d.catalog[kind] ??= {}) as unknown as Record<string, T>)[id] = spec;
      registerCatalog(d);
      set(id);
    }, true)];
    const spec = mine?.[value];
    if (spec) out.push(this.specEditor(spec as unknown as Record<string, unknown>));
    return out;
  }

  private specEditor(spec: Record<string, unknown>): HTMLElement {
    const rows: HTMLElement[] = [h('div', { class: 'hint' }, 'Your own part — set any value you like.')];
    rows.push(h('label', { class: 'field wide' }, h('span', { class: 'flabel' }, 'Name'),
      h('input', { type: 'text', value: String(spec.name), oninput: (e: Event) => { spec.name = (e.target as HTMLInputElement).value; this.changed(); } })));
    for (const [key, val] of Object.entries(spec)) {
      if (typeof val !== 'number' || key === 'colour') continue;
      const [label, unit, scale] = SPEC_FIELDS[key] ?? [key, '', 1];
      rows.push(this.num(label, val * scale, (v) => (spec[key] = v / scale), { min: 0, max: Math.max(1, val * scale * 4), step: 0.01, unit, floor: 0 }));
    }
    if ('sourcing' in spec) rows.push(this.sel('Availability', [['common', 'Off the shelf'], ['specialist', 'Specialist'], ['custom', 'One-off']], spec.sourcing as 'common', (v) => (spec.sourcing = v)));
    return h('div', { class: 'spec' }, ...rows);
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
    const gauges: HTMLElement[] = [
      gauge('Battery', r.energy / r.battery.capacity, r.powered ? `${fmt((100 * r.energy) / r.battery.capacity)}% · ${fmt(r.current)} A` : 'NO POWER'),
    ];
    if (r.gasCapacity) gauges.push(gauge('Gas', r.gasLeft / r.gasCapacity, `${fmt(r.gasLeft)} of ${fmt(r.gasCapacity)} g · ${shotsLeft(r)} shots`, { colour: '#6cb6e8' }));
    for (const fl of r.flames) gauges.push(gauge('Fuel', fl.fuel / Math.max(1e-6, fl.def.fuel), `${fmt(fl.fuel, 2)} kg`, { colour: '#ff8a3a' }));
    const rows: Array<[string, string]> = [
      ['Speed', `${fmt(Math.hypot(v.x, v.z), 1)} m/s`],
    ];
    for (const rot of r.rotors()) rows.push([rot.actuator.driven.label, `${fmt(rot.rpm)} rpm${rot.on ? '' : ' (off)'}`]);
    for (const a of r.actuators.filter((x) => x.def.type !== 'motor' || x.locomotion).slice(0, 6)) {
      rows.push([a.driven.label, a.joint === 'hinge' ? `${fmt((a.position * 180) / Math.PI)}°` : `${fmt(a.position * 1000)} mm`]);
    }
    const hit = m.biggestHit;
    rows.push(['Biggest hit', hit ? `${fmt(hit.energy)} J — ${hit.parts}` : '—']);
    const dummy = m.robots[1];
    const hurt = dummy ? dummy.parts.filter((p) => p.condition < 0.97).map((p) => `${p.label}: ${conditionLabel(p.condition)}`) : [];
    rows.push(['Dummy damage', hurt.length ? hurt.join(', ') : 'none']);
    rows.push(['Your damage', RobotDiagram.worst(r, 6) || 'none']);
    this.diagram.draw(r);
    this.telemetry.replaceChildren(...gauges,
      h('div', { class: 'diagram-row' }, this.diagram.el, h('div', { class: 'hint' }, 'Your robot from above, front up. Green is healthy, red is failing, grey is gone.')),
      h('dl', { class: 'stats' }, ...rows.flatMap(([k, val]) => [h('dt', {}, k), h('dd', {}, val)])));
  }
}

/** Change a shape's type, keeping roughly the same size. */
function convertShape(s: Shape, t: Shape['type']): Shape {
  if (s.type === t) return s;
  const hh = shapeHalf(s);
  const half = { x: Math.max(hh.x, 0.01), y: Math.max(hh.y, 0.005), z: Math.max(hh.z, 0.01) };
  const r = Math.round(Math.max(half.x, half.z) * 1000) / 1000, l = Math.round(half.y * 2000) / 1000;
  const size: Vec3 = [half.x * 2, half.y * 2, half.z * 2];
  const [x, y, z] = [half.x, half.y, half.z];
  switch (t) {
    case 'box': return { type: 'box', size };
    case 'wedge': return { type: 'wedge', size, lip: 0.01 };
    case 'armour': return { type: 'armour', size, sides: Math.round(x * 150) / 1000, front: 0, rear: Math.round(z * 300) / 1000, belt: 0.5 };
    case 'cylinder': return { type: 'cylinder', radius: r, length: l };
    case 'cone': return { type: 'cone', radius: r, length: l };
    case 'sphere': return { type: 'sphere', radius: r };
    case 'capsule': return { type: 'capsule', radius: Math.min(r, l / 2), length: l };
    case 'hull': return { type: 'hull', points: [[-x, -y, -z], [x, -y, -z], [-x, -y, z], [x, -y, z], [0, y, 0]] };
    case 'extrude': return { type: 'extrude', plane: 'top', depth: y * 2, outline: [[-x, -z], [x, -z], [x, z], [-x, z]] };
    case 'lathe': return { type: 'lathe', segments: 24, profile: [[0, -y], [r, -y], [r, y], [0, y]] };
    case 'mesh': {
      // A placeholder box until a model is imported.
      const v = [-x, -y, -z, x, -y, -z, x, y, -z, -x, y, -z, -x, -y, z, x, -y, z, x, y, z, -x, y, z];
      const i = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];
      return { type: 'mesh', vertices: v, indices: i };
    }
  }
}

const CATALOG_TABLES = { motors: MOTORS, batteries: BATTERIES, wheels: WHEELS, rams: RAMS, valves: VALVES, tanks: TANKS, materials: MATERIALS };

/** Labels, units and display scale for custom-part numbers. */
const SPEC_FIELDS: Record<string, [string, string, number]> = {
  mass: ['Mass', 'kg', 1], cost: ['Cost', '£', 1], swapMinutes: ['Swap time', 'min', 1],
  voltage: ['Voltage', 'V', 1], stallTorque: ['Stall torque', 'N·m', 1], freeSpeed: ['Free speed', 'rpm', 1], stallCurrent: ['Stall current', 'A', 1], freeCurrent: ['Free current', 'A', 1],
  capacity: ['Capacity', 'Wh / g', 1], maxCurrent: ['Max current', 'A', 1],
  radius: ['Radius', 'mm', 1000], width: ['Width', 'mm', 1000], grip: ['Grip', 'μ', 1],
  bore: ['Bore', 'mm', 1], stroke: ['Stroke', 'mm', 1], maxPressure: ['Max pressure', 'bar', 1],
  timeConstant: ['Response time', 's', 1], maxRate: ['Max speed', 'rad/s', 1],
  density: ['Density', 'kg/m³', 1], yieldStrength: ['Yield strength', 'MPa', 1], toughness: ['Toughness', '× aluminium', 1], costPerKg: ['Cost', '£/kg', 1], friction: ['Friction', 'μ', 1],
};

function defaultActuator(kind: string, input?: InputDef): ActuatorDef | undefined {
  switch (kind) {
    case 'motor': return { type: 'motor', motor: 'dm750', gear: 9, input: input ?? { source: 'button1', mode: 'toggle' } };
    case 'pneumatic': return { type: 'pneumatic', ram: 'ram63', valve: 'std', pressure: 20, leverArm: 0.12, input: input ?? { source: 'button1', mode: 'hold' } };
    case 'servo': return { type: 'servo', motor: 'dm750', gear: 30, targets: [-30, 0, 30], input: input ?? { source: 'steer', scale: 1 } };
    default: return undefined;
  }
}

