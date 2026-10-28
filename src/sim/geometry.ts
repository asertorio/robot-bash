import type { ShellPanel, Vec3 } from './design';

/** Corner points of a shell panel, relative to its centre. */
export function panelVertices(p: ShellPanel): Vec3[] {
  const [w, h, l] = p.size;
  const x = w / 2, y = h / 2, z = l / 2;
  if (p.shape === 'box') {
    const out: Vec3[] = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push([sx * x, sy * y, sz * z]);
    return out;
  }
  const lip = Math.min(p.lipHeight ?? 0, h);
  const out: Vec3[] = [
    [-x, -y, -z], [x, -y, -z], [-x, y, -z], [x, y, -z],
    [-x, -y, z], [x, -y, z],
  ];
  if (lip > 0.001) out.push([-x, -y + lip, z], [x, -y + lip, z]);
  return out;
}

/** Outer surface area, m². */
export function panelArea(p: ShellPanel): number {
  const [w, h, l] = p.size;
  if (p.shape === 'box') return 2 * (w * h + w * l + h * l);
  const lip = Math.min(p.lipHeight ?? 0, h);
  const slope = Math.hypot(l, h - lip);
  return w * l + w * h + w * slope + l * (h + lip) + w * lip;
}

/** The face area a hit on this panel spreads over (largest face), m². */
export function panelFaceArea(p: ShellPanel): number {
  const [w, h, l] = p.size;
  return Math.max(w * h, w * l, h * l);
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
