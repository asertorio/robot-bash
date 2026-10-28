import RAPIER from '@dimforge/rapier3d-compat';
import { material } from '../data/materials';
import { BATTERIES, GEARBOX, MOTORS, RAMS, TANKS, VALVES, WHEELS, lookup, type BatterySpec, type MotorSpec } from '../data/parts';
import type { ControlState } from './control';
import { COMPONENT_TOUGHNESS, DAMAGE, HEAT, WHEEL_TOUGHNESS, damageFor, plateToughness, transmission, type Toughness } from './damage';
import type { FlipperDef, RobotDesign, ShellPanel, SpinnerDef, Vec3 } from './design';
import { dist, panelArea, panelFaceArea, panelVertices } from './geometry';
import { DEBRIS_GROUPS, GHOST_GROUPS, robotGroups, wheelBodyGroups, wheelTyreGroups } from './groups';
import { dcMotor } from './motor';
import { bladeProps, electronics, flipperNumbers, flipperPlateMass } from './stats';
import { fromArr, mulberry32, qaxis, qconj, qmul, qrotate, twistAngle, vadd, vdot, vsub, type Q, type V3 } from './vmath';

export type PartKind = 'panel' | 'wheel' | 'driveMotor' | 'battery' | 'electronics' | 'gas' | 'flipper' | 'spinner' | 'weaponMotor';

/** What the renderer needs to draw a part. Shapes match the collider exactly. */
export type Visual =
  | { type: 'hull'; points: Vec3[] }
  | { type: 'box'; half: Vec3 }
  | { type: 'cylinder'; radius: number; halfHeight: number };

export interface Part {
  id: string;
  label: string;
  kind: PartKind;
  /** 1 = new, 0 = failed. Internal state — shown to players only as words. */
  condition: number;
  failed: boolean;
  toughness: Toughness;
  /** Centre in the chassis frame (where it was mounted). */
  local: Vec3;
  /** Collider that represents this part in the world, if any. */
  collider: RAPIER.Collider | null;
  /** Own rigid body (wheels, weapons, debris); null when riding on the chassis. */
  body: RAPIER.RigidBody | null;
  /** Sits behind armour: only takes transmitted damage until exposed. */
  internal: boolean;
  exposed: boolean;
  detached: boolean;
  side?: 'left' | 'right';
  panel?: ShellPanel;
  visual?: Visual;
  colour?: number;
  /** For wheels: the joint holding it on. */
  joint?: RAPIER.ImpulseJoint | null;
  /** For wheels: moment of inertia about the axle. */
  axleInertia?: number;
  /** For wheels: the sphere that actually rolls on the floor (see buildWheel). */
  tyre?: RAPIER.Collider | null;
  /** Last condition band we announced, so commentary isn't spammy. */
  announced: number;
}

export interface RobotEvent {
  robot: number;
  text: string;
  /** 'major' events are worth a commentary shout. */
  level: 'info' | 'major';
}

interface FlipperRuntime {
  def: FlipperDef;
  plate: Part;
  gas: Part;
  body: RAPIER.RigidBody;
  joint: RAPIER.ImpulseJoint | null;
  restAngle: number;
  maxAngle: number;
  area: number;
  pressure: number;
  gasLeft: number;
  gasPerShot: number;
  timeConstant: number;
  maxRate: number;
  firing: boolean;
  fireTime: number;
  shotScale: number;
  wasPressed: boolean;
}

interface SpinnerRuntime {
  def: SpinnerDef;
  blade: Part;
  motorPart: Part;
  motor: MotorSpec;
  body: RAPIER.RigidBody;
  joint: RAPIER.ImpulseJoint | null;
  axisLocal: V3;
  on: boolean;
  wasPressed: boolean;
  omega: number;
}

const HINGE_AXIS: V3 = { x: -1, y: 0, z: 0 };
const WHEEL_AXIS: V3 = { x: 1, y: 0, z: 0 };
const AIR_DAMPING = 0.05;

export class Robot {
  readonly design: RobotDesign;
  readonly index: number;
  readonly chassis: RAPIER.RigidBody;
  readonly parts: Part[] = [];
  readonly flippers: FlipperRuntime[] = [];
  readonly spinners: SpinnerRuntime[] = [];
  readonly battery: BatterySpec;
  readonly driveMotor: MotorSpec;
  /** Wh left in the battery. */
  energy: number;
  /** Latest total battery current, A. */
  current = 0;
  /** Power currently reaching the motors (false during a cut-out or when dead). */
  powered = true;
  events: RobotEvent[] = [];

  private world: RAPIER.World;
  private byCollider = new Map<number, Part>();
  private groups: number;
  private rng: () => number;
  private cutoutTimer = 0;
  private batteryPart!: Part;
  private electronicsPart!: Part;
  private control: ControlState = { left: 0, right: 0, weapon: false, weapon2: false };

  constructor(world: RAPIER.World, design: RobotDesign, index: number, position: V3, yaw: number) {
    this.world = world;
    this.design = design;
    this.index = index;
    this.groups = robotGroups(index);
    this.rng = mulberry32(1234 + index * 7919);
    this.battery = lookup(BATTERIES, design.battery.part, 'battery');
    this.driveMotor = lookup(MOTORS, design.drive.motor, 'motor');
    this.energy = this.battery.capacity;

    const rot = qaxis({ x: 0, y: 1, z: 0 }, yaw);
    this.chassis = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setRotation(rot)
        .setLinearDamping(AIR_DAMPING)
        .setAngularDamping(AIR_DAMPING)
        .setCcdEnabled(true),
    );
    const paint = parseInt(design.colour.slice(1), 16);
    const toWorld = (local: Vec3): V3 => vadd(position, qrotate(rot, fromArr(local)));

    // Shell panels: hollow plates, mass from surface area × thickness.
    for (const p of design.shell) {
      const m = material(p.material);
      const mass = panelArea(p) * (p.thickness / 1000) * m.density;
      const points = panelVertices(p);
      const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(points.flat()))!
        .setTranslation(...p.position)
        .setMass(mass)
        .setFriction(0.35)
        .setRestitution(0.1);
      const part = this.addPart({
        id: p.id, label: p.label, kind: 'panel', panel: p, local: p.position, internal: false,
        toughness: plateToughness(p.material, p.thickness, panelFaceArea(p)),
        visual: { type: 'hull', points }, colour: paint,
      });
      this.attach(part, desc, this.chassis);
    }

    for (const s of design.skids) {
      // Skids carry weight but aren't worth damaging.
      const c = world.createCollider(
        RAPIER.ColliderDesc.ball(s.radius).setTranslation(...s.position).setMass(0.2).setFriction(0.05).setCollisionGroups(this.groups),
        this.chassis,
      );
      void c;
    }

    // Internals: mass-only until a hole in the armour exposes them.
    const ghost = (id: string, label: string, kind: PartKind, local: Vec3, mass: number, side?: 'left' | 'right'): Part => {
      const radius = Math.cbrt((3 * mass) / (4 * Math.PI * 3000));
      const part = this.addPart({ id, label, kind, local, internal: true, side, toughness: COMPONENT_TOUGHNESS });
      const desc = RAPIER.ColliderDesc.ball(radius).setTranslation(...local).setMass(mass).setFriction(0.4);
      this.attach(part, desc, this.chassis, GHOST_GROUPS);
      return part;
    };

    const dm = this.driveMotor;
    const mp = design.drive.motorPosition;
    for (const side of ['left', 'right'] as const) {
      const sx = side === 'left' ? Math.abs(mp[0]) : -Math.abs(mp[0]);
      for (let i = 0; i < design.drive.motorsPerSide; i++) {
        const dz = design.drive.motorsPerSide === 1 ? 0 : (i - (design.drive.motorsPerSide - 1) / 2) * 0.2;
        ghost(`motor-${side}-${i}`, `${side === 'left' ? 'Left' : 'Right'} drive motor${design.drive.motorsPerSide > 1 ? ` ${i + 1}` : ''}`, 'driveMotor',
          [sx, mp[1], mp[2] + dz], dm.mass + GEARBOX.mass, side);
      }
    }
    this.batteryPart = ghost('battery', 'Battery', 'battery', design.battery.position, this.battery.mass);
    this.electronicsPart = ghost('electronics', 'Speed controllers & radio', 'electronics',
      [design.battery.position[0], design.battery.position[1] + 0.02, design.battery.position[2] + 0.16], electronics(design).mass);

    // Wheels: own bodies on revolute joints so torque, grip and wheelspin are real.
    design.drive.wheels.forEach((w, i) => {
      const spec = lookup(WHEELS, w.wheel, 'wheel');
      const wp = toWorld(w.position);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(wp.x, wp.y, wp.z).setRotation(rot).setAngularDamping(0.02).setCcdEnabled(true),
      );
      // Rapier's cylinder-on-box contact makes resting wheels creep, so the
      // floor sees a sphere of the same radius; other robots see the cylinder.
      const cyl = qaxis({ x: 0, y: 0, z: 1 }, Math.PI / 2);
      const desc = RAPIER.ColliderDesc.cylinder(spec.width / 2, spec.radius)
        .setRotation(cyl)
        .setMass(spec.mass)
        .setFriction(spec.grip)
        .setRestitution(0.05);
      const part = this.addPart({
        id: `wheel-${i}`, label: `${w.side === 'left' ? 'Left' : 'Right'} wheel ${i + 1}`, kind: 'wheel', side: w.side,
        local: w.position, internal: false, toughness: WHEEL_TOUGHNESS,
        visual: { type: 'cylinder', radius: spec.radius, halfHeight: spec.width / 2 }, colour: 0x1b1b1b,
      });
      part.body = body;
      part.axleInertia = 0.5 * spec.mass * spec.radius * spec.radius;
      this.attach(part, desc, body, wheelBodyGroups(index));
      part.tyre = world.createCollider(
        RAPIER.ColliderDesc.ball(spec.radius).setMass(0.01).setFriction(spec.grip).setRestitution(0.05)
          .setCollisionGroups(wheelTyreGroups(index))
          .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(DAMAGE.EVENT_THRESHOLD),
        body,
      );
      this.byCollider.set(part.tyre.handle, part);
      part.joint = world.createImpulseJoint(
        RAPIER.JointData.revolute({ x: w.position[0], y: w.position[1], z: w.position[2] }, { x: 0, y: 0, z: 0 }, WHEEL_AXIS),
        this.chassis, body, true,
      );
    });

    design.weapons.forEach((wdef, wi) => {
      if (wdef.kind === 'flipper') this.buildFlipper(wdef, wi, rot, toWorld, paint, ghost);
      else this.buildSpinner(wdef, wi, rot, toWorld, ghost);
    });
  }

  private buildFlipper(def: FlipperDef, wi: number, rot: Q, toWorld: (l: Vec3) => V3, paint: number,
    ghost: (id: string, label: string, kind: PartKind, local: Vec3, mass: number) => Part) {
    const ram = lookup(RAMS, def.ram, 'ram');
    const valve = lookup(VALVES, def.valve, 'valve');
    const tank = lookup(TANKS, def.tank, 'tank');
    const nums = flipperNumbers(def);
    const gas = ghost(`gas-${wi}`, 'Pneumatics (ram, valve & CO2)', 'gas', def.gasPosition, ram.mass + valve.mass + tank.mass + tank.capacity / 1000);
    const t = def.plate.thickness / 1000;
    // At rest the plate lies down at an angle so its tip touches the floor: it is the wedge.
    const restAngle = Math.asin(Math.min(0.95, Math.max(0, (def.hinge[1] - t) / def.plate.length)));
    const hp = toWorld(def.hinge);
    const bodyRot = qmul(rot, qaxis({ x: 1, y: 0, z: 0 }, restAngle));
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(hp.x, hp.y, hp.z).setRotation(bodyRot).setCcdEnabled(true),
    );
    const half: Vec3 = [def.plate.width / 2, t / 2, def.plate.length / 2];
    const desc = RAPIER.ColliderDesc.cuboid(...half)
      .setTranslation(0, 0, def.plate.length / 2)
      .setMass(flipperPlateMass(def))
      .setFriction(0.3)
      .setRestitution(0.1);
    const plate = this.addPart({
      id: `flipper-${wi}`, label: 'Flipper', kind: 'flipper', internal: false,
      local: [def.hinge[0], def.hinge[1], def.hinge[2] + def.plate.length / 2],
      toughness: plateToughness(def.plate.material, def.plate.thickness, def.plate.width * def.plate.length),
      visual: { type: 'box', half }, colour: shade(paint, 0.75),
    });
    plate.body = body;
    this.attach(plate, desc, body);
    const joint = this.world.createImpulseJoint(
      RAPIER.JointData.revolute({ x: def.hinge[0], y: def.hinge[1], z: def.hinge[2] }, { x: 0, y: 0, z: 0 }, HINGE_AXIS),
      this.chassis, body, true,
    ) as RAPIER.RevoluteImpulseJoint;
    const maxAngle = (def.maxAngle * Math.PI) / 180;
    joint.setLimits(-restAngle - 0.05, maxAngle);
    this.flippers.push({
      def, plate, gas, body, joint, restAngle, maxAngle,
      area: Math.PI * (ram.bore / 2000) ** 2,
      pressure: nums.pressure,
      gasLeft: tank.capacity,
      gasPerShot: nums.gasPerShot,
      timeConstant: valve.timeConstant,
      maxRate: valve.maxRate ?? Infinity,
      firing: false, fireTime: 0, shotScale: 1, wasPressed: false,
    });
  }

  private buildSpinner(def: SpinnerDef, wi: number, rot: Q, toWorld: (l: Vec3) => V3,
    ghost: (id: string, label: string, kind: PartKind, local: Vec3, mass: number) => Part) {
    const motor = lookup(MOTORS, def.motor, 'motor');
    const motorPart = ghost(`wmotor-${wi}`, 'Weapon motor', 'weaponMotor', def.motorPosition, motor.mass);
    const bp = bladeProps(def);
    const hp = toWorld(def.position);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(hp.x, hp.y, hp.z).setRotation(rot).setCcdEnabled(true).setAngularDamping(0),
    );
    const t = def.blade.thickness / 1000;
    const horizontal = def.orientation === 'horizontal';
    const axisLocal: V3 = horizontal ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    let desc: RAPIER.ColliderDesc;
    let visual: Visual;
    if (def.blade.shape === 'bar') {
      const half: Vec3 = horizontal ? [def.blade.length / 2, t / 2, def.blade.width / 2] : [t / 2, def.blade.width / 2, def.blade.length / 2];
      desc = RAPIER.ColliderDesc.cuboid(...half);
      visual = { type: 'box', half };
    } else {
      desc = RAPIER.ColliderDesc.cylinder(t / 2, def.blade.length / 2);
      if (!horizontal) desc.setRotation(qaxis({ x: 0, y: 0, z: 1 }, Math.PI / 2));
      visual = { type: 'cylinder', radius: def.blade.length / 2, halfHeight: t / 2 };
    }
    desc.setMass(bp.mass + 1.5).setFriction(0.2).setRestitution(0.2);
    const blade = this.addPart({
      id: `spinner-${wi}`, label: 'Spinner', kind: 'spinner', internal: false, local: def.position,
      // The blade is a solid slab; what gives out is the hub and bearings behind it.
      toughness: { yieldEnergy: 1500, capacity: 25000 },
      visual, colour: material(def.blade.material).colour,
    });
    blade.body = body;
    this.attach(blade, desc, body);
    const joint = this.world.createImpulseJoint(
      RAPIER.JointData.revolute({ x: def.position[0], y: def.position[1], z: def.position[2] }, { x: 0, y: 0, z: 0 }, axisLocal),
      this.chassis, body, true,
    );
    this.spinners.push({ def, blade, motorPart, motor, body, joint, axisLocal, on: false, wasPressed: false, omega: 0 });
  }

  private addPart(p: Omit<Part, 'condition' | 'failed' | 'collider' | 'body' | 'exposed' | 'detached' | 'announced'>): Part {
    const part: Part = { ...p, condition: 1, failed: false, collider: null, body: null, exposed: false, detached: false, announced: 1 };
    this.parts.push(part);
    return part;
  }

  private attach(part: Part, desc: RAPIER.ColliderDesc, body: RAPIER.RigidBody, groups = this.groups) {
    desc.setCollisionGroups(groups);
    if (groups !== GHOST_GROUPS) {
      desc.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(DAMAGE.EVENT_THRESHOLD);
    }
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
    const out = [this.chassis];
    for (const p of this.parts) if (p.body && !out.includes(p.body)) out.push(p.body);
    return out;
  }

  get position(): V3 {
    return this.chassis.translation();
  }

  get rotation(): Q {
    return this.chassis.rotation();
  }

  /** World up-vector y component: 1 upright, −1 upside down. */
  get uprightness(): number {
    return qrotate(this.rotation, { x: 0, y: 1, z: 0 }).y;
  }

  get hasControl(): boolean {
    return !this.electronicsPart.failed;
  }

  /** Total mass currently attached (drops as panels and wheels come off). */
  get mass(): number {
    return this.chassis.mass() + this.parts.filter((p) => p.body && !p.detached).reduce((s, p) => s + p.body!.mass(), 0);
  }

  get flipperGas(): number[] {
    return this.flippers.map((f) => f.gasLeft);
  }

  setControl(c: ControlState) {
    this.control = c;
  }

  // ---------------------------------------------------------------- per step

  update(dt: number) {
    const c = this.hasControl ? this.control : { left: 0, right: 0, weapon: false, weapon2: false };
    this.updatePower(dt);
    const voltage = this.powered ? this.battery.voltage * (0.88 + 0.12 * (this.energy / this.battery.capacity)) : 0;
    let amps = 0;
    const rot = this.rotation;
    const chassisAng = this.chassis.angvel();

    // Drive: each side's motors share one torque, split across that side's wheels.
    for (const side of ['left', 'right'] as const) {
      const throttle = side === 'left' ? c.left : c.right;
      const motors = this.parts.filter((p) => p.kind === 'driveMotor' && p.side === side && !p.failed);
      const wheels = this.parts.filter((p) => p.kind === 'wheel' && p.side === side && !p.detached);
      if (!wheels.length) continue;
      const axis = qrotate(rot, WHEEL_AXIS);
      const speeds = wheels.map((w) => vdot(vsub(w.body!.angvel(), chassisAng), axis));
      const omega = speeds.reduce((a, b) => a + b, 0) / wheels.length;
      // Wheels on one side are chained together: pull them to a common speed.
      wheels.forEach((w, i) => {
        const j = (omega - speeds[i]) * w.axleInertia! * 0.8;
        w.body!.applyTorqueImpulse({ x: axis.x * j, y: axis.y * j, z: axis.z * j }, true);
      });
      let torque = 0;
      for (const m of motors) {
        // A battered motor loses torque; below 30% it's on its last legs.
        const out = dcMotor(this.driveMotor, voltage, throttle, omega * this.design.drive.gearRatio, 0.3 + 0.7 * m.condition);
        torque += out.torque * this.design.drive.gearRatio * GEARBOX.efficiency;
        amps += out.current;
      }
      // Free-wheeling gearboxes still drag a little.
      torque -= omega * 0.15 * wheels.length;
      const per = (torque / wheels.length) * dt;
      for (const w of wheels) {
        w.body!.applyTorqueImpulse({ x: axis.x * per, y: axis.y * per, z: axis.z * per }, true);
        this.chassis.applyTorqueImpulse({ x: -axis.x * per, y: -axis.y * per, z: -axis.z * per }, true);
      }
    }

    for (const f of this.flippers) amps += this.updateFlipper(f, c, dt);
    for (const s of this.spinners) amps += this.updateSpinner(s, c, voltage, dt);

    // The battery can only give so much; beyond that the voltage sags.
    this.current = Math.min(amps, this.battery.maxCurrent);
    this.energy = Math.max(0, this.energy - (voltage * this.current * dt) / 3600);
  }

  private updatePower(dt: number) {
    if (this.batteryPart.failed || this.energy <= 0) {
      if (this.powered) this.emit(this.energy <= 0 ? 'has run its battery flat!' : 'has lost all power!', 'major');
      this.powered = false;
      return;
    }
    if (this.cutoutTimer > 0) {
      this.cutoutTimer -= dt;
      this.powered = this.cutoutTimer <= 0;
      return;
    }
    // A battered battery or loose connector cuts out now and then.
    const c = this.batteryPart.condition;
    if (c < 0.5 && this.rng() < (0.5 - c) * 0.8 * dt) {
      this.cutoutTimer = 0.3 + this.rng() * 0.9;
      this.powered = false;
      this.emit('is cutting out — loose connection?', 'info');
      return;
    }
    this.powered = true;
  }

  private updateFlipper(f: FlipperRuntime, c: ControlState, dt: number): number {
    if (!f.joint) return 0;
    const pressed = c.weapon && this.powered;
    const gasOk = !f.gas.failed;
    if (pressed && !f.wasPressed && gasOk) {
      if (f.gasLeft > 0) {
        f.shotScale = Math.min(1, f.gasLeft / f.gasPerShot);
        f.gasLeft = Math.max(0, f.gasLeft - f.gasPerShot);
        f.firing = true;
        f.fireTime = 0;
        if (f.gasLeft <= 0) this.emit('has run out of gas!', 'major');
      }
    }
    if (!pressed) f.firing = false;
    f.wasPressed = pressed;

    // Damaged pneumatics leak.
    if (f.gas.condition < 0.5 && f.gasLeft > 0) f.gasLeft = Math.max(0, f.gasLeft - 40 * (1 - f.gas.condition / 0.5) * dt);

    const rel = qmul(qconj(this.rotation), f.body.rotation());
    const angle = twistAngle(rel, HINGE_AXIS);
    const hingeHealth = 0.4 + 0.6 * f.plate.condition;
    let torque = 0;
    if (f.firing && gasOk) {
      f.fireTime += dt;
      const p = f.pressure * f.shotScale * (1 - Math.exp(-f.fireTime / f.timeConstant));
      torque = p * 1e5 * f.area * f.def.leverArm * hingeHealth;
      // A flow-limited valve can't feed the ram faster than this: it lifts, not throws.
      if (Number.isFinite(f.maxRate)) {
        const rate = vdot(vsub(f.body.angvel(), this.chassis.angvel()), qrotate(this.rotation, HINGE_AXIS));
        torque *= Math.max(0, Math.min(1, (f.maxRate - rate) / (0.3 * f.maxRate)));
      }
    } else if (angle > -f.restAngle + 0.02) {
      // Retract on the low-pressure side of the ram.
      torque = -0.08 * f.pressure * 1e5 * f.area * f.def.leverArm;
    }
    if (torque !== 0) {
      const axis = qrotate(this.rotation, HINGE_AXIS);
      const ti = torque * dt;
      f.body.applyTorqueImpulse({ x: axis.x * ti, y: axis.y * ti, z: axis.z * ti }, true);
      this.chassis.applyTorqueImpulse({ x: -axis.x * ti, y: -axis.y * ti, z: -axis.z * ti }, true);
    }
    return f.firing ? 2 : 0; // solenoid current
  }

  private updateSpinner(s: SpinnerRuntime, c: ControlState, voltage: number, dt: number): number {
    if (!s.joint) return 0;
    if (c.weapon && !s.wasPressed) s.on = !s.on;
    s.wasPressed = c.weapon;
    const axis = qrotate(this.rotation, s.axisLocal);
    s.omega = vdot(vsub(s.body.angvel(), this.chassis.angvel()), axis);
    let torque = 0, amps = 0;
    if (c.weapon2) {
      // Electrical braking: short the motor and let back-EMF stop the blade.
      s.on = false;
      const brake = s.motor.stallTorque * s.def.beltRatio * 0.5 * s.motorPart.condition;
      torque = -Math.sign(s.omega) * Math.min(brake, Math.abs(s.omega) * 2);
    } else if (s.on && !s.motorPart.failed) {
      const out = dcMotor(s.motor, voltage, 1, s.omega * s.def.beltRatio, 0.3 + 0.7 * s.motorPart.condition);
      torque = out.torque * s.def.beltRatio;
      amps = out.current;
    }
    // Bearings: worse the more battered the hub is.
    torque -= s.omega * 0.003 * (1 + 6 * (1 - s.blade.condition));
    const ti = torque * dt;
    s.body.applyTorqueImpulse({ x: axis.x * ti, y: axis.y * ti, z: axis.z * ti }, true);
    this.chassis.applyTorqueImpulse({ x: -axis.x * ti, y: -axis.y * ti, z: -axis.z * ti }, true);
    return amps;
  }

  // ---------------------------------------------------------------- damage

  /**
   * Apply impact energy (J) to a part, at a world-space contact point.
   * `prior` is energy this part already took earlier in the same impact (a
   * hit can span several physics steps), so the yield threshold applies to
   * the impact as a whole. Returns total condition lost (for the judges).
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

    // Armour passes some of the blow to whatever is mounted behind it.
    let passOn = 0;
    if (part.kind === 'panel' && part.panel) passOn = transmission(part.panel.material, part.panel.thickness, part.condition);
    else if (part.kind === 'flipper') passOn = 0.25;
    else if (part.kind === 'spinner') passOn = 0.1;
    if (passOn > 0) {
      const local = this.toLocal(point);
      for (const q of this.parts) {
        if (!q.internal || q.failed || q.exposed) continue;
        const d = dist(local, q.local);
        if (d > DAMAGE.TRANSMIT_RADIUS) continue;
        const k = passOn * (1 - d / DAMAGE.TRANSMIT_RADIUS);
        hurt(q, prior * k, total * k);
      }
      // A weapon's drive always feels what the weapon does.
      for (const s of this.spinners) if (s.blade === part) hurt(s.motorPart, prior * passOn, total * passOn);
      for (const f of this.flippers) if (f.plate === part) hurt(f.gas, prior * passOn, total * passOn);
    }
    return loss;
  }

  /** Flame-pit heat on one part for `dt` seconds. */
  heat(p: Part, dt: number) {
    if (p.detached || p.failed) return;
    let rate = 0;
    if (p.kind === 'panel' && p.panel) rate = HEAT.plate[p.panel.material] ?? 0.01;
    else if (p.kind === 'flipper' || p.kind === 'spinner') rate = 0.004;
    else rate = (HEAT as unknown as Record<string, number>)[p.kind] ?? 0.01;
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
          const what = p.kind === 'panel' ? (band > 0.5 ? 'is buckling' : 'is hanging on by a thread') : band > 0.5 ? 'has taken a hit' : 'is failing';
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
      case 'panel':
        this.detach(p);
        this.emit(`has had its ${lower(p.label)} torn off!`, 'major');
        this.exposeNear(p);
        break;
      case 'wheel':
        this.detach(p);
        this.emit(`has lost a wheel!`, 'major');
        break;
      case 'driveMotor': {
        const left = this.parts.some((q) => q.kind === 'driveMotor' && q.side === p.side && !q.failed);
        this.emit(left ? `— a ${p.side} drive motor has burnt out` : `has lost drive on the ${p.side} side!`, left ? 'info' : 'major');
        break;
      }
      case 'battery':
        break; // updatePower announces it
      case 'electronics':
        this.emit('has lost radio control!', 'major');
        break;
      case 'gas':
        for (const f of this.flippers) if (f.gas === p) f.gasLeft = 0;
        this.emit("has had its pneumatics ruptured — the flipper's dead!", 'major');
        break;
      case 'flipper':
        this.detach(p);
        this.emit('has had its flipper ripped clean off!', 'major');
        break;
      case 'spinner':
        this.detach(p);
        this.emit("'s spinner has sheared off its hub!", 'major');
        break;
      case 'weaponMotor':
        this.emit("'s weapon motor has given up", 'major');
        break;
    }
  }

  /** Break a part away from the robot so it becomes loose debris. */
  private detach(p: Part) {
    p.detached = true;
    const flipper = this.flippers.find((f) => f.plate === p);
    const spinner = this.spinners.find((s) => s.blade === p);
    if (p.joint) { this.world.removeImpulseJoint(p.joint, true); p.joint = null; }
    if (p.tyre) { this.byCollider.delete(p.tyre.handle); this.world.removeCollider(p.tyre, true); p.tyre = null; }
    if (flipper?.joint) { this.world.removeImpulseJoint(flipper.joint, true); flipper.joint = null; }
    if (spinner?.joint) { this.world.removeImpulseJoint(spinner.joint, true); spinner.joint = null; }
    if (p.body && p.collider) {
      p.collider.setCollisionGroups(DEBRIS_GROUPS);
      return;
    }
    // A panel riding on the chassis: recreate it as its own body where it was.
    if (!p.collider || !p.panel) return;
    const old = p.collider;
    const pos = old.translation();
    const rot = old.rotation();
    const vel = this.chassis.velocityAtPoint(pos);
    this.byCollider.delete(old.handle);
    this.world.removeCollider(old, true);
    p.collider = null;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setRotation(rot).setLinvel(vel.x, vel.y, vel.z),
    );
    const m = material(p.panel.material);
    const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(panelVertices(p.panel).flat()))!
      .setMass(panelArea(p.panel) * (p.panel.thickness / 1000) * m.density)
      .setFriction(0.4);
    p.body = body;
    this.attach(p, desc, body, DEBRIS_GROUPS);
  }

  /** Internals near a lost panel can now be hit directly. */
  private exposeNear(panel: Part) {
    const reach = Math.max(...panel.panel!.size) / 2 + 0.05;
    for (const q of this.parts) {
      if (!q.internal || q.exposed || !q.collider) continue;
      if (dist(q.local, panel.local) > reach) continue;
      q.exposed = true;
      q.collider.setCollisionGroups(this.groups);
      q.collider.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
      q.collider.setContactForceEventThreshold(DAMAGE.EVENT_THRESHOLD);
    }
  }

  toLocal(p: V3): Vec3 {
    const l = qrotate(qconj(this.rotation), vsub(p, this.position));
    return [l.x, l.y, l.z];
  }

  /** Wheels that can currently push the robot along: attached, on a powered side, touching something. */
  tractionWheels(): number {
    if (!this.powered || !this.hasControl) return 0;
    let n = 0;
    for (const w of this.parts) {
      if (w.kind !== 'wheel' || w.detached || !w.collider || !w.tyre) continue;
      if (!this.parts.some((m) => m.kind === 'driveMotor' && m.side === w.side && !m.failed)) continue;
      let touching = false;
      for (const c of [w.tyre, w.collider]) {
        this.world.contactPairsWith(c, (other) => {
          if (touching) return;
          this.world.contactPair(c, other, (manifold) => { if (manifold.numContacts() > 0) touching = true; });
        });
      }
      if (touching) n++;
    }
    return n;
  }

  spinnerRpm(): number[] {
    return this.spinners.map((s) => (Math.abs(s.omega) * 60) / (2 * Math.PI));
  }

  private emit(text: string, level: RobotEvent['level']) {
    this.events.push({ robot: this.index, text, level });
  }
}

function lower(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function shade(colour: number, f: number): number {
  const r = Math.round(((colour >> 16) & 255) * f), g = Math.round(((colour >> 8) & 255) * f), b = Math.round((colour & 255) * f);
  return (r << 16) | (g << 8) | b;
}
