import * as THREE from 'three';
import type { Actuator, Robot } from '../sim/robot';
import { hardware } from './surfaces';

/**
 * The working parts between bodies: pneumatic rams that really extend when
 * a flipper fires, drive motors and gearboxes behind the wheels, weapon
 * motors, spinner hubs and hinge pins. Purely visual — the simulation
 * already accounts for their mass and forces.
 */

type Body = Actuator['parent']['body'];

const Y = new THREE.Vector3(0, 1, 0);

function poseOf(body: Body, out: THREE.Object3D) {
  const t = body.translation(), q = body.rotation();
  out.position.set(t.x, t.y, t.z);
  out.quaternion.set(q.x, q.y, q.z, q.w);
}

function toWorld(body: Body, local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const t = body.translation(), q = body.rotation();
  return out.copy(local).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w)).add(new THREE.Vector3(t.x, t.y, t.z));
}

let mats: ReturnType<typeof makeMats> | null = null;
function makeMats() {
  return {
    barrel: hardware(0xb7bcc2, 1, 0.3, { rough: 'brushed' }),
    chrome: hardware(0xeceef0, 1, 0.06),
    cap: hardware(0x1d1e21, 0.4, 0.45),
    motorCan: hardware(0x1f2023, 0.3, 0.45, { clearcoat: 0.4 }),
    endBell: hardware(0xaeb3b9, 1, 0.32, { rough: 'brushed' }),
    gearbox: hardware(0x8d9298, 0.95, 0.4, { rough: 'brushed' }),
    steel: hardware(0x6d7176, 0.95, 0.4),
    bolt: hardware(0x2c2d30, 0.85, 0.32),
  };
}

/** Motor can size from its mass (steel + copper, ~6.5 t/m³, length 2.2 × radius). */
function motorSize(mass: number) {
  const r = Math.cbrt(mass / (6500 * Math.PI * 2.2));
  return { r, len: 2.2 * r };
}

function cylinderAlong(dir: THREE.Vector3, r: number, len: number, mat: THREE.Material, segs = 24): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, segs), mat);
  m.quaternion.setFromUnitVectors(Y, dir);
  m.castShadow = true;
  return m;
}

/** A DC motor (black can, bright end bells) with its gearbox, along `dir` from `start`. */
function motorAssembly(start: THREE.Vector3, dir: THREE.Vector3, mass: number, gearbox: boolean): THREE.Group {
  const M = mats!;
  const g = new THREE.Group();
  const { r, len } = motorSize(mass);
  let at = 0;
  if (gearbox) {
    const gl = Math.max(0.025, r * 0.8);
    const gb = new THREE.Mesh(new THREE.BoxGeometry(r * 2.3, gl, r * 2.3), M.gearbox);
    gb.quaternion.setFromUnitVectors(Y, dir);
    gb.position.copy(start).addScaledVector(dir, gl / 2);
    gb.castShadow = true;
    g.add(gb);
    at = gl;
  }
  const bell = Math.max(0.006, len * 0.12);
  const parts: Array<[number, number, THREE.Material]> = [[bell, r * 1.02, M.endBell], [len - 2 * bell, r, M.motorCan], [bell, r * 1.02, M.endBell]];
  for (const [l, rr, mat] of parts) {
    const m = cylinderAlong(dir, rr, l, mat);
    m.position.copy(start).addScaledVector(dir, at + l / 2);
    g.add(m);
    at += l;
  }
  // Brush caps / terminals on the back.
  const term = cylinderAlong(dir, r * 0.3, 0.012, M.cap, 12);
  term.position.copy(start).addScaledVector(dir, at + 0.006);
  g.add(term);
  return g;
}

interface Item { update(): void }

export class MechanismView {
  readonly group = new THREE.Group();
  private items: Item[] = [];

  /** `extentAlong(partId, axis)` gives a driven part's half-length along a joint axis (for hinge pins). */
  constructor(robot: Robot, extentAlong: (partId: string, axis: THREE.Vector3) => number) {
    mats ??= makeMats();
    for (const a of robot.actuators) {
      try { this.add(a, extentAlong); } catch { /* a visual extra; never break the match over it */ }
    }
  }

  update() { for (const i of this.items) i.update(); }

  private add(a: Actuator, extentAlong: (partId: string, axis: THREE.Vector3) => number) {
    const axis = new THREE.Vector3(a.axis.x, a.axis.y, a.axis.z).normalize();
    const anchor = new THREE.Vector3(a.anchor.x, a.anchor.y, a.anchor.z);
    const isWheel = a.driven.kind === 'wheel';
    if (a.def.type === 'pneumatic') {
      this.addRam(a, axis, anchor, extentAlong);
      if (a.joint === 'hinge') this.addHingePin(a, axis, anchor, extentAlong(a.driven.id, axis));
      return;
    }
    // Motors and servos sit on the parent body at the joint.
    const mass = a.motor?.mass ?? 2;
    const onParent = new THREE.Group();
    if (isWheel) {
      // Motor + gearbox inboard of the wheel, on the axle line.
      const vis = a.driven.visual;
      const halfW = vis && vis.shape.type === 'cylinder' ? vis.shape.length / 2 : 0.03;
      const s = Math.sign(axis.dot(anchor)) || 1;
      const inward = axis.clone().multiplyScalar(-s);
      onParent.add(motorAssembly(anchor.clone().addScaledVector(inward, halfW + 0.006), inward, mass, true));
    } else {
      const s = Math.sign(-axis.dot(anchor)) || 1;
      const out = axis.clone().multiplyScalar(s);
      const clear = Math.min(0.08, extentAlong(a.driven.id, axis)) + 0.01;
      onParent.add(motorAssembly(anchor.clone().addScaledVector(out, clear), out, mass, true));
      if (a.def.type === 'motor') this.addHub(a, axis, Math.min(0.08, extentAlong(a.driven.id, axis)));
      else if (a.joint === 'hinge') this.addHingePin(a, axis, anchor, extentAlong(a.driven.id, axis));
    }
    this.group.add(onParent);
    const body = a.parent.body;
    this.items.push({ update: () => poseOf(body, onParent) });
  }

  /** Spinner hub: a boss and a ring of cap screws, on the spinning part. */
  private addHub(a: Actuator, axis: THREE.Vector3, halfThick: number) {
    const M = mats!;
    const g = new THREE.Group();
    const r = 0.032, len = halfThick * 2 + 0.016;
    g.add(cylinderAlong(axis, r, len, M.steel, 28));
    const t1 = new THREE.Vector3().crossVectors(axis, Math.abs(axis.y) < 0.9 ? Y : new THREE.Vector3(1, 0, 0)).normalize();
    const t2 = new THREE.Vector3().crossVectors(axis, t1);
    for (const sgn of [-1, 1]) for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const b = cylinderAlong(axis, 0.005, 0.006, M.bolt, 6);
      b.position.copy(t1).multiplyScalar(Math.cos(ang) * r * 0.65).addScaledVector(t2, Math.sin(ang) * r * 0.65).addScaledVector(axis, sgn * (len / 2 + 0.003));
      g.add(b);
    }
    this.group.add(g);
    const child = a.child;
    this.items.push({ update: () => { g.visible = !!child.body; if (child.body) poseOf(child.body, g); } });
  }

  /** Hinge pin with knuckles along the joint axis, on the parent body. */
  private addHingePin(a: Actuator, axis: THREE.Vector3, anchor: THREE.Vector3, halfLen: number) {
    const M = mats!;
    const L = Math.min(0.6, Math.max(0.06, halfLen * 1.8));
    const g = new THREE.Group();
    const pin = cylinderAlong(axis, 0.008, L + 0.02, M.chrome, 12);
    pin.position.copy(anchor);
    g.add(pin);
    const n = Math.max(2, Math.round(L / 0.15) + 1);
    for (let i = 0; i < n; i++) {
      const k = cylinderAlong(axis, 0.016, 0.03, M.steel, 16);
      k.position.copy(anchor).addScaledVector(axis, -L / 2 + (L * i) / (n - 1));
      g.add(k);
    }
    this.group.add(g);
    const body = a.parent.body;
    this.items.push({ update: () => poseOf(body, g) });
  }

  /**
   * A pneumatic ram from a mount inside the parent to a clevis on the driven
   * part, at the actuator's lever arm. The barrel stays put and the chrome rod
   * slides out as the joint opens.
   */
  private addRam(a: Actuator, axis: THREE.Vector3, anchor: THREE.Vector3, extentAlong: (partId: string, axis: THREE.Vector3) => number) {
    if (a.def.type !== 'pneumatic' || !a.ram) return;
    const M = mats!;
    const ram = a.ram;
    const stroke = ram.stroke / 1000, bore = ram.bore / 1000;
    const closed = stroke + bore * 1.2 + 0.05;
    const floorY = -a.parent.origin.y + 0.045;
    let baseP: THREE.Vector3, endC: THREE.Vector3;
    if (a.joint === 'hinge') {
      const vis = a.driven.visual;
      const toPart = vis ? new THREE.Vector3(vis.pos.x, vis.pos.y, vis.pos.z) : new THREE.Vector3(0, 0, 1);
      const d = toPart.addScaledVector(axis, -toPart.dot(axis));
      if (d.lengthSq() < 1e-6) d.set(0, 0, 1).addScaledVector(axis, -axis.z);
      d.normalize();
      const lever = THREE.MathUtils.clamp(a.def.leverArm, 0.03, 0.5);
      // The ram pushes the part the way its joint opens, from underneath.
      const lim = a.limits;
      const sgn = lim && Math.abs(lim[0]) > Math.abs(lim[1]) ? -1 : 1;
      const v = new THREE.Vector3().crossVectors(axis, d).multiplyScalar(sgn);
      endC = d.clone().multiplyScalar(lever).addScaledVector(v, -(extentAlong(a.driven.id, v) + Math.max(0.007, (a.ram.bore / 1000) * 0.2) * 1.3 + 0.004));
      const endP = anchor.clone().add(endC);
      baseP = endP.clone().addScaledVector(v, -closed);
      for (let deg = 15; deg <= 85; deg += 5) {
        const b = (deg * Math.PI) / 180;
        const u = v.clone().multiplyScalar(-Math.cos(b)).addScaledVector(d, -Math.sin(b)).normalize();
        baseP = endP.clone().addScaledVector(u, closed);
        if (baseP.y >= floorY) break;
      }
    } else {
      endC = new THREE.Vector3();
      baseP = anchor.clone().addScaledVector(axis, -closed);
    }
    const rBarrel = bore / 2 + 0.006, rRod = Math.max(0.007, bore * 0.2);
    const barrelLen = stroke + bore * 0.6 + 0.03;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rBarrel, rBarrel, 1, 28), M.barrel);
    const capA = new THREE.Mesh(new THREE.CylinderGeometry(rBarrel * 1.12, rBarrel * 1.12, 1, 28), M.cap);
    const capB = capA.clone();
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(rRod, rRod, 1, 16), M.chrome);
    const clevis = new THREE.Mesh(new THREE.BoxGeometry(rRod * 2.6, rRod * 2.6, rRod * 2.6), M.steel);
    const mount = new THREE.Mesh(new THREE.BoxGeometry(rBarrel * 2.2, 0.02, rBarrel * 2.2), M.steel);
    for (const m of [barrel, capA, capB, rod, clevis, mount]) { m.castShadow = true; this.group.add(m); }
    const B = new THREE.Vector3(), E = new THREE.Vector3(), dir = new THREE.Vector3(), q = new THREE.Quaternion();
    const place = (m: THREE.Object3D, from: number, len: number) => {
      m.position.copy(B).addScaledVector(dir, from + len / 2);
      m.quaternion.copy(q);
      m.scale.set(1, Math.max(0.001, len), 1);
    };
    this.items.push({
      update: () => {
        const parent = a.parent.body, child = a.child;
        toWorld(parent, baseP, B);
        if (child.detached || !child.joint) toWorld(parent, anchor.clone().add(endC), E);
        else toWorld(child.body, endC, E);
        dir.copy(E).sub(B);
        const len = Math.max(0.01, dir.length());
        dir.divideScalar(len);
        q.setFromUnitVectors(Y, dir);
        const bl = Math.min(barrelLen, len - 0.02);
        place(barrel, 0, bl);
        place(capA, 0, 0.018);
        place(capB, bl - 0.018, 0.018);
        place(rod, bl, len - bl);
        clevis.position.copy(E);
        clevis.quaternion.copy(q);
        mount.position.copy(B);
        mount.quaternion.copy(q);
        const broke = child.detached || !child.joint;
        rod.visible = clevis.visible = !broke;
      },
    });
  }
}
