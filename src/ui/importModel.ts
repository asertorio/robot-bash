/**
 * Read STL (binary or ASCII) and OBJ files into an indexed triangle mesh,
 * scaled to metres and centred on its bounding box.
 */

export interface ImportedMesh {
  vertices: number[];
  indices: number[];
  triangles: number;
  size: [number, number, number];
}

export async function importModel(file: File, unitScale: number): Promise<ImportedMesh> {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  let tri: number[];
  if (name.endsWith('.obj')) tri = parseOBJ(new TextDecoder().decode(buf));
  else if (name.endsWith('.stl')) tri = parseSTL(buf);
  else throw new Error('Use an .stl or .obj file.');
  if (tri.length < 9) throw new Error('No triangles found in that file.');
  return weld(tri, unitScale);
}

/** Flat triangle soup (9 numbers per triangle). */
function parseSTL(buf: ArrayBuffer): number[] {
  const view = new DataView(buf);
  if (buf.byteLength >= 84) {
    const n = view.getUint32(80, true);
    if (84 + n * 50 === buf.byteLength) {
      const out: number[] = [];
      for (let i = 0; i < n; i++) {
        const o = 84 + i * 50 + 12;
        for (let k = 0; k < 9; k++) out.push(view.getFloat32(o + k * 4, true));
      }
      return out;
    }
  }
  const text = new TextDecoder().decode(buf);
  const out: number[] = [];
  for (const m of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) out.push(Number(m[1]), Number(m[2]), Number(m[3]));
  return out.length % 9 === 0 ? out : out.slice(0, out.length - (out.length % 9));
}

function parseOBJ(text: string): number[] {
  const verts: number[][] = [];
  const out: number[] = [];
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'v') verts.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
    else if (parts[0] === 'f') {
      const idx = parts.slice(1).map((p) => {
        const i = parseInt(p.split('/')[0], 10);
        return i < 0 ? verts.length + i : i - 1;
      });
      // Fan-triangulate polygons.
      for (let k = 1; k + 1 < idx.length; k++) for (const i of [idx[0], idx[k], idx[k + 1]]) out.push(...(verts[i] ?? [0, 0, 0]));
    }
  }
  return out;
}

/** Merge duplicate vertices, scale to metres and centre on the bounding box. */
function weld(tri: number[], scale: number): ImportedMesh {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tri.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], tri[i + k]); max[k] = Math.max(max[k], tri[i + k]); }
  const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const map = new Map<string, number>();
  const vertices: number[] = [], indices: number[] = [];
  const eps = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * 1e-6 || 1e-9;
  for (let i = 0; i < tri.length; i += 3) {
    const x = (tri[i] - c[0]) * scale, y = (tri[i + 1] - c[1]) * scale, z = (tri[i + 2] - c[2]) * scale;
    const key = `${Math.round(x / (eps * scale))},${Math.round(y / (eps * scale))},${Math.round(z / (eps * scale))}`;
    let id = map.get(key);
    if (id === undefined) { id = vertices.length / 3; map.set(key, id); vertices.push(round(x), round(y), round(z)); }
    indices.push(id);
  }
  return {
    vertices, indices, triangles: indices.length / 3,
    size: [(max[0] - min[0]) * scale, (max[1] - min[1]) * scale, (max[2] - min[2]) * scale],
  };
}

const round = (v: number) => Math.round(v * 1e5) / 1e5;
