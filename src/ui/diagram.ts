import { partFrames, root, shapeCorners } from '../sim/assembly';
import { conditionLabel } from '../sim/damage';
import type { Part, Robot } from '../sim/robot';
import { h } from './dom';

/** A part's footprint seen from above, in robot-frame metres (x, z). */
interface Footprint {
  part: Part;
  poly: Array<[number, number]>;
  /** Top of the part, so higher parts draw over lower ones. */
  top: number;
  /** Internals are drawn small and solid on top of the armour. */
  inside: boolean;
}

/** Health colour: green when new, through amber, to red as it fails. */
export function healthColour(condition: number, gone = false): string {
  if (gone || condition <= 0) return '#4a4d52';
  const c = Math.max(0, Math.min(1, condition));
  return `hsl(${Math.round(c * c * 120)}, 72%, ${44 + (1 - c) * 6}%)`;
}

/**
 * A little plan view of a robot with every part coloured by its health — the
 * at-a-glance version of the damage report. Front is up.
 */
export class RobotDiagram {
  readonly el: HTMLCanvasElement;
  private robot: Robot | null = null;
  private prints: Footprint[] = [];
  private view = { cx: 0, cz: 0, scale: 1 };

  constructor(private size = 140) {
    this.el = h('canvas', { class: 'diagram', width: size * 2, height: size * 2, style: `width:${size}px;height:${size}px` });
  }

  draw(r: Robot) {
    if (r !== this.robot) this.layout(r);
    const g = this.el.getContext('2d');
    if (!g) return;
    const s = this.size * 2;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, s, s);
    const { cx, cz, scale } = this.view;
    // Robot +X is its left, so with the front up it goes to screen left.
    const px = (x: number, z: number): [number, number] => [s / 2 - (x - cx) * scale, s / 2 - (z - cz) * scale];
    for (const f of this.prints) {
      const p = f.part;
      const gone = p.detached || p.failed;
      g.beginPath();
      f.poly.forEach(([x, z], i) => { const [u, v] = px(x, z); if (i) g.lineTo(u, v); else g.moveTo(u, v); });
      g.closePath();
      g.globalAlpha = f.inside ? 1 : gone ? 0.35 : 0.8;
      g.fillStyle = healthColour(p.condition, gone);
      g.fill();
      g.globalAlpha = 1;
      g.setLineDash(gone ? [6, 5] : []);
      g.lineWidth = f.inside ? 2.5 : 2;
      g.strokeStyle = f.inside ? 'rgba(0,0,0,0.85)' : 'rgba(10,12,16,0.9)';
      g.stroke();
    }
    g.setLineDash([]);
    // Which way is forward.
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath();
    g.moveTo(s / 2, 6); g.lineTo(s / 2 - 9, 20); g.lineTo(s / 2 + 9, 20);
    g.fill();
  }

  /** Worst-off parts, for a line of text under the picture. */
  static worst(r: Robot, n = 3): string {
    const hurt = r.parts.filter((p) => p.condition < 0.97 || p.detached).sort((a, b) => a.condition - b.condition).slice(0, n);
    return hurt.map((p) => `${p.label}: ${p.detached && p.condition > 0 ? 'Detached' : conditionLabel(p.condition)}`).join(' · ');
  }

  private layout(r: Robot) {
    this.robot = r;
    const d = r.design;
    const frames = partFrames(d);
    const origin = frames.get(root(d).id)!.pos;
    const prints: Footprint[] = [];
    for (const p of r.parts) {
      if (p.def) {
        const f = frames.get(p.id);
        if (!f) continue;
        const pts = shapeCorners(p.def, f);
        const inside = p.kind === 'component';
        let poly = hull2d(pts.map((q) => [q.x, q.z]));
        if (inside) poly = shrink(poly, 0.85);
        prints.push({ part: p, poly, top: Math.max(...pts.map((q) => q.y)), inside });
      } else {
        // Motors, rams and the electronics: a small square where they sit.
        const base = frames.get(p.bodyKey)?.pos ?? origin;
        const x = base.x + p.local.x, z = base.z + p.local.z;
        const k = p.kind === 'electronics' ? 0.05 : 0.035;
        prints.push({ part: p, poly: [[x - k, z - k], [x + k, z - k], [x + k, z + k], [x - k, z + k]], top: Infinity, inside: true });
      }
    }
    // Armour underneath, wheels and higher plates over it, internals on top.
    prints.sort((a, b) => Number(a.inside) - Number(b.inside) || a.top - b.top);
    this.prints = prints;
    const xs = prints.flatMap((f) => f.poly.map((q) => q[0])), zs = prints.flatMap((f) => f.poly.map((q) => q[1]));
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const span = Math.max(x1 - x0, z1 - z0, 0.1);
    this.view = { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, scale: (this.size * 2 - 36) / span };
  }
}

/** Shots of gas left, at the average shot size of the robot's rams. */
export function shotsLeft(r: Robot): number {
  const pneu = r.actuators.filter((a) => a.def.type === 'pneumatic');
  const per = pneu.length ? pneu.reduce((t, a) => t + a.gasPerShot, 0) / pneu.length : 1;
  return Math.floor(r.gasLeft / per);
}

/** A labelled bar: how much of something is left. */
export function gauge(label: string, fraction: number, text: string, opts: { warn?: number; colour?: string } = {}): HTMLElement {
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const low = f < (opts.warn ?? 0.2);
  return h('div', { class: `gauge${low ? ' low' : ''}` },
    h('span', { class: 'glabel' }, label),
    h('span', { class: 'gbar' }, h('span', { class: 'gfill', style: `width:${(f * 100).toFixed(1)}%${opts.colour && !low ? `;background:${opts.colour}` : ''}` })),
    h('span', { class: 'gtext' }, text));
}

function hull2d(pts: Array<[number, number]>): Array<[number, number]> {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [], upper: Array<[number, number]> = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function shrink(poly: Array<[number, number]>, k: number): Array<[number, number]> {
  const cx = poly.reduce((s, q) => s + q[0], 0) / poly.length, cz = poly.reduce((s, q) => s + q[1], 0) / poly.length;
  return poly.map(([x, z]) => [cx + (x - cx) * k, cz + (z - cz) * k]);
}
