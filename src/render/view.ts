import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { ARENA, arenaBoxes, flamePitRect } from '../sim/arena';
import { partFrames, subtree } from '../sim/assembly';
import type { Match } from '../sim/match';
import type { Part, Robot } from '../sim/robot';
import { MechanismView } from './mechanisms';
import { buildPartMesh } from './partMesh';
import { setWear } from './surfaces';

/** Three.js mirror of a Match. Reads simulation state; never writes it. */
export class MatchView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  private match: Match | null = null;
  private partMeshes: Array<{ part: Part; mesh: THREE.Object3D; mats: THREE.MeshPhysicalMaterial[]; scorch: number }> = [];
  private mechanisms: MechanismView[] = [];
  private blurDiscs: Array<{ robot: Robot; index: number; mesh: THREE.Mesh }> = [];
  private highlighted: string | null = null;
  private raycaster = new THREE.Raycaster();
  private robotGroup = new THREE.Group();
  private trapdoor!: THREE.Mesh;
  private floorFlipper!: THREE.Group;
  private flameLight!: THREE.PointLight;
  private flames: THREE.Points;
  private flameData: Array<{ p: THREE.Vector3; v: THREE.Vector3; life: number }> = [];
  private flamePositions = new Float32Array(400 * 3);
  private camTarget = new THREE.Vector3(0, 0, 0);
  private camPos = new THREE.Vector3(0, 12, 14);
  /** 'tv' frames the fight; 'follow' orbits one robot (garage test bay). */
  cameraMode: 'tv' | 'follow' = 'tv';
  followIndex = 0;
  private orbit = { yaw: 0.6, pitch: 0.55, dist: 3.2 };
  private snapCamera = false;
  private sparks: THREE.Points;
  private sparkData: Array<{ p: THREE.Vector3; v: THREE.Vector3; life: number }> = [];
  private sparkPositions = new Float32Array(600 * 3);
  private sparkColours = new Float32Array(600 * 3);
  /** Garage: the move / rotate / resize handles on the selected part. */
  private gizmo: TransformControls;
  private gizmoTarget = new THREE.Object3D();
  private gizmoState: GizmoState | null = null;
  /** While a part is being dragged: how far its meshes are shown moved from where the physics has them. */
  private preview: { ids: Set<string>; delta: THREE.Matrix4; scaleId: string; scale: THREE.Vector3 } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.scene.background = new THREE.Color(0x07080b);
    this.scene.fog = new THREE.Fog(0x07080b, 22, 45);
    // Something for metal to reflect: a soft studio room, kept dim for the arena's mood.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(arenaEnvironment(), 0.02).texture;
    this.scene.environmentIntensity = 1;
    pmrem.dispose();
    this.buildLights();
    this.buildArena();
    this.scene.add(this.robotGroup);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.sparkPositions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.sparkColours, 3));
    this.sparks = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.06, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.sparks.frustumCulled = false;
    this.scene.add(this.sparks);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(this.flamePositions, 3));
    this.flames = new THREE.Points(fg, new THREE.PointsMaterial({ size: 0.22, color: 0xff7a1a, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.flames.frustumCulled = false;
    this.scene.add(this.flames);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindOrbit(canvas);

    this.gizmo = new TransformControls(this.camera, canvas);
    this.gizmo.setSize(0.85);
    this.scene.add(this.gizmoTarget);
    this.gizmo.attach(this.gizmoTarget);
    const helper = this.gizmo.getHelper();
    helper.visible = false;
    this.gizmo.enabled = false;
    this.scene.add(helper);
    this.gizmo.addEventListener('mouseDown', () => this.gizmoStart());
    this.gizmo.addEventListener('objectChange', () => this.gizmoMove());
    this.gizmo.addEventListener('mouseUp', () => this.gizmoEnd());
  }

  /** Is the pointer on (or dragging) the part handles? Then a click isn't a pick. */
  gizmoBusy(): boolean {
    return this.gizmo.enabled && (this.gizmo.dragging || this.gizmo.axis !== null);
  }

  /**
   * Show handles on one of robot 0's parts (garage), or hide them with null.
   * The callbacks get the part's new pose in its parent's frame — the same
   * numbers the design stores — and, for resizing, the scale per part axis.
   */
  setGizmo(opts: GizmoOptions | null) {
    const helper = this.gizmo.getHelper();
    if (!opts) {
      this.gizmoState = null;
      this.gizmo.enabled = false;
      helper.visible = false;
      return;
    }
    const same = this.gizmoState?.opts.partId === opts.partId;
    this.gizmoState = { opts, start: null };
    this.gizmo.enabled = true;
    helper.visible = true;
    this.gizmo.setMode(opts.mode);
    this.gizmo.setSpace(opts.mode === 'translate' ? opts.space : 'local');
    this.gizmo.setRotationSnap(opts.snap ? THREE.MathUtils.degToRad(5) : null);
    this.gizmo.setScaleSnap(opts.snap ? 0.05 : null);
    if (!same) this.placeGizmo();
  }

  /** World pose of a design part's frame (where its joint is), from the live physics. */
  private framePose(id: string | null): { pos: THREE.Vector3; rot: THREE.Quaternion } | null {
    const r = this.match?.robots[0];
    if (!r) return null;
    const frames = partFrames(r.design);
    const rootId = r.design.parts.find((p) => p.parent === null)!.id;
    const key = id ?? rootId;
    const part = r.parts.find((p) => p.id === key);
    const body = part?.body;
    const f = frames.get(key);
    if (!part || !body || !f) return null;
    const origin = frames.get(part.bodyKey)?.pos ?? f.pos;
    const bq = body.rotation(), bp = body.translation();
    const rot = new THREE.Quaternion(bq.x, bq.y, bq.z, bq.w);
    if (id === null) {
      // The robot's own frame: the chassis' frame without the chassis' own pose.
      const pos = new THREE.Vector3(-f.pos.x, -f.pos.y, -f.pos.z).applyQuaternion(rot).add(new THREE.Vector3(bp.x, bp.y, bp.z));
      return { pos, rot };
    }
    const pos = new THREE.Vector3(f.pos.x - origin.x, f.pos.y - origin.y, f.pos.z - origin.z).applyQuaternion(rot).add(new THREE.Vector3(bp.x, bp.y, bp.z));
    return { pos, rot: rot.multiply(new THREE.Quaternion(f.rot.x, f.rot.y, f.rot.z, f.rot.w)) };
  }

  private placeGizmo() {
    const st = this.gizmoState;
    if (!st || this.gizmo.dragging) return;
    const pose = this.framePose(st.opts.partId);
    if (!pose) return;
    this.gizmoTarget.position.copy(pose.pos);
    this.gizmoTarget.quaternion.copy(pose.rot);
    this.gizmoTarget.scale.set(1, 1, 1);
  }

  private gizmoStart() {
    const st = this.gizmoState;
    const r = this.match?.robots[0];
    if (!st || !r) return;
    const def = r.design.parts.find((p) => p.id === st.opts.partId);
    const parent = this.framePose(def?.parent ?? null);
    if (!def || !parent) return;
    st.start = { pos: this.gizmoTarget.position.clone(), rot: this.gizmoTarget.quaternion.clone(), parent };
  }

  private gizmoMove() {
    const st = this.gizmoState;
    if (!st?.start) return;
    const t = this.gizmoTarget;
    const { parent, pos: p0, rot: q0 } = st.start;
    if (st.opts.mode === 'scale') {
      t.scale.set(Math.max(0.05, Math.abs(t.scale.x)), Math.max(0.05, Math.abs(t.scale.y)), Math.max(0.05, Math.abs(t.scale.z)));
      this.preview = { ids: new Set(), delta: new THREE.Matrix4(), scaleId: st.opts.partId, scale: t.scale.clone() };
      st.opts.onResize?.([t.scale.x, t.scale.y, t.scale.z], false);
      return;
    }
    // Into the parent's frame: those are the numbers the design keeps.
    const inv = parent.rot.clone().invert();
    const local = t.position.clone().sub(parent.pos).applyQuaternion(inv);
    const grid = st.opts.snap ? 0.005 : 0.001;
    local.set(snap(local.x, grid), snap(local.y, grid), snap(local.z, grid));
    const e = new THREE.Euler().setFromQuaternion(inv.clone().multiply(t.quaternion), 'ZYX');
    const step = st.opts.snap ? 5 : 1;
    let deg: [number, number, number] = [e.x, e.y, e.z].map((a) => snap(THREE.MathUtils.radToDeg(a), step)) as [number, number, number];
    // Moving shouldn't creep the angles through rounding, nor turning the position.
    if (st.opts.mode === 'translate') deg = st.opts.rotation;
    else local.set(...st.opts.position);
    // Show the snapped pose, so the handles land where the part will.
    const rq = new THREE.Quaternion().setFromEuler(new THREE.Euler(...deg.map((a) => THREE.MathUtils.degToRad(a)) as [number, number, number], 'ZYX'));
    if (st.opts.mode === 'rotate') t.quaternion.copy(parent.rot).multiply(rq);
    t.position.copy(local.clone().applyQuaternion(parent.rot).add(parent.pos));
    // The whole sub-assembly moves with the part.
    const r = this.match!.robots[0];
    const from = new THREE.Matrix4().compose(p0, q0, new THREE.Vector3(1, 1, 1));
    const to = new THREE.Matrix4().compose(t.position, t.quaternion, new THREE.Vector3(1, 1, 1));
    this.preview = { ids: new Set(subtree(r.design, st.opts.partId)), delta: to.multiply(from.invert()), scaleId: '', scale: new THREE.Vector3(1, 1, 1) };
    st.opts.onPose?.([local.x, local.y, local.z], deg, false);
  }

  private gizmoEnd() {
    const st = this.gizmoState;
    if (!st?.start) return;
    st.start = null;
    const t = this.gizmoTarget;
    if (st.opts.mode === 'scale') {
      const s: [number, number, number] = [t.scale.x, t.scale.y, t.scale.z];
      t.scale.set(1, 1, 1);
      if (s.some((v) => Math.abs(v - 1) > 1e-4)) st.opts.onResize?.(s, true);
      else this.preview = null;
      return;
    }
    if (!this.preview) return;
    st.opts.onPose?.(null, null, true);
  }

  /** Drag to orbit and wheel to zoom, in follow mode. */
  private bindOrbit(canvas: HTMLCanvasElement) {
    let drag: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      // Clicking the arena hands the keyboard back to the robots.
      (document.activeElement as HTMLElement | null)?.blur?.();
      if (this.cameraMode === 'follow' && !this.gizmoBusy()) { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); }
    });
    canvas.addEventListener('pointerup', () => (drag = null));
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (this.gizmo?.dragging) { drag = null; return; }
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

  /** Set the follow camera's orbit (and snap to it). */
  setOrbit(yaw: number, pitch: number, dist: number) {
    this.orbit = { yaw, pitch, dist };
    this.snapCamera = true;
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
      well: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 1 }),
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
    // Floor flipper: a striped steel panel hinged at its z0 edge.
    const ffd = ARENA.floorFlipper;
    this.floorFlipper = new THREE.Group();
    const ffPanel = new THREE.Mesh(new THREE.BoxGeometry(ffd.halfWidth * 2 - 0.02, 0.1, ffd.length - 0.02), new THREE.MeshStandardMaterial({ map: makeStripeTexture(), metalness: 0.4, roughness: 0.5 }));
    ffPanel.position.set(0, -0.05, ffd.length / 2);
    ffPanel.receiveShadow = ffPanel.castShadow = true;
    this.floorFlipper.add(ffPanel);
    this.floorFlipper.position.set(ffd.x, 0, ffd.z0);
    this.scene.add(this.floorFlipper);
    // Flame pit grille.
    const fr = flamePitRect();
    const grille = new THREE.Mesh(new THREE.PlaneGeometry(fr.x1 - fr.x0, fr.z1 - fr.z0), new THREE.MeshStandardMaterial({ map: makeGrilleTexture(), emissive: 0x401000, roughness: 0.8 }));
    grille.rotation.x = -Math.PI / 2;
    grille.position.set((fr.x0 + fr.x1) / 2, 0.003, (fr.z0 + fr.z1) / 2);
    this.scene.add(grille);
    this.flameLight = new THREE.PointLight(0xff6a10, 0, 6, 1.5);
    this.flameLight.position.set((fr.x0 + fr.x1) / 2, 0.8, (fr.z0 + fr.z1) / 2);
    this.scene.add(this.flameLight);
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

  /**
   * Show a different match. `keepCamera` holds the camera where it is (the
   * garage rebuilds the bay on every edit, and shouldn't swoop in each time).
   */
  setMatch(match: Match, keepCamera = false) {
    this.match = match;
    this.preview = null;
    // The garage rebuilds the bay on every edit: free the old robots' GPU resources.
    this.robotGroup.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const map = (mat as THREE.MeshStandardMaterial).map;
        if (map instanceof THREE.CanvasTexture) map.dispose();
        mat.dispose();
      }
    });
    this.robotGroup.clear();
    this.partMeshes = [];
    this.mechanisms = [];
    this.blurDiscs = [];
    this.sparkData = [];
    for (const r of match.robots) {
      const first = this.partMeshes.length;
      for (const part of r.parts) {
        if (!part.visual) continue;
        const { mesh, mats } = buildPartMesh(part, part.def?.parent === null ? r.design.name : null);
        this.robotGroup.add(mesh);
        this.partMeshes.push({ part, mesh, mats, scorch: 0 });
      }
      const mine = this.partMeshes.slice(first);
      const mech = new MechanismView(r, (id, axis) => {
        const pm = mine.find((m) => m.part.id === id);
        const geo = (pm?.mesh.children[0] as THREE.Mesh | undefined)?.geometry;
        const v = pm?.part.visual;
        if (!geo || !v) return 0.05;
        geo.computeBoundingBox();
        const half = geo.boundingBox!.getSize(new THREE.Vector3()).multiplyScalar(0.5);
        const q = new THREE.Quaternion(v.rot.x, v.rot.y, v.rot.z, v.rot.w);
        const ax = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map((e) => Math.abs(e.applyQuaternion(q).dot(axis)));
        return ax[0] * half.x + ax[1] * half.y + ax[2] * half.z;
      });
      this.robotGroup.add(mech.group);
      this.mechanisms.push(mech);
      r.rotors().forEach((rot, index) => {
        const disc = new THREE.Mesh(
          new THREE.CircleGeometry(rot.radius, 48),
          new THREE.MeshBasicMaterial({ color: 0xd8dde3, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
        );
        this.robotGroup.add(disc);
        this.blurDiscs.push({ robot: r, index, mesh: disc });
      });
    }
    if (!keepCamera) {
      this.camTarget.set(0, 0, 0);
      this.camPos.set(0, 12, 14);
    }
    if (this.gizmoState) {
      this.gizmoState.start = null;
      this.placeGizmo();
    }
  }

  render(dt: number) {
    const m = this.match;
    if (m) {
      this.syncParts(m, dt);
      this.syncSparks(m, dt);
      const t = m.arena.trapdoor.translation();
      this.trapdoor.position.set(t.x, t.y, t.z);
      const fq = m.arena.floorFlipper.rotation();
      this.floorFlipper.quaternion.set(fq.x, fq.y, fq.z, fq.w);
      this.syncFlames(m, dt);
      this.updateCamera(m, dt);
      this.placeGizmo();
    }
    this.renderer.render(this.scene, this.camera);
  }

  private syncParts(m: Match, dt: number) {
    const fr = flamePitRect();
    for (const pm of this.partMeshes) {
      const { part, mesh, mats } = pm;
      const b = part.body, v = part.visual;
      if (!b || !v || !part.collider) { mesh.visible = false; continue; }
      mesh.visible = true;
      // Body pose × the part's pose on that body.
      const bp = b.translation(), bq = b.rotation();
      const q = new THREE.Quaternion(bq.x, bq.y, bq.z, bq.w);
      mesh.position.set(v.pos.x, v.pos.y, v.pos.z).applyQuaternion(q).add(new THREE.Vector3(bp.x, bp.y, bp.z));
      mesh.quaternion.copy(q).multiply(new THREE.Quaternion(v.rot.x, v.rot.y, v.rot.z, v.rot.w));
      mesh.scale.set(1, 1, 1);
      const pv = this.preview;
      if (pv && part.def && m.robots[0].parts.includes(part)) {
        if (pv.ids.has(part.id)) {
          const mat = new THREE.Matrix4().compose(mesh.position, mesh.quaternion, mesh.scale).premultiply(pv.delta);
          mat.decompose(mesh.position, mesh.quaternion, mesh.scale);
        }
        if (pv.scaleId === part.id) mesh.scale.copy(pv.scale);
      }
      // Battle damage shows the way it would on the real thing: paint chipped
      // back to bare metal, gouges, and soot from the flame pit — never a bar.
      const p = mesh.position;
      if (m.arena.flamesOn && p.x > fr.x0 && p.x < fr.x1 && p.z > fr.z0 && p.z < fr.z1 && p.y < 0.6) pm.scorch = Math.min(1, pm.scorch + dt * 0.35);
      const wear = 0.03 + (1 - Math.max(0, part.condition)) * 0.32;
      const glow = this.highlighted && part.id === this.highlighted ? 0x806000 : 0x000000;
      for (const mat of mats) {
        setWear(mat, wear, pm.scorch);
        mat.emissive.setHex(glow);
      }
    }
    for (const mech of this.mechanisms) mech.update();
    for (const { robot, index, mesh } of this.blurDiscs) {
      const rot = robot.rotors()[index];
      if (!rot || !rot.actuator.child.joint) { mesh.visible = false; continue; }
      mesh.position.set(rot.centre.x, rot.centre.y, rot.centre.z);
      // Circle geometry faces +Z; turn it to face along the spin axis.
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(rot.axis.x, rot.axis.y, rot.axis.z));
      (mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(0.35, rot.rpm / 3000);
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

  private syncFlames(m: Match, dt: number) {
    for (const r of m.robots) {
      for (const f of r.activeFlames()) {
        for (let i = 0; i < 6 && this.flameData.length < 400; i++) {
          const spread = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.5);
          const dir = new THREE.Vector3(f.dir.x, f.dir.y, f.dir.z).add(spread).normalize();
          this.flameData.push({ p: new THREE.Vector3(f.origin.x, f.origin.y, f.origin.z), v: dir.multiplyScalar(f.range * 2.2), life: 0.35 + Math.random() * 0.15 });
        }
      }
    }
    const fr = flamePitRect();
    const on = m.arena.flamesOn;
    this.flameLight.intensity += ((on ? 40 + Math.random() * 25 : 0) - this.flameLight.intensity) * Math.min(1, dt * 12);
    if (on) {
      for (let i = 0; i < 12 && this.flameData.length < 400; i++) {
        this.flameData.push({
          p: new THREE.Vector3(fr.x0 + Math.random() * (fr.x1 - fr.x0), 0.02, fr.z0 + Math.random() * (fr.z1 - fr.z0)),
          v: new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.6 + Math.random() * 1.6, (Math.random() - 0.5) * 0.4),
          life: 0.35 + Math.random() * 0.35,
        });
      }
    }
    this.flameData = this.flameData.filter((f) => (f.life -= dt) > 0);
    this.flameData.forEach((f, i) => {
      f.p.addScaledVector(f.v, dt);
      this.flamePositions.set([f.p.x, f.p.y, f.p.z], i * 3);
    });
    this.flames.geometry.setDrawRange(0, this.flameData.length);
    this.flames.geometry.attributes.position.needsUpdate = true;
  }

  /** TV-style camera: high and to one side, drifting to keep both robots in frame. */
  private updateCamera(m: Match, dt: number) {
    const k = this.snapCamera ? 1 : 1 - Math.exp(-dt * 4);
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
    const live = m.competitors.filter((_, i) => !m.eliminated[i]);
    const focus = live.length ? live : m.competitors;
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

  /** Glow a design part (garage selection), or nothing. */
  highlight(partId: string | null) {
    this.highlighted = partId;
  }

  /** The design part under a screen point, if any. */
  pick(clientX: number, clientY: number, robotIndex = 0): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const robot = this.match?.robots[robotIndex];
    const candidates = this.partMeshes.filter((m) => robot?.parts.includes(m.part) && m.mesh.visible && m.part.def);
    // Only solid surfaces count (edge outlines would catch clicks from far away).
    const hits = this.raycaster.intersectObjects(candidates.map((c) => c.mesh), true).filter((h) => (h.object as THREE.Mesh).isMesh && !(h.object as THREE.LineSegments).isLineSegments);
    if (!hits.length) return null;
    let o: THREE.Object3D | null = hits[0].object;
    while (o && !candidates.some((c) => c.mesh === o)) o = o.parent;
    return candidates.find((c) => c.mesh === o)?.part.id ?? null;
  }

  /** Screen position of a robot (for name tags), or null if behind camera. */
  screenPos(r: Robot): { x: number; y: number } | null {
    const p = r.position;
    const v = new THREE.Vector3(p.x, p.y + 0.55, p.z).project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }
}

export interface GizmoOptions {
  /** A part of robot 0. */
  partId: string;
  mode: 'translate' | 'rotate' | 'scale';
  /** Moving along the world's axes or the part's own. */
  space: 'world' | 'local';
  /** 5 mm / 5° / 5% steps instead of 1 mm / 1°. */
  snap: boolean;
  /** The part's position and rotation as stored, so moving never nudges the angles (or turning the position). */
  position: [number, number, number];
  rotation: [number, number, number];
  /** Position (m) and rotation (°) in the parent's frame while dragging; `done` with nulls when let go. */
  onPose?: (pos: [number, number, number] | null, rotation: [number, number, number] | null, done: boolean) => void;
  /** Scale along the part's X, Y, Z while dragging, and once more when let go. */
  onResize?: (scale: [number, number, number], done: boolean) => void;
}

interface GizmoState {
  opts: GizmoOptions;
  start: { pos: THREE.Vector3; rot: THREE.Quaternion; parent: { pos: THREE.Vector3; rot: THREE.Quaternion } } | null;
}

const snap = (v: number, step: number) => Math.round(v / step) * step;

/**
 * What shiny parts reflect: a dark studio with lighting rigs overhead and a
 * few coloured stage lights, like the arena itself. Only used for reflections.
 */
function arenaEnvironment(): THREE.Scene {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(40, 16, 40), new THREE.MeshBasicMaterial({ color: 0x0b0c10, side: THREE.BackSide }));
  room.position.y = 6;
  env.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0x24262b }));
  floor.rotation.x = -Math.PI / 2;
  env.add(floor);
  const panel = (w: number, d: number, colour: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: colour, side: THREE.DoubleSide }));
    m.rotation.x = Math.PI / 2;
    m.position.set(x, y, z);
    env.add(m);
  };
  // Overhead lighting rig: long white strips.
  for (const z of [-6, 0, 6]) panel(18, 0.8, 0xbfc4cc, 0, 12, z);
  // Stage lights in the corners, matching the arena's.
  for (const [x, z, c] of [[-14, -14, 0xff5522], [14, 14, 0x3366ff], [14, -14, 0xffaa22], [-14, 14, 0xaa33ff]] as const) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(3) }));
    m.position.set(x, 6, z);
    env.add(m);
  }
  return env;
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

function makeGrilleTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (g) => {
    g.fillStyle = '#120a06';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#3a3a3a';
    g.lineWidth = 7;
    for (let i = 8; i < 256; i += 22) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); }
    g.strokeStyle = '#f2c200';
    g.lineWidth = 10;
    g.strokeRect(5, 5, 246, 246);
  });
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
