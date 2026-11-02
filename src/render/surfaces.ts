import * as THREE from 'three';
import { material as lookupMaterial } from '../data/materials';

/**
 * Surface finishes for robot parts: what each material really looks like in
 * the arena (brushed aluminium, mill-scale steel, matt HDPE, clear
 * polycarbonate…), paint over it, and how both wear as the robot takes hits.
 *
 * Textures are generated procedurally once and shared. Geometry UVs are in
 * half-metres (1 UV = 0.5 m), so one 512 px tile is about 1 mm per pixel.
 */

let cache: {
  scuff: THREE.Texture;
  brushed: THREE.Texture;
  wear: THREE.Texture;
  grain: THREE.Texture;
} | null = null;

function textures() {
  if (cache) return cache;
  cache = {
    scuff: dataTexture(512, scuffPixels),
    brushed: dataTexture(512, brushedPixels),
    wear: dataTexture(512, wearPixels),
    grain: woodTexture(),
  };
  return cache;
}

function dataTexture(size: number, fill: (data: Uint8Array, size: number, rnd: () => number) => void, srgb = false): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  let seed = 1337 + size;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  fill(data, size, rnd);
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Tileable value noise in [0, 1]. */
function noiseField(size: number, cells: number, rnd: () => number): Float32Array {
  const grid = new Float32Array(cells * cells).map(() => rnd());
  const out = new Float32Array(size * size);
  const g = (x: number, y: number) => grid[((y % cells) + cells) % cells * cells + (((x % cells) + cells) % cells)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = (x / size) * cells, fy = (y / size) * cells;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    let tx = fx - ix, ty = fy - iy;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const a = g(ix, iy) + (g(ix + 1, iy) - g(ix, iy)) * tx;
    const b = g(ix, iy + 1) + (g(ix + 1, iy + 1) - g(ix, iy + 1)) * tx;
    out[y * size + x] = a + (b - a) * ty;
  }
  return out;
}

function fbm(size: number, rnd: () => number, octaves: number[]): Float32Array {
  const out = new Float32Array(size * size);
  let total = 0;
  octaves.forEach((cells, i) => {
    const w = 1 / (i + 1);
    total += w;
    const n = noiseField(size, cells, rnd);
    for (let k = 0; k < out.length; k++) out[k] += n[k] * w;
  });
  for (let k = 0; k < out.length; k++) out[k] /= total;
  return out;
}

/** Draw a soft line into a float buffer (wrapping), taking the max. */
function stroke(buf: Float32Array, size: number, x0: number, y0: number, x1: number, y1: number, v: number, w = 1) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let i = 0; i <= n; i++) {
    const t = n ? i / n : 0;
    const cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t;
    for (let dy = -w; dy <= w; dy++) for (let dx = -w; dx <= w; dx++) {
      const fall = 1 - Math.hypot(dx, dy) / (w + 0.5);
      if (fall <= 0) continue;
      const px = ((Math.round(cx + dx) % size) + size) % size, py = ((Math.round(cy + dy) % size) + size) % size;
      const k = py * size + px;
      buf[k] = Math.max(buf[k], v * fall);
    }
  }
}

/** Roughness (G channel): smudges, handling marks and fine scratches. */
function scuffPixels(data: Uint8Array, size: number, rnd: () => number) {
  const n = fbm(size, rnd, [4, 9]);
  const fine = fbm(size, rnd, [41, 97]);
  const scr = new Float32Array(size * size);
  for (let i = 0; i < 260; i++) {
    const x = rnd() * size, y = rnd() * size, a = rnd() * Math.PI, l = 8 + rnd() * 60;
    stroke(scr, size, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.25 + rnd() * 0.35, 0);
  }
  for (let k = 0; k < size * size; k++) {
    const r = 0.42 + (n[k] - 0.5) * 0.18 + (fine[k] - 0.5) * 0.12 - scr[k] * 0.3;
    const v = Math.round(Math.min(1, Math.max(0.05, r)) * 255);
    data.set([v, v, v, 255], k * 4);
  }
}

/** Roughness for brushed/ground metal: long streaks in one direction. */
function brushedPixels(data: Uint8Array, size: number, rnd: () => number) {
  const n = fbm(size, rnd, [3, 7]);
  const rows = new Float32Array(size).map(() => rnd());
  const scr = new Float32Array(size * size);
  for (let i = 0; i < 120; i++) {
    const x = rnd() * size, y = rnd() * size, a = rnd() * Math.PI, l = 10 + rnd() * 40;
    stroke(scr, size, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.3 + rnd() * 0.3, 0);
  }
  for (let y = 0; y < size; y++) {
    // Streaks: a slowly varying per-row value plus fine per-row grain.
    const row = rows[y] * 0.6 + rows[(y + 1) % size] * 0.4;
    for (let x = 0; x < size; x++) {
      const k = y * size + x;
      const r = 0.36 + (row - 0.5) * 0.22 + (n[k] - 0.5) * 0.25 + scr[k] * 0.25;
      const v = Math.round(Math.min(1, Math.max(0.05, r)) * 255);
      data.set([v, v, v, 255], k * 4);
    }
  }
}

/**
 * Wear mask. R: where paint chips and scratches through first (high values
 * go first). G: blotchy pattern for scorch marks.
 */
function wearPixels(data: Uint8Array, size: number, rnd: () => number) {
  const base = fbm(size, rnd, [5, 13, 37]);
  const blot = fbm(size, rnd, [3, 6, 15]);
  const scr = new Float32Array(size * size);
  // Gouges and scrapes.
  for (let i = 0; i < 140; i++) {
    const x = rnd() * size, y = rnd() * size, a = rnd() * Math.PI * 2, l = 10 + rnd() * 90;
    const bend = (rnd() - 0.5) * 0.6;
    let px = x, py = y, ang = a;
    const v = 0.78 + rnd() * 0.22;
    for (let s = 0; s < 4; s++) {
      const nx = px + Math.cos(ang) * l / 4, ny = py + Math.sin(ang) * l / 4;
      stroke(scr, size, px, py, nx, ny, v, rnd() < 0.2 ? 1 : 0);
      px = nx; py = ny; ang += bend;
    }
  }
  // Chips.
  for (let i = 0; i < 90; i++) {
    const cx = rnd() * size, cy = rnd() * size, r = 1.5 + rnd() * 6, v = 0.7 + rnd() * 0.3;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.hypot(dx * (0.7 + rnd() * 0.6), dy) > r) continue;
      const px = ((Math.round(cx + dx) % size) + size) % size, py = ((Math.round(cy + dy) % size) + size) % size;
      const k = py * size + px;
      scr[k] = Math.max(scr[k], v);
    }
  }
  for (let k = 0; k < size * size; k++) {
    const r = Math.max(scr[k], base[k] * 0.72);
    data.set([Math.round(r * 255), Math.round(blot[k] * 255), 0, 255], k * 4);
  }
}

function woodTexture(): THREE.Texture {
  return dataTexture(512, (data, size, rnd) => {
    const n = fbm(size, rnd, [4, 11]);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const k = y * size + x;
      const ring = Math.sin((y / size) * 60 + n[k] * 12) * 0.5 + 0.5;
      const t = 0.75 + ring * 0.2 + (n[k] - 0.5) * 0.15;
      data.set([Math.round(200 * t), Math.round(158 * t), Math.round(98 * t), 255], k * 4);
    }
  }, true);
}

// ---------------------------------------------------------------- materials

export interface Finish {
  colour: number;
  metalness: number;
  roughness: number;
  /** Which roughness texture: ground/brushed metal or general scuffs. */
  rough: 'brushed' | 'scuff';
  /** Colour revealed where it wears through. */
  bare: number;
  wood?: boolean;
  clear?: boolean;
}

/** How each catalogue material looks unpainted. */
export function bareFinish(materialId: string | undefined): Finish {
  switch (materialId ?? 'aluminium') {
    case 'aluminium': return { colour: 0xc6cacf, metalness: 1, roughness: 0.34, rough: 'brushed', bare: 0xe2e5e8 };
    case 'mildSteel': return { colour: 0x6c7074, metalness: 0.9, roughness: 0.55, rough: 'scuff', bare: 0xa4a8ac };
    case 'hardox': return { colour: 0x50545a, metalness: 0.9, roughness: 0.48, rough: 'brushed', bare: 0x9da2a8 };
    case 'titanium': return { colour: 0x9b958b, metalness: 1, roughness: 0.4, rough: 'brushed', bare: 0xc8c2b6 };
    case 'hdpe': return { colour: 0xe6e5dd, metalness: 0, roughness: 0.72, rough: 'scuff', bare: 0xf4f3ec };
    case 'polycarbonate': return { colour: 0xd8e8ee, metalness: 0, roughness: 0.08, rough: 'scuff', bare: 0xffffff, clear: true };
    case 'rubber': return { colour: 0x1b1b1b, metalness: 0, roughness: 0.92, rough: 'scuff', bare: 0x2a2a2a };
    case 'ptfe': return { colour: 0xefeee8, metalness: 0, roughness: 0.55, rough: 'scuff', bare: 0xffffff };
    case 'plywood': return { colour: 0xffffff, metalness: 0, roughness: 0.8, rough: 'scuff', bare: 0xd9b27a, wood: true };
    default: {
      let m: ReturnType<typeof lookupMaterial> | null = null;
      try { m = lookupMaterial(materialId!); } catch { /* unknown: treat as aluminium */ }
      const metal = (m?.density ?? 2700) > 2000;
      return { colour: m?.colour ?? 0xb8bcc2, metalness: metal ? 0.9 : 0, roughness: 0.45, rough: 'scuff', bare: 0xd0d4d8 };
    }
  }
}

export interface WearUniforms {
  wear: { value: number };
  scorch: { value: number };
}

/**
 * A part material. `paint` (if given) is sprayed over the material; damage
 * then chips it back to the bare material and scorches it.
 */
export function partMaterial(materialId: string | undefined, paint: number | null): THREE.MeshPhysicalMaterial {
  const tex = textures();
  const bare = bareFinish(materialId);
  const metalUnder = bare.metalness > 0.5;
  const f: Finish = paint === null ? bare : {
    colour: paint,
    // Paint is a dielectric skin; a little clearcoat gives it the sheen of fresh enamel.
    metalness: 0,
    roughness: bare.clear ? 0.08 : 0.5,
    rough: 'scuff',
    bare: metalUnder ? bare.colour : bare.bare,
    clear: bare.clear,
  };
  const mat = new THREE.MeshPhysicalMaterial({
    color: f.colour,
    metalness: f.metalness,
    roughness: Math.min(1, f.roughness * 2.2),
    roughnessMap: f.rough === 'brushed' ? tex.brushed : tex.scuff,
    map: f.wood ? tex.grain : null,
    clearcoat: paint !== null && !f.clear ? 0.12 : 0,
    clearcoatRoughness: 0.35,
  });
  if (f.clear) {
    mat.transparent = true;
    mat.opacity = 0.32;
    mat.depthWrite = false;
    mat.side = THREE.DoubleSide;
    mat.clearcoat = 1;
    mat.clearcoatRoughness = 0.05;
    mat.roughness = 0.05;
    mat.roughnessMap = null;
    if (paint !== null) mat.color.set(paint).lerp(new THREE.Color(0xffffff), 0.45);
  }
  addWear(mat, bare.clear ? 0xffffff : f.bare, metalUnder && paint !== null);
  return mat;
}

/** Plain material for hardware (fasteners, motors, tyres) — with the wear hook so damage still shows. */
export function hardware(colour: number, metalness: number, roughness: number, opts: { rough?: 'brushed' | 'scuff'; clearcoat?: number } = {}): THREE.MeshPhysicalMaterial {
  const tex = textures();
  const mat = new THREE.MeshPhysicalMaterial({
    color: colour, metalness, roughness: Math.min(1, roughness * 2.2),
    roughnessMap: opts.rough === 'brushed' ? tex.brushed : tex.scuff,
    clearcoat: opts.clearcoat ?? 0, clearcoatRoughness: 0.3,
  });
  addWear(mat, colour, false);
  return mat;
}

function addWear(mat: THREE.MeshPhysicalMaterial, bare: number, bareIsMetal: boolean) {
  const u: WearUniforms = { wear: { value: 0.03 }, scorch: { value: 0 } };
  mat.userData.wear = u;
  const wearMap = textures().wear;
  const bareCol = new THREE.Color(bare);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWear = u.wear;
    sh.uniforms.uScorch = u.scorch;
    sh.uniforms.uWearMap = { value: wearMap };
    sh.uniforms.uBare = { value: bareCol };
    sh.uniforms.uBareMetal = { value: bareIsMetal ? 1 : 0 };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWear;\nuniform float uScorch;\nuniform float uBareMetal;\nuniform vec3 uBare;\nuniform sampler2D uWearMap;')
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
#ifdef USE_ROUGHNESSMAP
        vec4 wearTexel = texture2D( uWearMap, vRoughnessMapUv * 0.73 );
#else
        vec4 wearTexel = vec4( 0.0, 0.5, 0.0, 1.0 );
#endif
        float chip = smoothstep( 1.0 - uWear, 1.0 - uWear + 0.035, wearTexel.r );
        diffuseColor.rgb = mix( diffuseColor.rgb, uBare, chip );
        metalnessFactor = mix( metalnessFactor, max( metalnessFactor, uBareMetal ), chip );
        roughnessFactor = mix( roughnessFactor, 0.55, chip * uBareMetal );
        float burn = uScorch * smoothstep( 0.25, 0.75, wearTexel.g );
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.045, 0.038, 0.032 ), burn * 0.9 );
        roughnessFactor = mix( roughnessFactor, 0.95, burn );
        metalnessFactor = mix( metalnessFactor, 0.0, burn );`);
  };
  mat.customProgramCacheKey = () => 'robot-wear';
}

/** Set a material's wear (0 = factory fresh, 1 = wrecked) and scorch. */
export function setWear(mat: THREE.Material, wear: number, scorch: number) {
  const u = mat.userData.wear as WearUniforms | undefined;
  if (!u) return;
  u.wear.value = wear;
  u.scorch.value = scorch;
}

/** Text drawn on a transparent canvas: robot names, labels on batteries. */
export function textTexture(text: string, opts: { colour: string; font?: string; width?: number; height?: number; background?: string; sub?: string }): THREE.CanvasTexture {
  const w = opts.width ?? 1024, h = opts.height ?? 256;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  if (opts.background) { g.fillStyle = opts.background; g.fillRect(0, 0, w, h); }
  g.fillStyle = opts.colour;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = h * (opts.sub ? 0.5 : 0.78);
  const family = opts.font ?? '"Oswald", Impact, "Arial Narrow", sans-serif';
  do { g.font = `700 ${size}px ${family}`; size *= 0.92; } while (g.measureText(text).width > w * 0.92 && size > 8);
  g.fillText(text, w / 2, opts.sub ? h * 0.38 : h / 2);
  if (opts.sub) {
    g.font = `600 ${h * 0.22}px ${family}`;
    g.fillText(opts.sub, w / 2, h * 0.78);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
