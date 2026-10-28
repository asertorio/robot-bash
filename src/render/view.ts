import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { ARENA, arenaBoxes } from '../sim/arena';
import type { Match } from '../sim/match';
import type { Part, Robot } from '../sim/robot';

/** Three.js mirror of a Match. Reads simulation state; never writes it. */
export class MatchView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  private match: Match | null = null;
  private partMeshes: Array<{ part: Part; mesh: THREE.Object3D; base: THREE.Color; mats: THREE.MeshStandardMaterial[] }> = [];
  private blurDiscs: Array<{ robot: Robot; index: number; mesh: THREE.Mesh }> = [];
  private robotGroup = new THREE.Group();
  private trapdoor!: THREE.Mesh;
  private camTarget = new THREE.Vector3(0, 0, 0);
  private camPos = new THREE.Vector3(0, 12, 14);
  /** 'tv' frames the fight; 'follow' orbits one robot (garage test bay). */
  cameraMode: 'tv' | 'follow' = 'tv';
  followIndex = 0;
  private orbit = { yaw: 0.6, pitch: 0.55, dist: 3.2 };
  private sparks: THREE.Points;
  private sparkData: Array<{ p: THREE.Vector3; v: THREE.Vector3; life: number }> = [];
  private sparkPositions = new Float32Array(600 * 3);
  private sparkColours = new Float32Array(600 * 3);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.scene.background = new THREE.Color(0x07080b);
    this.scene.fog = new THREE.Fog(0x07080b, 22, 45);
    this.buildLights();
    this.buildArena();
    this.scene.add(this.robotGroup);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.sparkPositions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.sparkColours, 3));
    this.sparks = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.06, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.sparks.frustumCulled = false;
    this.scene.add(this.sparks);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindOrbit(canvas);
  }

  /** Drag to orbit and wheel to zoom, in follow mode. */
  private bindOrbit(canvas: HTMLCanvasElement) {
    let drag: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      // Clicking the arena hands the keyboard back to the robots.
      (document.activeElement as HTMLElement | null)?.blur?.(); if (this.cameraMode === 'follow') { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); } });
    canvas.addEventListener('pointerup', () => (drag = null));
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.orbit.yaw -= (e.clientX - drag.x) * 0.008;
      this.orbit.pitch = Math.min(1.4, Math.max(0.08, this.orbit.pitch + (e.clientY - drag.y) * 0.006));
      drag = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('wheel', (e) => {
      if (this.cameraMode !== 'follow') return;
      e.preventDefault();
      this.orbit.dist = Math.min(12, Math.max(1.2, this.orbit.dist * (1 + Math.sign(e.deltaY) * 0.1)));
    }, { passive: false });
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the whole arena in shot on narrow (portrait) screens.
    this.camera.fov = w / h < 1 ? 60 : 42;
    this.camera.updateProjectionMatrix();
  }

  private buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xb8c8e0, 0x2a2420, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(-6, 14, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const s = key.shadow.camera;
    s.left = -10; s.right = 10; s.top = 10; s.bottom = -10; s.near = 1; s.far = 40;
    key.shadow.bias = -0.0005;
    this.scene.add(key);
    // Coloured stage lights for the TV look.
    for (const [x, z, c] of [[-9, -9, 0xff5522], [9, 9, 0x3366ff], [9, -9, 0xffaa22], [-9, 9, 0xaa33ff]] as const) {
      const l = new THREE.PointLight(c, 70, 24, 1.5);
      l.position.set(x, 6, z);
      this.scene.add(l);
    }
  }

  private buildArena() {
    const floorTex = makeFloorTexture();
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    const mats = {
      floor: new THREE.MeshStandardMaterial({ map: floorTex, metalness: 0.6, roughness: 0.55 }),
      outerFloor: new THREE.MeshStandardMaterial({ color: 0x15171b, metalness: 0.2, roughness: 0.9 }),
      wall: new THREE.MeshStandardMaterial({ map: makeStripeTexture(), metalness: 0.4, roughness: 0.5 }),
      pitWall: new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 1 }),
      pitFloor: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1 }),
      barrier: new THREE.MeshStandardMaterial({ color: 0x9cc4e4, transparent: true, opacity: 0.07, roughness: 0.1, depthWrite: false }),
    };
    for (const b of arenaBoxes()) {
      const geo = new THREE.BoxGeometry(b.half.x * 2, b.half.y * 2, b.half.z * 2);
      if (b.kind === 'floor') {
        // Texture in world units so the floor panels line up across slabs.
        const uv = geo.attributes.uv as THREE.BufferAttribute;
        const pos = geo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + b.centre.x) / 2, (pos.getZ(i) + b.centre.z) / 2);
      }
      const mesh = new THREE.Mesh(geo, mats[b.kind]);
      mesh.position.set(b.centre.x, b.centre.y, b.centre.z);
      mesh.receiveShadow = b.kind !== 'barrier';
      mesh.castShadow = b.kind === 'wall';
      this.scene.add(mesh);
    }
    // Barrier posts.
    const postMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.7, roughness: 0.4 });
    for (let i = -ARENA.outerHalf; i <= ARENA.outerHalf; i += 3) {
      for (const [x, z] of [[i, ARENA.outerHalf], [i, -ARENA.outerHalf], [ARENA.outerHalf, i], [-ARENA.outerHalf, i]]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 5, 0.12), postMat);
        post.position.set(x, 2.5, z);
        this.scene.add(post);
      }
    }

    const { pit, pitButton, cpz, half } = ARENA;
    this.trapdoor = new THREE.Mesh(new THREE.BoxGeometry(pit.half * 2 - 0.02, 0.2, pit.half * 2 - 0.02), new THREE.MeshStandardMaterial({ color: 0x2b2b2b, metalness: 0.5, roughness: 0.6 }));
    this.trapdoor.receiveShadow = true;
    this.scene.add(this.trapdoor);
    // Hazard border round the pit.
    const hazard = new THREE.MeshStandardMaterial({ map: makeStripeTexture(), roughness: 0.6 });
    for (const [dx, dz, w, d] of [[0, pit.half + 0.06, pit.half * 2 + 0.24, 0.12], [0, -pit.half - 0.06, pit.half * 2 + 0.24, 0.12], [pit.half + 0.06, 0, 0.12, pit.half * 2], [-pit.half - 0.06, 0, 0.12, pit.half * 2]] as const) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), hazard);
      m.rotation.x = -Math.PI / 2;
      m.position.set(pit.x + dx, 0.002, pit.z + dz);
      this.scene.add(m);
    }
    const button = new THREE.Mesh(new THREE.CylinderGeometry(pitButton.half, pitButton.half, 0.03, 32), new THREE.MeshStandardMaterial({ color: 0xd01010, emissive: 0x500000, roughness: 0.4 }));
    button.position.set(pitButton.x, 0.015, pitButton.z);
    this.scene.add(button);
    const ring = new THREE.Mesh(new THREE.RingGeometry(pitButton.half + 0.02, pitButton.half + 0.12, 32), new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.6 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pitButton.x, 0.003, pitButton.z);
    this.scene.add(ring);
    // Corner patrol zones.
    const cpzMat = new THREE.MeshStandardMaterial({ map: makeCpzTexture(), transparent: true, roughness: 0.7, depthWrite: false });
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(cpz, cpz), cpzMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(sx * (half - cpz / 2), 0.003, sz * (half - cpz / 2));
      this.scene.add(m);
    }
  }

  setMatch(match: Match) {
    this.match = match;
    this.robotGroup.clear();
    this.partMeshes = [];
    this.blurDiscs = [];
    this.sparkData = [];
    for (const r of match.robots) {
      for (const part of r.parts) {
        if (!part.visual) continue;
        const { mesh, mats } = buildPartMesh(part);
        this.robotGroup.add(mesh);
        this.partMeshes.push({ part, mesh, base: new THREE.Color(part.colour ?? 0x888888), mats });
      }
      r.spinners.forEach((s, index) => {
        const radius = s.def.blade.shape === 'disc' ? s.def.blade.length / 2 : s.def.blade.length / 2;
        const disc = new THREE.Mesh(
          new THREE.CircleGeometry(radius, 48),
          new THREE.MeshBasicMaterial({ color: 0xd8dde3, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
        );
        this.robotGroup.add(disc);
        this.blurDiscs.push({ robot: r, index, mesh: disc });
      });
    }
    this.camTarget.set(0, 0, 0);
    this.camPos.set(0, 12, 14);
  }

  render(dt: number) {
    const m = this.match;
    if (m) {
      this.syncParts();
      this.syncSparks(m, dt);
      const t = m.arena.trapdoor.translation();
      this.trapdoor.position.set(t.x, t.y, t.z);
      this.updateCamera(m, dt);
    }
    this.renderer.render(this.scene, this.camera);
  }

  private syncParts() {
    const scorch = new THREE.Color(0x221d18);
    for (const { part, mesh, base, mats } of this.partMeshes) {
      const c = part.collider;
      if (!c) { mesh.visible = false; continue; }
      mesh.visible = true;
      const p = c.translation(), q = c.rotation();
      mesh.position.set(p.x, p.y, p.z);
      mesh.quaternion.set(q.x, q.y, q.z, q.w);
      // Battle damage shows as scorching, not as a bar.
      if (part.kind === 'panel' || part.kind === 'flipper') {
        mats[0].color.copy(base).lerp(scorch, (1 - Math.max(0, part.condition)) * 0.75);
      }
    }
    for (const { robot, index, mesh } of this.blurDiscs) {
      const s = robot.spinners[index];
      const rpm = robot.spinnerRpm()[index];
      if (!s.joint) { mesh.visible = false; continue; }
      const p = s.body.translation(), q = s.body.rotation();
      mesh.position.set(p.x, p.y, p.z);
      mesh.quaternion.set(q.x, q.y, q.z, q.w);
      // Circle geometry faces +Z; turn it to face along the spin axis.
      const axis = s.def.orientation === 'horizontal' ? new THREE.Euler(-Math.PI / 2, 0, 0) : new THREE.Euler(0, Math.PI / 2, 0);
      mesh.quaternion.multiply(new THREE.Quaternion().setFromEuler(axis));
      (mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(0.35, rpm / 3000);
    }
  }

  private syncSparks(m: Match, dt: number) {
    for (const hit of m.impacts) {
      const n = Math.min(40, Math.floor(hit.energy / 60));
      for (let i = 0; i < n && this.sparkData.length < 600; i++) {
        const speed = 2 + Math.random() * Math.min(8, hit.energy / 300);
        const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.2, Math.random() - 0.5).normalize();
        this.sparkData.push({ p: new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z), v: dir.multiplyScalar(speed), life: 0.3 + Math.random() * 0.5 });
      }
    }
    m.impacts.length = 0;
    this.sparkData = this.sparkData.filter((s) => (s.life -= dt) > 0);
    this.sparkData.forEach((s, i) => {
      s.v.y -= 9.81 * dt;
      s.p.addScaledVector(s.v, dt);
      this.sparkPositions.set([s.p.x, s.p.y, s.p.z], i * 3);
      const k = Math.min(1, s.life * 2);
      this.sparkColours.set([1, 0.6 * k + 0.2, 0.15 * k], i * 3);
    });
    const g = this.sparks.geometry;
    g.setDrawRange(0, this.sparkData.length);
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }

  /** TV-style camera: high and to one side, drifting to keep both robots in frame. */
  private updateCamera(m: Match, dt: number) {
    const k = 1 - Math.exp(-dt * 4);
    if (this.cameraMode === 'follow') {
      const r = m.robots[this.followIndex];
      if (r) {
        const p = r.position;
        const target = new THREE.Vector3(p.x, Math.max(0, p.y) + 0.15, p.z);
        const o = this.orbit;
        const want = target.clone().add(new THREE.Vector3(Math.sin(o.yaw) * Math.cos(o.pitch), Math.sin(o.pitch), Math.cos(o.yaw) * Math.cos(o.pitch)).multiplyScalar(o.dist));
        this.camTarget.lerp(target, k);
        this.camPos.lerp(want, k);
        this.camera.position.copy(this.camPos);
        this.camera.lookAt(this.camTarget);
      }
      return;
    }
    this.tvCamera(m, dt);
  }

  private tvCamera(m: Match, dt: number) {
    const live = m.robots.filter((_, i) => !m.eliminated[i]);
    const focus = live.length ? live : m.robots;
    const mid = new THREE.Vector3();
    let spread = 0;
    for (const r of focus) mid.add(new THREE.Vector3(r.position.x, 0, r.position.z));
    mid.divideScalar(focus.length);
    for (const r of focus) spread = Math.max(spread, mid.distanceTo(new THREE.Vector3(r.position.x, 0, r.position.z)));
    mid.multiplyScalar(0.55); // stay biased towards the arena centre
    const dist = 4.5 + spread * 1.2;
    const want = new THREE.Vector3(mid.x * 0.6, dist * 0.9 + 1.5, mid.z + dist * 1.0);
    const k = 1 - Math.exp(-dt * 2.5);
    this.camTarget.lerp(mid, k);
    this.camPos.lerp(want, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  /** Screen position of a robot (for name tags), or null if behind camera. */
  screenPos(r: Robot): { x: number; y: number } | null {
    const p = r.position;
    const v = new THREE.Vector3(p.x, p.y + 0.55, p.z).project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }
}

function buildPartMesh(part: Part): { mesh: THREE.Object3D; mats: THREE.MeshStandardMaterial[] } {
  const v = part.visual!;
  const colour = part.colour ?? 0x888888;
  const mat = new THREE.MeshStandardMaterial({ color: colour, metalness: 0.45, roughness: 0.45 });
  let geo: THREE.BufferGeometry;
  if (v.type === 'hull') geo = new ConvexGeometry(v.points.map((p) => new THREE.Vector3(...p)));
  else if (v.type === 'box') geo = new THREE.BoxGeometry(v.half[0] * 2, v.half[1] * 2, v.half[2] * 2);
  else geo = new THREE.CylinderGeometry(v.radius, v.radius, v.halfHeight * 2, 28);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  // Crisp edges read better at TV distance.
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 }));
  group.add(edges);
  if (part.kind === 'wheel' && v.type === 'cylinder') {
    // Hub, so you can see the wheel turning.
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(v.radius * 0.45, v.radius * 0.45, v.halfHeight * 2 + 0.006, 6), new THREE.MeshStandardMaterial({ color: 0x9a9fa6, metalness: 0.8, roughness: 0.3 }));
    group.add(hub);
  }
  return { mesh: group, mats: [mat] };
}

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function makeFloorTexture(): THREE.CanvasTexture {
  // One 2 m × 2 m steel floor plate with tread pattern and seams.
  return canvasTexture(512, (g) => {
    g.fillStyle = '#4a4e55';
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.05})`;
      g.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 6, 1);
    }
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 3;
    for (let y = 16; y < 512; y += 32) for (let x = (y / 32) % 2 ? 0 : 16; x < 512; x += 32) {
      g.beginPath(); g.moveTo(x, y + 4); g.lineTo(x + 10, y - 4); g.stroke();
    }
    g.strokeStyle = '#1b1c1f';
    g.lineWidth = 6;
    g.strokeRect(0, 0, 512, 512);
    g.fillStyle = '#25272a';
    for (const [x, y] of [[14, 14], [498, 14], [14, 498], [498, 498], [256, 14], [256, 498], [14, 256], [498, 256]]) {
      g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
    }
  });
}

function makeStripeTexture(): THREE.CanvasTexture {
  const t = canvasTexture(256, (g) => {
    g.fillStyle = '#f2c200';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#111';
    for (let i = -256; i < 512; i += 64) {
      g.beginPath();
      g.moveTo(i, 0); g.lineTo(i + 32, 0); g.lineTo(i + 32 + 256, 256); g.lineTo(i + 256, 256);
      g.fill();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 1);
  return t;
}

function makeCpzTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (g) => {
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(200,30,20,0.22)';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(242,194,0,0.9)';
    g.lineWidth = 10;
    g.strokeRect(5, 5, 246, 246);
    g.fillStyle = 'rgba(242,194,0,0.8)';
    g.font = 'bold 54px sans-serif';
    g.textAlign = 'center';
    g.fillText('CPZ', 128, 148);
  });
}
