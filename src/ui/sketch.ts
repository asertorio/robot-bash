import { convexPolygons, polygonArea } from '../sim/shapes';
import { h } from './dom';

type Pt = [number, number];

export interface SketchOptions {
  /** 'outline' is a closed polygon; 'profile' is an open line of [radius, height] for lathes. */
  mode: 'outline' | 'profile';
  /** Axis names for the hint text, e.g. ['left', 'forward']. */
  axes: [string, string];
  onChange: (pts: Pt[]) => void;
}

const SIZE = 300;
const GRID = 0.005; // 5 mm snap

/**
 * A little 2D drawing board: drag points, click an edge to add a point
 * there, right-click (or double-click) a point to delete it. Points are in
 * metres. Hold Alt while dragging to turn off the 5 mm snap.
 */
export function sketchEditor(initial: Pt[], o: SketchOptions): HTMLElement {
  let pts: Pt[] = initial.map((p) => [p[0], p[1]]);
  const canvas = h('canvas', { width: SIZE * 2, height: SIZE * 2, class: 'sketch' });
  const g = canvas.getContext('2d')!;
  const info = h('div', { class: 'hint' });
  let view = fit(pts, o.mode);
  let drag = -1;

  const toScreen = ([u, v]: Pt): Pt => [(u - view.cx) * view.k + SIZE, SIZE - (v - view.cy) * view.k];
  const toWorld = (x: number, y: number): Pt => [(x - SIZE) / view.k + view.cx, (SIZE - y) / view.k + view.cy];
  const local = (e: MouseEvent): Pt => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * SIZE * 2, ((e.clientY - r.top) / r.height) * SIZE * 2];
  };
  const snap = (p: Pt, free: boolean): Pt => (free ? p : [Math.round(p[0] / GRID) * GRID, Math.round(p[1] / GRID) * GRID]);
  const nearest = (x: number, y: number) => pts.findIndex((p) => { const s = toScreen(p); return Math.hypot(s[0] - x, s[1] - y) < 14; });

  const draw = () => {
    g.clearRect(0, 0, SIZE * 2, SIZE * 2);
    // Grid every 10 mm, bolder every 100 mm.
    const step = view.k * 0.01 < 6 ? 0.05 : 0.01;
    const [w0, h1] = toWorld(0, 0), [w1, h0] = toWorld(SIZE * 2, SIZE * 2);
    for (let u = Math.floor(w0 / step) * step; u <= w1; u += step) {
      const [x] = toScreen([u, 0]);
      g.strokeStyle = Math.abs(u / 0.1 - Math.round(u / 0.1)) < 1e-6 ? '#3a3f4a' : '#23262d';
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, SIZE * 2); g.stroke();
    }
    for (let v = Math.floor(h0 / step) * step; v <= h1; v += step) {
      const [, y] = toScreen([0, v]);
      g.strokeStyle = Math.abs(v / 0.1 - Math.round(v / 0.1)) < 1e-6 ? '#3a3f4a' : '#23262d';
      g.beginPath(); g.moveTo(0, y); g.lineTo(SIZE * 2, y); g.stroke();
    }
    // Axes through the origin (the lathe's spin axis is u = 0).
    g.strokeStyle = o.mode === 'profile' ? '#f2c200' : '#59606e';
    g.lineWidth = 2;
    const [ox, oy] = toScreen([0, 0]);
    g.beginPath(); g.moveTo(ox, 0); g.lineTo(ox, SIZE * 2); g.moveTo(0, oy); g.lineTo(SIZE * 2, oy); g.stroke();
    g.lineWidth = 1;

    if (o.mode === 'outline' && pts.length >= 3) {
      // Fill with the convex pieces the physics will use.
      const pieces = convexPolygons(pts);
      pieces.forEach((poly, i) => {
        g.fillStyle = `hsla(${(i * 47) % 360}, 60%, 55%, 0.28)`;
        g.beginPath();
        poly.forEach((p, k) => { const [x, y] = toScreen(p); if (k) g.lineTo(x, y); else g.moveTo(x, y); });
        g.closePath(); g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.15)'; g.stroke();
      });
      const area = pieces.reduce((s, poly) => s + Math.abs(polygonArea(poly)), 0);
      const ok = Math.abs(area - Math.abs(polygonArea(pts))) < 1e-6 * Math.max(1, area * 1e6);
      info.textContent = ok
        ? `${pts.length} points · ${pieces.length} convex piece${pieces.length > 1 ? 's' : ''} · ${(Math.abs(polygonArea(pts)) * 1e6).toFixed(0)} mm²`
        : 'The outline crosses itself — untangle it so it splits cleanly.';
      info.className = ok ? 'hint' : 'err';
    } else if (o.mode === 'profile') {
      info.textContent = `${pts.length} points · drawn as radius (→) and height (↑); it's spun around the yellow axis.`;
    }
    // The outline itself.
    g.strokeStyle = '#f2c200';
    g.lineWidth = 2.5;
    g.beginPath();
    pts.forEach((p, k) => { const [x, y] = toScreen(p); if (k) g.lineTo(x, y); else g.moveTo(x, y); });
    if (o.mode === 'outline') g.closePath();
    g.stroke();
    g.lineWidth = 1;
    for (const p of pts) {
      const [x, y] = toScreen(p);
      g.fillStyle = '#111'; g.strokeStyle = '#f2c200';
      g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); g.stroke();
    }
  };

  const commit = () => { draw(); o.onChange(pts.map((p) => [p[0], p[1]])); };

  canvas.addEventListener('pointerdown', (e) => {
    const [x, y] = local(e);
    if (e.button === 2) return;
    const i = nearest(x, y);
    if (i >= 0) { drag = i; canvas.setPointerCapture(e.pointerId); return; }
    // Insert a new point on the closest edge.
    const p = snap(toWorld(x, y), e.altKey);
    let best = -1, bestD = Infinity;
    const edges = o.mode === 'outline' ? pts.length : pts.length - 1;
    for (let k = 0; k < edges; k++) {
      const d = segDist(toScreen(pts[k]), toScreen(pts[(k + 1) % pts.length]), [x, y]);
      if (d < bestD) { bestD = d; best = k; }
    }
    if (o.mode === 'profile') p[0] = Math.max(0, p[0]);
    if (best < 0 || (o.mode === 'profile' && bestD > 40)) pts.push(p); else pts.splice(best + 1, 0, p);
    drag = best < 0 ? pts.length - 1 : best + 1;
    canvas.setPointerCapture(e.pointerId);
    commit();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag < 0) return;
    const [x, y] = local(e);
    const p = snap(toWorld(x, y), e.altKey);
    if (o.mode === 'profile') p[0] = Math.max(0, p[0]);
    pts[drag] = p;
    draw();
  });
  canvas.addEventListener('pointerup', () => { if (drag >= 0) { drag = -1; commit(); } });
  const remove = (e: MouseEvent) => {
    e.preventDefault();
    const [x, y] = local(e);
    const i = nearest(x, y);
    if (i >= 0 && pts.length > (o.mode === 'outline' ? 3 : 2)) { pts.splice(i, 1); commit(); }
  };
  canvas.addEventListener('contextmenu', remove);
  canvas.addEventListener('dblclick', remove);

  const text = h('textarea', { class: 'json', rows: 2 }, JSON.stringify(pts.map(([u, v]) => [mm(u), mm(v)])));
  const err = h('div', { class: 'err' });
  text.addEventListener('change', () => {
    try {
      const raw = JSON.parse(text.value) as Pt[];
      if (!Array.isArray(raw) || raw.length < (o.mode === 'outline' ? 3 : 2) || raw.some((q) => !Array.isArray(q) || q.length !== 2 || q.some((n) => typeof n !== 'number'))) throw new Error('Need a list of [a, b] pairs in mm.');
      pts = raw.map(([u, v]) => [u / 1000, v / 1000]);
      err.textContent = '';
      view = fit(pts, o.mode);
      commit();
    } catch (x) { err.textContent = (x as Error).message; }
  });
  const syncText = () => { text.value = JSON.stringify(pts.map(([u, v]) => [mm(u), mm(v)])); };
  canvas.addEventListener('pointerup', syncText);
  canvas.addEventListener('contextmenu', syncText);

  draw();
  return h('div', { class: 'sketch-box' },
    canvas,
    info,
    h('div', { class: 'hint' }, `Drag points · click an edge to add one · right-click to delete · Alt = no snap. Axes: → ${o.axes[0]}, ↑ ${o.axes[1]}.`),
    h('div', { class: 'gactions' }, h('button', { class: 'small', onclick: () => { view = fit(pts, o.mode); draw(); } }, 'Fit view')),
    h('div', { class: 'hint' }, 'Exact points (mm):'), text, err);
}

const mm = (m: number) => Math.round(m * 10000) / 10;

function fit(pts: Pt[], mode: 'outline' | 'profile') {
  const us = pts.map((p) => p[0]).concat(mode === 'profile' ? [0] : []), vs = pts.map((p) => p[1]);
  const umin = Math.min(...us), umax = Math.max(...us), vmin = Math.min(...vs), vmax = Math.max(...vs);
  const span = Math.max(umax - umin, vmax - vmin, 0.05) * 1.35;
  return { cx: (umin + umax) / 2, cy: (vmin + vmax) / 2, k: (SIZE * 2) / span };
}

function segDist(a: Pt, b: Pt, p: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
}

// ---------------------------------------------------------------- presets

export const OUTLINE_PRESETS: Record<string, Pt[]> = {
  Rectangle: [[-0.2, -0.15], [0.2, -0.15], [0.2, 0.15], [-0.2, 0.15]],
  'L-bracket': [[-0.15, -0.15], [0.15, -0.15], [0.15, -0.08], [-0.08, -0.08], [-0.08, 0.15], [-0.15, 0.15]],
  'U-scoop': [[-0.25, -0.2], [0.25, -0.2], [0.25, 0.2], [0.17, 0.2], [0.17, -0.12], [-0.17, -0.12], [-0.17, 0.2], [-0.25, 0.2]],
  Claw: [[-0.04, -0.2], [0.04, -0.2], [0.05, 0.02], [0.14, 0.12], [0.1, 0.2], [0.0, 0.08], [-0.05, 0.05]],
  'Saw blade': sawBlade(0.25, 0.2, 12),
  'Spinner bar (two teeth)': [[-0.3, -0.03], [0.26, -0.03], [0.32, -0.07], [0.3, 0.03], [-0.26, 0.03], [-0.32, 0.07]],
  Star: star(0.2, 0.09, 5),
};

export const PROFILE_PRESETS: Record<string, Pt[]> = {
  Drum: [[0, -0.12], [0.1, -0.12], [0.1, 0.12], [0, 0.12]],
  Dome: [[0, 0], [0.3, 0], [0.28, 0.08], [0.22, 0.15], [0.12, 0.2], [0, 0.22]],
  'Disc with rim': [[0, -0.01], [0.28, -0.01], [0.3, -0.03], [0.32, -0.03], [0.32, 0.03], [0.3, 0.03], [0.28, 0.01], [0, 0.01]],
  Bell: [[0, 0.2], [0.06, 0.19], [0.1, 0.12], [0.14, 0.03], [0.22, -0.05], [0, -0.05]],
  'Spinning cone': [[0, 0.25], [0.25, -0.05], [0, -0.05]],
};

function sawBlade(r: number, inner: number, teeth: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * 2 * Math.PI, b = ((i + 0.7) / teeth) * 2 * Math.PI;
    out.push([Math.cos(a) * inner, Math.sin(a) * inner], [Math.cos(b) * r, Math.sin(b) * r]);
  }
  return out;
}

function star(r: number, inner: number, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * 2 * Math.PI + Math.PI / 2, rr = i % 2 ? inner : r;
    out.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  return out;
}
