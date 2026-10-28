import RAPIER from '@dimforge/rapier3d-compat';
import { material } from '../data/materials';
import { BATTERIES, GEARBOX, MOTORS, RAMS, TANKS, VALVES, WHEELS, lookup, type MotorSpec, type RamSpec } from '../data/parts';
import { actuatorMass, faceArea, partFrames, partMass, resolveShape, root, shapeHalf, shapePoints, solidThickness, unit } from './assembly';
import type { ControlState } from './control';
import { COMPONENT_TOUGHNESS, DAMAGE, HEAT, WHEEL_TOUGHNESS, damageFor, plateToughness, transmission, type Toughness } from './damage';
import type { ActuatorDef, InputDef, PartDef, RobotDesign, Shape, Vec3 } from './design';
import { DEBRIS_GROUPS, GHOST_GROUPS, robotGroups, wheelBodyGroups, wheelTyreGroups } from './groups';
import { dcMotor } from './motor';
import { electronicsMass, gasDensity } from './stats';
import { mulberry32, qaxis, qconj, qmul, qrotate, twistAngle, vadd, vdot, vlen, vscale, vsub, type Q, type V3 } from './vmath';

export type PartKind = 'structure' | 'wheel' | 'component' | 'actuator' | 'electronics';

/** What the renderer needs to draw a part. Shapes match the collider exactly. */
export type Visual =
  | { type: 'hull'; points: Vec3[] }
  | { type: 'box'; half: Vec3 }
  | { type: 'cylinder'; radius: number; halfHeight: number }
  | { type: 'cone'; radius: number; halfHeight: number }
  | { type: 'capsule'; radius: number; halfHeight: number }
  | { type: 'sphere'; radius: number };

export interface Part {
  id: string;
  label: string;
  kind: PartKind;
  /** The design part this came from (actuators point at the part they drive). */
  def?: PartDef;
  /** 1 = new, 0 = failed. Internal state — shown to players only as words. */
  condition: number;
  failed: boolean;
  toughness: Toughness;
  /** Centre in its body's frame, as built. */
  local: V3;
  /** Which body (by jointed part id) it rides on. */
  bodyKey: string;
  collider: RAPIER.Collider | null;
  body: RAPIER.RigidBody | null;
  /** Sits inside: only takes transmitted damage until exposed. */
  internal: boolean;
  exposed: boolean;
  detached: boolean;
  visual?: Visual;
  colour?: number;
  /** Wheels: the sphere that actually rolls on the floor. */
  tyre?: RAPIER.Collider | null;
  /** Last condition band we announced, so commentary isn't spammy. */
  announced: number;
}

export interface RobotEvent {
  robot: number;
  text: string;
  level: 'info' | 'major';
}

interface BodyInfo {
  key: string;
  body: RAPIER.RigidBody;
  parent: BodyInfo | null;
  /** Body origin in the robot frame, as built. */
  origin: V3;
  /** Joint to the parent body, if any. */
  joint: RAPIER.ImpulseJoint | null;
  detached: boolean;
}

export interface Actuator {
  def: ActuatorDef;
  joint: 'hinge' | 'slider';
  /** The part being driven, and its ghost (motor/ram) for damage. */
  driven: Part;
  part: Part;
  child: BodyInfo;
  parent: BodyInfo;
  /** Joint axis in the (spawn-aligned) body frames. */
  axis: V3;
  /** Child origin relative to the parent body origin, as built. */
  anchor: V3;
  motor?: MotorSpec;
  ram?: RamSpec;
  area: number;
  gasPerShot: number;
  timeConstant: number;
  maxRate: number;
  /** Joint position limits (rad or m), from the built pose. */
  limits: [number, number] | null;
  toggled: boolean;
  wasPressed: boolean;
  firing: boolean;
  fireTime: number;
  shotScale: number;
  /** Latest joint speed (rad/s or m/s) and position (rad or m). */
  speed: number;
  position: number;
  /** Drives the robot along (wheels, legs, rolling shells) rather than being a weapon. */
  locomotion: boolean;
}

export interface Rotor {
  actuator: Actuator;
  rpm: number;
  on: boolean;
  radius: number;
  axis: V3;
  centre: V3;
}

const AIR_DAMPING = 0.05;
const GAIT_HZ = 1.4;

export class Robot {
  readonly design: RobotDesign;
  readonly index: number;
  readonly chassis: RAPIER.RigidBody;
  readonly parts: Part[] = [];
  readonly actuators: Actuator[] = [];
  readonly battery: { voltage: number; capacity: number; maxCurrent: number };
  energy: number;
  current = 0;
  powered = true;
  events: RobotEvent[] = [];
  gasCapacity = 0;
  gasLeft = 0;

  private world: RAPIER.World;
  private byCollider = new Map<number, Part>();
  private bodies_ = new Map<string, BodyInfo>();
  private groups: number;
  private rng: () => number;
  private cutoutTimer = 0;
  private batteryParts: Part[] = [];
  private tankParts: Part[] = [];
  private electronicsPart: Part;
  private control: ControlState = { left: 0, right: 0, weapon: false, weapon2: false };
  private gait = { left: 0, right: Math.PI };

  constructor(world: RAPIER.World, design: RobotDesign, index: number, position: V3, yaw: number) {
    this.world = world;
    this.design = design;
    this.index = index;
    this.groups = robotGroups(index);
    this.rng = mulberry32(1234 + index * 7919);
    const paint = hex(design.colour);
    const spawnRot = qaxis({ x: 0, y: 1, z: 0 }, yaw);
    const toWorld = (p: V3): V3 => vadd(position, qrotate(spawnRot, p));
    const frames = partFrames(design);
    const rootPart = root(design);

    // Batteries in parallel: same voltage, capacities add.
    const batts = design.parts.filter((p) => p.component?.type === 'battery').map((p) => lookup(BATTERIES, (p.component as { part: string }).part, 'battery'));
    this.battery = batts.length
      ? { voltage: Math.max(...batts.map((b) => b.voltage)), capacity: batts.reduce((s, b) => s + b.capacity, 0), maxCurrent: batts.reduce((s, b) => s + b.maxCurrent, 0) }
      : { voltage: 0, capacity: 0, maxCurrent: 0 };
    this.energy = this.battery.capacity;

    // One rigid body per jointed part (and the chassis). Every body starts
    // aligned with the chassis so joint axes read the same in both frames.
    const bodyOf = (p: PartDef): string => (p.parent === null || p.joint.type !== 'fixed' ? p.id : bodyOf(design.parts.find((q) => q.id === p.parent)!));
    const ordered: PartDef[] = [];
    const walk = (p: PartDef) => { ordered.push(p); for (const c of design.parts.filter((q) => q.parent === p.id)) walk(c); };
    walk(rootPart);
    for (const p of ordered) {
      if (bodyOf(p) !== p.id) continue;
      const origin = frames.get(p.id)!.pos;
      const w = toWorld(origin);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(w.x, w.y, w.z).setRotation(spawnRot)
          .setLinearDamping(AIR_DAMPING).setAngularDamping(p.parent === null ? AIR_DAMPING : 0.01).setCcdEnabled(true),
      );
      const parent = p.parent === null ? null : this.bodies_.get(bodyOf(design.parts.find((q) => q.id === p.parent)!))!;
      this.bodies_.set(p.id, { key: p.id, body, parent, origin, joint: null, detached: false });
    }
    this.chassis = this.bodies_.get(rootPart.id)!.body;

    // Colliders.
    for (const p of ordered) {
      const info = this.bodies_.get(bodyOf(p))!;
      const f = frames.get(p.id)!;
      const rs = resolveShape(p);
      const centre = vsub(vadd(f.pos, qrotate(f.rot, rs.offset)), info.origin);
      const rot = qmul(f.rot, rs.rot);
      const desc = colliderFor(rs.shape).setTranslation(centre.x, centre.y, centre.z).setRotation(rot).setMass(partMass(p));
      const part = this.addPart({
        id: p.id, label: p.label, kind: p.role, def: p, local: centre, bodyKey: info.key,
        internal: p.role === 'component',
        toughness: p.role === 'wheel' ? WHEEL_TOUGHNESS : p.role === 'component' ? COMPONENT_TOUGHNESS
          : plateToughness(p.material ?? 'aluminium', p.wall ?? solidThickness(rs.shape), faceArea(rs.shape)),
        visual: visualFor(rs.shape),
        colour: p.colour ? hex(p.colour) : p.role === 'wheel' ? 0x1b1b1b : p.role === 'component' ? 0x2c3036
          : p.material && ['ptfe', 'rubber', 'hardox', 'titanium', 'mildSteel'].includes(p.material) && p.parent !== null ? material(p.material).colour : paint,
      });
      part.body = info.body;
      if (p.role === 'wheel') {
        const spec = lookup(WHEELS, p.wheel!, 'wheel');
        desc.setFriction(spec.grip).setRestitution(0.05);
        // Rapier's cylinder-on-box contact makes resting wheels creep, so the
        // floor sees a sphere of the same radius; other robots see the cylinder.
        this.attach(part, desc, info.body, wheelBodyGroups(index));
        part.tyre = world.createCollider(
          RAPIER.ColliderDesc.ball(spec.radius).setTranslation(centre.x, centre.y, centre.z).setMass(0.01).setFriction(spec.grip).setRestitution(0.05)
            .setCollisionGroups(wheelTyreGroups(index))
            .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(DAMAGE.EVENT_THRESHOLD),
          info.body,
        );
        this.byCollider.set(part.tyre.handle, part);
      } else if (p.role === 'component') {
        desc.setFriction(0.4);
        this.attach(part, desc, info.body, GHOST_GROUPS);
        if (p.component!.type === 'battery') this.batteryParts.push(part);
        if (p.component!.type === 'gasTank') {
          this.tankParts.push(part);
          this.gasCapacity += lookup(TANKS, p.component!.part, 'tank').capacity;
        }
      } else {
        desc.setFriction(material(p.material ?? 'aluminium').friction).setRestitution(0.1);
        this.attach(part, desc, info.body);
      }
    }
    this.gasLeft = this.gasCapacity;

    // Joints and the motors / rams / servos on them.
    for (const p of ordered) {
      if (p.parent === null || p.joint.type === 'fixed') continue;
      const child = this.bodies_.get(p.id)!;
      const parent = child.parent!;
      const f = frames.get(p.id)!;
      const axis = qrotate(f.rot, unit(p.joint.axis));
      const anchor = vsub(child.origin, parent.origin);
      const jd = p.joint.type === 'hinge' ? RAPIER.JointData.revolute(anchor, { x: 0, y: 0, z: 0 }, axis) : RAPIER.JointData.prismatic(anchor, { x: 0, y: 0, z: 0 }, axis);
      const joint = world.createImpulseJoint(jd, parent.body, child.body, true) as RAPIER.RevoluteImpulseJoint;
      let limits: [number, number] | null = null;
      if (p.joint.type === 'hinge' && p.joint.limits) limits = [p.joint.limits[0] * Math.PI / 180, p.joint.limits[1] * Math.PI / 180];
      if (p.joint.type === 'slider') limits = [p.joint.limits[0] / 1000, p.joint.limits[1] / 1000];
      if (limits) joint.setLimits(limits[0], limits[1]);
      child.joint = joint;
      const a = p.joint.actuator;
      if (a) this.addActuator(p, a, child, parent, axis, anchor, limits);
    }

    // Speed controllers, radio and wiring, in the chassis.
    this.electronicsPart = this.addPart({ id: 'electronics', label: 'Speed controllers & radio', kind: 'electronics', local: { x: 0, y: 0, z: 0 }, bodyKey: rootPart.id, internal: true, toughness: COMPONENT_TOUGHNESS });
    this.electronicsPart.body = this.chassis;
    const em = electronicsMass(design);
    this.attach(this.electronicsPart, RAPIER.ColliderDesc.ball(Math.cbrt((3 * em) / (4 * Math.PI * 2500))).setMass(em), this.chassis, GHOST_GROUPS);
  }

  private addActuator(p: PartDef, def: ActuatorDef, child: BodyInfo, parent: BodyInfo, axis: V3, anchor: V3, limits: [number, number] | null) {
    const driven = this.parts.find((q) => q.id === p.id)!;
    const what = def.type === 'pneumatic' ? 'ram' : def.type === 'servo' ? 'servo' : 'motor';
    const mass = actuatorMass(def);
    // The motor or ram sits on the parent body at the joint.
    const part = this.addPart({ id: `${p.id}-act`, label: `${p.label} ${what}`, kind: 'actuator', local: anchor, bodyKey: parent.key, internal: true, toughness: COMPONENT_TOUGHNESS });
    part.body = parent.body;
    this.attach(part, RAPIER.ColliderDesc.ball(Math.cbrt((3 * mass) / (4 * Math.PI * 3000))).setTranslation(anchor.x, anchor.y, anchor.z).setMass(mass), parent.body, GHOST_GROUPS);
    const act: Actuator = {
      def, joint: p.joint.type as 'hinge' | 'slider', driven, part, child, parent, axis, anchor, limits,
      area: 0, gasPerShot: 0, timeConstant: 0.05, maxRate: Infinity,
      toggled: false, wasPressed: false, firing: false, fireTime: 0, shotScale: 1, speed: 0, position: 0,
      locomotion: ['left', 'right', 'throttle', 'steer', 'gait'].includes(def.input.source),
    };
    if (def.type === 'pneumatic') {
      const ram = lookup(RAMS, def.ram, 'ram');
      const valve = lookup(VALVES, def.valve, 'valve');
      act.ram = ram;
      act.area = Math.PI * (ram.bore / 2000) ** 2;
      act.gasPerShot = gasDensity(Math.min(def.pressure, ram.maxPressure)) * act.area * (ram.stroke / 1000) * 1000;
      act.timeConstant = valve.timeConstant;
      act.maxRate = valve.maxRate ?? Infinity;
    } else {
      act.motor = lookup(MOTORS, def.motor, 'motor');
    }
    if (def.type === 'servo') (child.joint as RAPIER.RevoluteImpulseJoint).configureMotorModel(RAPIER.MotorModel.ForceBased);
    this.actuators.push(act);
  }

  private addPart(p: Omit<Part, 'condition' | 'failed' | 'collider' | 'body' | 'exposed' | 'detached' | 'announced'>): Part {
    const part: Part = { ...p, condition: 1, failed: false, collider: null, body: null, exposed: false, detached: false, announced: 1 };
    this.parts.push(part);
    return part;
  }

  private attach(part: Part, desc: RAPIER.ColliderDesc, body: RAPIER.RigidBody, groups = this.groups) {
    desc.setCollisionGroups(groups);
    if (groups !== GHOST_GROUPS) desc.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(DAMAGE.EVENT_THRESHOLD);
    const c = this.world.createCollider(desc, body);
    if (part.collider) this.byCollider.delete(part.collider.handle);
    part.collider = c;
    this.byCollider.set(c.handle, part);
  }

  partFor(collider: RAPIER.Collider): Part | undefined {
    return this.byCollider.get(collider.handle);
  }

  /** Every rigid body that belongs to (or used to belong to) this robot. */
  bodies(): RAPIER.RigidBody[] {
    const out = new Set<RAPIER.RigidBody>();
    for (const b of this.bodies_.values()) out.add(b.body);
    for (const p of this.parts) if (p.body) out.add(p.body);
    return [...out];
  }

  get position(): V3 { return this.chassis.translation(); }
  get rotation(): Q { return this.chassis.rotation(); }
  /** World up-vector y component: 1 upright, −1 upside down. */
  get uprightness(): number { return qrotate(this.rotation, { x: 0, y: 1, z: 0 }).y; }
  get hasControl(): boolean { return !this.electronicsPart.failed; }

  /** Mass still attached to the robot (drops as bits come off). */
  get mass(): number {
    let m = 0;
    for (const b of this.bodies_.values()) if (!b.detached) m += b.body.mass();
    return m;
  }

  setControl(c: ControlState) {
    this.control = c;
  }

  /** Spinning weapons (toggle-driven motors), for the HUD, renderer and AI. */
  rotors(): Rotor[] {
    return this.actuators.filter((a) => a.def.type === 'motor' && !a.locomotion && a.joint === 'hinge').map((a) => {
      const shape = a.driven.def?.shape;
      const h = shape ? shapeHalf(shape) : { x: 0.2, y: 0.2, z: 0.2 };
      return {
        actuator: a,
        rpm: (Math.abs(a.speed) * 60) / (2 * Math.PI),
        on: a.def.input.mode === 'toggle' ? a.toggled : this.buttonHeld(a.def.input),
        radius: Math.max(h.x, h.y, h.z),
        axis: qrotate(a.child.body.rotation(), a.axis),
        centre: a.child.body.translation(),
      };
    });
  }

  /** Which buttons do something, and what kind of thing. */
  buttonUses(): Map<string, Set<'spinner' | 'pneumatic' | 'servo' | 'motor'>> {
    const out = new Map<string, Set<'spinner' | 'pneumatic' | 'servo' | 'motor'>>();
    for (const a of this.actuators) {
      if (!a.def.input.source.startsWith('button') || !a.child.joint) continue;
      const kind = a.def.type === 'motor' && a.def.input.mode === 'toggle' ? 'spinner' : a.def.type;
      if (!out.has(a.def.input.source)) out.set(a.def.input.source, new Set());
      out.get(a.def.input.source)!.add(kind);
    }
    return out;
  }

  // ---------------------------------------------------------------- per step

  update(dt: number) {
    const c = this.hasControl ? this.control : { left: 0, right: 0, weapon: false, weapon2: false };
    this.updatePower(dt);
    const voltage = this.powered ? this.battery.voltage * (0.88 + 0.12 * (this.energy / Math.max(1e-6, this.battery.capacity))) : 0;
    this.gait.left += 2 * Math.PI * GAIT_HZ * c.left * dt;
    this.gait.right += 2 * Math.PI * GAIT_HZ * c.right * dt;
    let amps = 0;
    for (const a of this.actuators) amps += this.drive(a, c, voltage, dt);
    for (const t of this.tankParts) if (t.condition < 0.5 && this.gasLeft > 0) this.gasLeft = Math.max(0, this.gasLeft - 40 * (1 - t.condition / 0.5) * dt);
    // The battery can only give so much; beyond that the voltage sags.
    this.current = Math.min(amps, this.battery.maxCurrent);
    this.energy = Math.max(0, this.energy - (voltage * this.current * dt) / 3600);
  }

  private buttonHeld(input: InputDef): boolean {
    const c = this.control;
    return { button1: c.weapon, button2: c.weapon2, button3: !!c.weapon3, button4: !!c.weapon4 }[input.source as 'button1'] ?? false;
  }

  /** The actuator's command: −1..1 for analog/gait inputs, 0/1 for buttons. */
  private command(a: Actuator, c: ControlState): number {
    const i = a.def.input;
    const scale = i.scale ?? 1;
    switch (i.source) {
      case 'left': return c.left * scale;
      case 'right': return c.right * scale;
      case 'throttle': return ((c.left + c.right) / 2) * scale;
      case 'steer': return ((c.left - c.right) / 2) * scale;
      case 'gait': {
        const phase = this.gait[i.side ?? 'left'] + ((i.phase ?? 0) * Math.PI) / 180;
        // Swing follows sin; lift is up while the leg swings back to the front, so
        // the foot is down (pushing) while the swing carries it backwards.
        const v = i.pattern === 'lift' ? Math.max(-1, Math.min(1, -Math.cos(phase) * 3)) : Math.sin(phase);
        return v * scale;
      }
      default: {
        const held = this.buttonHeld(i);
        const pressed = held && !a.wasPressed;
        a.wasPressed = held;
        if (i.mode === 'toggle') { if (pressed) a.toggled = !a.toggled; return a.toggled ? 1 : 0; }
        return held ? 1 : 0;
      }
    }
  }

  private drive(a: Actuator, c: ControlState, voltage: number, dt: number): number {
    const joint = a.child.joint;
    if (!joint) return 0;
    const cmd = this.command(a, c);
    const pRot = a.parent.body.rotation();
    const axis = qrotate(pRot, a.axis);
    if (a.joint === 'hinge') {
      a.speed = vdot(vsub(a.child.body.angvel(), a.parent.body.angvel()), axis);
      a.position = twistAngle(qmul(qconj(pRot), a.child.body.rotation()), a.axis);
    } else {
      const rel = qrotate(qconj(pRot), vsub(a.child.body.translation(), a.parent.body.translation()));
      a.position = vdot(vsub(rel, a.anchor), a.axis);
      a.speed = vdot(vsub(a.child.body.linvel(), a.parent.body.linvel()), axis);
    }
    const health = a.part.failed ? 0 : 0.3 + 0.7 * a.part.condition;
    if (!this.powered && a.def.type !== 'pneumatic') {
      if (a.def.type === 'servo') (joint as RAPIER.RevoluteImpulseJoint).setMotorMaxForce(0);
      return 0;
    }

    if (a.def.type === 'motor') {
      const out = dcMotor(a.motor!, voltage, Math.max(-1, Math.min(1, cmd)), a.speed * a.def.gear, health);
      // Gearbox and bearing drag.
      const torque = out.torque * a.def.gear * GEARBOX.efficiency - a.speed * 0.004 * a.def.gear;
      this.applyTorque(a, axis, torque * dt);
      return out.current;
    }

    if (a.def.type === 'servo') {
      const [lo, mid, hi] = a.def.targets;
      const v = Math.max(-1, Math.min(1, cmd));
      const t = v < 0 ? mid + (lo - mid) * -v : mid + (hi - mid) * v;
      const target = a.joint === 'hinge' ? (t * Math.PI) / 180 : t / 1000;
      const motor = a.motor!;
      const maxTorque = motor.stallTorque * (voltage / motor.voltage) * a.def.gear * GEARBOX.efficiency * health;
      // Hinges: N·m; sliders: treat the gearbox output as a lead screw (2π rad per 10 mm).
      const max = a.joint === 'hinge' ? maxTorque : maxTorque * 2 * Math.PI / 0.01;
      const unitErr = a.joint === 'hinge' ? 0.15 : 0.01;
      const j = joint as RAPIER.RevoluteImpulseJoint;
      j.configureMotorPosition(target, max / unitErr, (max / unitErr) * 0.08);
      j.setMotorMaxForce(max);
      const effort = Math.min(1, Math.abs(target - a.position) / unitErr);
      return motor.freeCurrent + (motor.stallCurrent * (voltage / motor.voltage) - motor.freeCurrent) * effort * 0.5;
    }

    // Pneumatic: fire on press, hold while held, vent on release.
    const pressed = cmd > 0.5 && this.powered;
    if (pressed && !a.firing && this.gasLeft > 0 && !this.tankParts.every((t) => t.failed)) {
      a.shotScale = Math.min(1, this.gasLeft / a.gasPerShot);
      this.gasLeft = Math.max(0, this.gasLeft - a.gasPerShot);
      a.firing = true;
      a.fireTime = 0;
      if (this.gasLeft <= 0) this.emit('has run out of gas!', 'major');
    }
    if (!pressed) a.firing = false;
    const pressure = Math.min(a.def.pressure, a.ram!.maxPressure);
    let force = 0;
    if (a.firing) {
      a.fireTime += dt;
      force = pressure * a.shotScale * (1 - Math.exp(-a.fireTime / a.timeConstant)) * 1e5 * a.area * health;
      // A flow-limited valve can't feed the ram faster than this: it lifts, not throws.
      if (Number.isFinite(a.maxRate)) {
        const rate = a.joint === 'hinge' ? a.maxRate : a.maxRate * 0.2;
        force *= Math.max(0, Math.min(1, (rate - a.speed) / (0.3 * rate)));
      }
    } else if (a.position > 0.03) {
      // Retract on the low-pressure side of the ram, back to where it was built.
      force = -0.08 * pressure * 1e5 * a.area;
    }
    if (force !== 0) {
      if (a.joint === 'hinge') this.applyTorque(a, axis, force * a.def.leverArm * dt);
      else {
        const imp = vscale(axis, force * dt);
        const at = a.child.body.translation();
        a.child.body.applyImpulseAtPoint(imp, at, true);
        a.parent.body.applyImpulseAtPoint(vscale(imp, -1), at, true);
      }
    }
    return a.firing ? 2 : 0;
  }

  private applyTorque(a: Actuator, axis: V3, impulse: number) {
    const t = vscale(axis, impulse);
    a.child.body.applyTorqueImpulse(t, true);
    a.parent.body.applyTorqueImpulse(vscale(t, -1), true);
  }

  private updatePower(dt: number) {
    if (!this.batteryParts.length || this.batteryParts.every((b) => b.failed) || this.energy <= 0) {
      if (this.powered) this.emit(this.energy <= 0 && this.batteryParts.length ? 'has run its battery flat!' : 'has lost all power!', 'major');
      this.powered = false;
      return;
    }
    if (this.cutoutTimer > 0) {
      this.cutoutTimer -= dt;
      this.powered = this.cutoutTimer <= 0;
      return;
    }
    // A battered battery or loose connector cuts out now and then.
    const c = Math.max(...this.batteryParts.map((b) => b.condition));
    if (c < 0.5 && this.rng() < (0.5 - c) * 0.8 * dt) {
      this.cutoutTimer = 0.3 + this.rng() * 0.9;
      this.powered = false;
      this.emit('is cutting out — loose connection?', 'info');
      return;
    }
    this.powered = true;
  }

  // ---------------------------------------------------------------- damage

  /**
   * Apply impact energy (J) to a part at a world-space contact point. `prior`
   * is energy this part already took earlier in the same impact, so the yield
   * threshold applies to the whole hit. Returns total condition lost.
   */
  absorb(part: Part, energy: number, point: V3, prior = 0): number {
    if (part.detached || energy <= 0) return 0;
    let loss = 0;
    const hurt = (q: Part, before: number, after: number) => {
      const c = q.condition;
      q.condition = Math.max(0, c - (damageFor(after, q.toughness) - damageFor(before, q.toughness)));
      loss += c - q.condition;
    };
    const total = prior + energy;
    hurt(part, prior, total);

    let passOn = 0;
    if (part.kind === 'structure' && part.def) passOn = transmission(part.def.material ?? 'aluminium', part.def.wall ?? solidThickness(part.def.shape!), part.condition);
    else if (part.kind === 'wheel') passOn = 0.15;
    if (passOn > 0) {
      // Armour passes some of the blow to whatever is mounted on the same body behind it.
      const body = this.bodies_.get(part.bodyKey);
      const local = body ? this.toBodyLocal(point, body.body) : part.local;
      for (const q of this.parts) {
        if (!q.internal || q.failed || q.exposed || q.bodyKey !== part.bodyKey) continue;
        const d = vlen(vsub(local, q.local));
        if (d > DAMAGE.TRANSMIT_RADIUS) continue;
        const k = passOn * (1 - d / DAMAGE.TRANSMIT_RADIUS);
        hurt(q, prior * k, total * k);
      }
      // Whatever drives this part feels its hits.
      const act = this.actuators.find((a) => a.child.key === part.bodyKey);
      if (act) hurt(act.part, prior * passOn * 0.5, total * passOn * 0.5);
    }
    return loss;
  }

  /** Flame-pit heat on one part for `dt` seconds. */
  heat(p: Part, dt: number) {
    if (p.detached || p.failed) return;
    let rate: number;
    if (p.kind === 'structure') rate = HEAT.plate[p.def?.material ?? 'aluminium'] ?? 0.01;
    else if (p.kind === 'component') rate = p.def?.component?.type === 'battery' ? HEAT.battery : HEAT.gas;
    else rate = (HEAT as unknown as Record<string, number>)[p.kind] ?? 0.015;
    if (p.internal && !p.exposed) rate *= HEAT.shielded;
    p.condition = Math.max(0, p.condition - rate * dt);
  }

  /** Turn condition changes into consequences: commentary, detachments, failures. */
  resolveDamage() {
    for (const p of this.parts) {
      if (p.failed) continue;
      for (const band of [0.65, 0.3]) {
        if (p.condition < band && p.announced > band) {
          p.announced = band;
          const what = p.kind === 'structure' ? (band > 0.5 ? 'is buckling' : 'is hanging on by a thread') : band > 0.5 ? 'has taken a hit' : 'is failing';
          this.emit(`— ${lower(p.label)} ${what}`, 'info');
        }
      }
      if (p.condition <= 0) {
        p.failed = true;
        this.onFail(p);
      }
    }
  }

  private onFail(p: Part) {
    switch (p.kind) {
      case 'structure':
        if (this.detach(p)) this.emit(`has had its ${lower(p.label)} torn off!`, 'major');
        break;
      case 'wheel':
        if (this.detach(p)) this.emit('has lost a wheel!', 'major');
        break;
      case 'electronics':
        this.emit('has lost radio control!', 'major');
        break;
      case 'actuator':
        this.emit(`'s ${lower(p.label)} has given up`, 'major');
        break;
      case 'component':
        if (p.def?.component?.type === 'gasTank' && this.tankParts.every((t) => t.failed)) {
          this.gasLeft = 0;
          this.emit("has had its gas bottle ruptured — the pneumatics are dead!", 'major');
        }
        break;
    }
  }

  /** Break a part away so it becomes loose debris. Returns false if it was already gone. */
  private detach(p: Part): boolean {
    if (p.detached) return false;
    const info = this.bodies_.get(p.bodyKey);
    if (!info) return false;
    if (info.key === p.id && info.parent) {
      // The part is what's on the end of a joint: snap the joint and the whole
      // assembly beyond it flies off together.
      if (info.joint) { this.world.removeImpulseJoint(info.joint, true); info.joint = null; }
      const gone = [info.key];
      for (const b of this.bodies_.values()) {
        let cur: BodyInfo | null = b;
        while (cur && cur.key !== info.key) cur = cur.parent;
        if (cur) { b.detached = true; if (!gone.includes(b.key)) gone.push(b.key); }
      }
      for (const q of this.parts) {
        if (!gone.includes(q.bodyKey) || q.detached) continue;
        q.detached = true;
        if (q.tyre) { this.byCollider.delete(q.tyre.handle); this.world.removeCollider(q.tyre, true); q.tyre = null; }
        q.collider?.setCollisionGroups(DEBRIS_GROUPS);
      }
      this.exposeNear(p);
      return true;
    }
    if (!p.collider || p.kind !== 'structure') return false;
    // A fixed panel: recreate it as its own body where it was.
    const old = p.collider;
    const pos = old.translation(), rot = old.rotation();
    const vel = info.body.velocityAtPoint(pos);
    const desc = colliderFor(resolveShape(p.def!).shape).setMass(partMass(p.def!)).setFriction(0.4);
    this.byCollider.delete(old.handle);
    this.world.removeCollider(old, true);
    p.collider = null;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setRotation(rot).setLinvel(vel.x, vel.y, vel.z));
    p.body = body;
    p.detached = true;
    this.attach(p, desc, body, DEBRIS_GROUPS);
    this.exposeNear(p);
    return true;
  }

  /** Internals near a lost part can now be hit directly. */
  private exposeNear(lost: Part) {
    const reach = lost.def?.shape ? vlen(shapeHalf(lost.def.shape)) + 0.05 : 0.3;
    for (const q of this.parts) {
      if (!q.internal || q.exposed || !q.collider || q.bodyKey !== lost.bodyKey) continue;
      if (vlen(vsub(q.local, lost.local)) > reach) continue;
      q.exposed = true;
      q.collider.setCollisionGroups(this.groups);
      q.collider.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
      q.collider.setContactForceEventThreshold(DAMAGE.EVENT_THRESHOLD);
    }
  }

  private toBodyLocal(p: V3, body: RAPIER.RigidBody): V3 {
    return qrotate(qconj(body.rotation()), vsub(p, body.translation()));
  }

  /**
   * Can the robot currently push itself along? Some powered locomotion
   * actuator (wheel motor, leg servo, rolling shell) has its part touching
   * something. Used by the referee's count.
   */
  tractionWheels(): number {
    if (!this.powered || !this.hasControl) return 0;
    let n = 0;
    for (const a of this.actuators) {
      if (!a.locomotion || !a.child.joint || a.part.failed) continue;
      let touching = false;
      for (const q of this.parts) {
        if (touching || q.detached || q.bodyKey !== a.child.key) continue;
        for (const c of [q.tyre, q.collider]) {
          if (!c || touching) continue;
          this.world.contactPairsWith(c, (other) => {
            if (touching) return;
            this.world.contactPair(c, other, (m) => { if (m.numContacts() > 0) touching = true; });
          });
        }
      }
      if (touching) n++;
    }
    return n;
  }

  private emit(text: string, level: RobotEvent['level']) {
    this.events.push({ robot: this.index, text, level });
  }
}

function colliderFor(s: Shape): RAPIER.ColliderDesc {
  switch (s.type) {
    case 'box': return RAPIER.ColliderDesc.cuboid(s.size[0] / 2, s.size[1] / 2, s.size[2] / 2);
    case 'cylinder': return RAPIER.ColliderDesc.cylinder(s.length / 2, s.radius);
    case 'cone': return RAPIER.ColliderDesc.cone(s.length / 2, s.radius);
    case 'sphere': return RAPIER.ColliderDesc.ball(s.radius);
    case 'capsule': return RAPIER.ColliderDesc.capsule(s.length / 2, s.radius);
    default: {
      const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(shapePoints(s)!.flat()));
      if (!desc) throw new Error('A hull needs at least 4 points that aren\'t all flat.');
      return desc;
    }
  }
}

function visualFor(s: Shape): Visual {
  switch (s.type) {
    case 'box': return { type: 'box', half: [s.size[0] / 2, s.size[1] / 2, s.size[2] / 2] };
    case 'cylinder': return { type: 'cylinder', radius: s.radius, halfHeight: s.length / 2 };
    case 'cone': return { type: 'cone', radius: s.radius, halfHeight: s.length / 2 };
    case 'sphere': return { type: 'sphere', radius: s.radius };
    case 'capsule': return { type: 'capsule', radius: s.radius, halfHeight: s.length / 2 };
    default: return { type: 'hull', points: shapePoints(s)! };
  }
}

const hex = (c: string): number => parseInt(c.slice(1), 16);
const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
