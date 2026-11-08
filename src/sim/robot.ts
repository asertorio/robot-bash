import RAPIER from '@dimforge/rapier3d-compat';
import { hardnessOf, material } from '../data/materials';
import { BATTERIES, GEARBOX, MOTORS, RAMS, TANKS, VALVES, WHEELS, lookup, type MotorSpec, type RamSpec } from '../data/parts';
import { actuatorMass, faceArea, partFrames, partMass, registerCatalog, resolveShape, rigidGroup, root, shapeHalf, solidThickness, unit } from './assembly';
import { convexPieces, hullMetrics, pieceMassProps, shapeVolume, type Piece } from './shapes';
import type { ControlState } from './control';
import { COMPONENT_TOUGHNESS, CUT, DAMAGE, HEAT, SHOCK, WHEEL_TOUGHNESS, damageFor, plateToughness, transmission, type Toughness } from './damage';
import type { ActuatorDef, ChainDef, EdgeKind, InputDef, LaunchDef, PartDef, RobotDesign, Shape } from './design';
import { LAUNCH, launcherExtras } from './launch';
import { DEBRIS_GROUPS, GHOST_GROUPS, robotGroups, wheelBodyGroups, wheelTyreGroups } from './groups';
import { RPM_TO_RADS, dcMotor } from './motor';
import { electronicsMass, gasDensity } from './stats';
import { mulberry32, principalAxes, qaxis, qconj, qmul, qrotate, twistAngle, vadd, vdot, vlen, vscale, vsub, type Q, type V3 } from './vmath';

export type PartKind = 'structure' | 'wheel' | 'component' | 'actuator' | 'electronics';

/** What the renderer draws: the part's real shape, posed relative to its body. */
export interface Visual {
  shape: Shape;
  pos: V3;
  rot: Q;
}

export interface Part {
  id: string;
  label: string;
  kind: PartKind;
  /** The design part this came from (actuators point at the part they drive). */
  def?: PartDef;
  /** 1 = new, 0 = failed. Shown to players as words and as colours on the health diagram. */
  condition: number;
  failed: boolean;
  toughness: Toughness;
  /** Centre in its body's frame, as built. */
  local: V3;
  /** Which body (by jointed part id) it rides on. */
  bodyKey: string;
  /** First collider of the part (contacts, picking); `extra` holds the rest of its convex pieces. */
  collider: RAPIER.Collider | null;
  extra: RAPIER.Collider[];
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
  /** What it's made of (wheels: rubber; internals: aluminium casings), for edges and hardness. */
  material: string;
  /** Plate or section thickness, mm (what a spike has to get through). */
  thickness: number;
  /** How its edge cuts. */
  edge: EdgeKind;
}

export type ButtonUse = 'spinner' | 'pneumatic' | 'servo' | 'motor' | 'chain' | 'cannon' | 'harpoon' | 'cut' | 'winch';

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
  /** Soft start: the throttle the speed controller has ramped up to so far. */
  ramp: number;
}

/** A round: the body it rides on and the parts on it. */
export interface Round {
  info: BodyInfo;
  parts: Part[];
  /** Robot clock (s) when it left the barrel. */
  firedAt: number;
  /** Stuck into something (a harpoon or bolt that pierced a plate). */
  embed: RAPIER.ImpulseJoint | null;
}

/** A cannon or harpoon gun (see LaunchDef and sim/launch.ts). */
export interface Launcher {
  def: LaunchDef;
  partDef: PartDef;
  act: Actuator;
  /** Round in the barrel, or null once fired (until reloaded or reeled back in). */
  loaded: Round | null;
  spares: Round[];
  reloadIn: number;
  /** Rounds that have left the barrel. */
  fired: Round[];
  /** Spare rounds, cable and winch: one mass on the launcher's mount that can be damaged. */
  mount: Part;
  /** Built position of the round's body origin relative to the mount body, and where the muzzle is. */
  anchor: V3;
  muzzle: V3;
  cable: { round: Round; joint: RAPIER.ImpulseJoint | null; length: number; jointLength: number; taut: boolean } | null;
  /** The winch, as an actuator-like input (for toggle/hold handling). */
  winch: { def: { input: InputDef }; toggled: boolean; wasPressed: boolean; speed: number } | null;
  wasPressed: boolean;
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
const NEUTRAL_CONTROL: ControlState = { left: 0, right: 0, weapon: false, weapon2: false };
/**
 * Robot-on-robot contact. Bare plate on plate is slippery, so evenly matched
 * robots slide off each other and come round again instead of mashing
 * together. Against the arena floor the floor's own rule (multiply) still
 * wins, so traction is unchanged. Hardly any bounce: 0.12 made hit robots
 * skate further and, oddly, mash more (CPU fights stuck 22 s → 16 s at 0.05).
 */
const ROBOT_RESTITUTION = 0.05;
/** A tyre's side wall against another robot: grippy, but not wheel-on-floor grippy. */
const TYRE_SIDE_GRIP = 0.55;
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
  /** Recent chassis velocities (a ring), and the worst jolt of the impact in progress. */
  private velRing: V3[] = [];
  private velAt = 0;
  private shockPeak = 0;
  private springs: Array<{ child: BodyInfo; parent: BodyInfo; axis: V3; anchor: V3; joint: 'hinge' | 'slider'; stiffness: number; damping: number }> = [];
  /** Chainsaws fitted, and whether each is running. */
  readonly chains: Array<{ part: Part; def: ChainDef; on: boolean; toggled: boolean; wasPressed: boolean }> = [];
  /** Multiplies all damage this robot takes — impacts, cuts, shock and heat (the Brutal damage setting). */
  damageScale = 1;
  /** Flamethrowers fitted, and whether each is lit right now. */
  readonly flames: Array<{ part: Part; def: Extract<NonNullable<PartDef['component']>, { type: 'flamethrower' }>; dir: V3; fuel: number; on: boolean; toggled: boolean; wasPressed: boolean }> = [];

  /** Cannons and harpoon guns fitted. */
  readonly launchers: Launcher[] = [];
  /** Seconds this robot has existed (for timing rounds in flight). */
  private clock = 0;

  /** Lit flamethrowers: nozzle position, direction and reach, world space. */
  activeFlames(): Array<{ origin: V3; dir: V3; range: number }> {
    return this.flames.filter((f) => f.on && f.part.collider && f.part.body).map((f) => ({
      origin: f.part.collider!.translation(),
      dir: qrotate(f.part.body!.rotation(), f.dir),
      range: f.def.range,
    }));
  }

  constructor(world: RAPIER.World, design: RobotDesign, index: number, position: V3, yaw: number) {
    this.world = world;
    this.design = design;
    this.index = index;
    this.groups = robotGroups(index);
    registerCatalog(design);
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
    for (const p of ordered) this.makePart(p, this.bodies_.get(bodyOf(p))!, frames.get(p.id)!, paint);
    this.gasLeft = this.gasCapacity;

    // Joints and the motors / rams / servos on them.
    for (const p of ordered) {
      if (p.parent === null || p.joint.type === 'fixed') continue;
      const child = this.bodies_.get(p.id)!;
      const parent = child.parent!;
      const f = frames.get(p.id)!;
      const anchor = vsub(child.origin, parent.origin);
      if (p.joint.type === 'ball') {
        child.joint = world.createImpulseJoint(RAPIER.JointData.spherical(anchor, { x: 0, y: 0, z: 0 }), parent.body, child.body, true);
        continue;
      }
      const axis = qrotate(f.rot, unit(p.joint.axis));
      const jd = p.joint.type === 'hinge' ? RAPIER.JointData.revolute(anchor, { x: 0, y: 0, z: 0 }, axis) : RAPIER.JointData.prismatic(anchor, { x: 0, y: 0, z: 0 }, axis);
      const joint = world.createImpulseJoint(jd, parent.body, child.body, true) as RAPIER.RevoluteImpulseJoint;
      let limits: [number, number] | null = null;
      if (p.joint.type === 'hinge' && p.joint.limits) limits = [p.joint.limits[0] * Math.PI / 180, p.joint.limits[1] * Math.PI / 180];
      if (p.joint.type === 'slider') limits = [p.joint.limits[0] / 1000, p.joint.limits[1] / 1000];
      if (limits) joint.setLimits(limits[0], limits[1]);
      child.joint = joint;
      const a = p.joint.actuator;
      if (a) this.addActuator(p, a, child, parent, axis, anchor, limits);
      if (p.joint.spring) {
        const k = p.joint.type === 'hinge' ? 180 / Math.PI : 1000;
        this.springs.push({ child, parent, axis, anchor, joint: p.joint.type, stiffness: p.joint.spring.stiffness * k, damping: p.joint.spring.damping * k });
      }
    }

    for (const p of ordered) if (p.launch) this.addLauncher(design, p, p.launch, frames, paint, toWorld(this.bodies_.get(p.id)!.origin), spawnRot);

    // Hard-metal parts of a spinning weapon are its teeth: they cut.
    for (const a of this.actuators) {
      if (a.def.type !== 'motor' || a.locomotion) continue;
      for (const q of this.parts) {
        if (q.bodyKey !== a.child.key || q.kind !== 'structure' || q.def?.edge) continue;
        if (hardnessOf(material(q.material)) >= 200) q.edge = 'blade';
      }
    }
    // Saws and spikes work with light, steady contact too: report it.
    for (const q of this.parts) {
      if (q.edge !== 'saw' && q.edge !== 'spike') continue;
      for (const c of this.collidersOf(q)) c.setContactForceEventThreshold(CUT.EVENT_THRESHOLD);
    }

    // Speed controllers, radio and wiring, in the chassis.
    this.electronicsPart = this.addPart({ id: 'electronics', label: 'Speed controllers & radio', kind: 'electronics', local: { x: 0, y: 0, z: 0 }, bodyKey: rootPart.id, internal: true, toughness: COMPONENT_TOUGHNESS, material: 'aluminium', thickness: 2, edge: 'blunt' });
    this.electronicsPart.body = this.chassis;
    const em = electronicsMass(design);
    this.attach(this.electronicsPart, RAPIER.ColliderDesc.ball(Math.cbrt((3 * em) / (4 * Math.PI * 2500))).setMass(em), this.chassis, GHOST_GROUPS);
  }

  /** Build one design part's colliders on a body (`id` renames it: spare rounds). */
  private makePart(p: PartDef, info: BodyInfo, f: { pos: V3; rot: Q }, paint: number, id?: string): Part {
    const rs = resolveShape(p);
    const centre = vsub(vadd(f.pos, qrotate(f.rot, rs.offset)), info.origin);
    const rot = qmul(f.rot, rs.rot);
    const part = this.addPart({
      id: id ?? p.id, label: p.label, kind: p.role, def: p, local: centre, bodyKey: info.key,
      internal: p.role === 'component',
      material: p.role === 'wheel' ? 'rubber' : p.role === 'component' ? 'aluminium' : p.material ?? 'aluminium',
      thickness: p.role === 'structure' ? p.wall ?? solidThickness(rs.shape) : 4,
      edge: p.role === 'structure' ? p.edge ?? 'blunt' : 'blunt',
      toughness: p.role === 'wheel' ? WHEEL_TOUGHNESS : p.role === 'component' ? COMPONENT_TOUGHNESS
        : plateToughness(p.material ?? 'aluminium', p.wall ?? solidThickness(rs.shape), faceArea(rs.shape)),
      visual: { shape: rs.shape, pos: centre, rot },
      colour: p.colour ? hex(p.colour) : p.role === 'wheel' ? 0x1b1b1b : p.role === 'component' ? 0x2c3036
        : p.material && ['ptfe', 'rubber', 'hardox', 'titanium', 'mildSteel'].includes(p.material) && p.parent !== null ? material(p.material).colour : paint,
    });
    part.body = info.body;
    if (p.role === 'wheel') {
      const spec = lookup(WHEELS, p.wheel!, 'wheel');
      // Rapier's cylinder-on-box contact makes resting wheels creep, so the
      // floor sees a sphere of the same radius; other robots see the cylinder.
      this.attachShape(part, rs.shape, centre, rot, partMass(p), info.body, wheelBodyGroups(this.index), Math.min(spec.grip, TYRE_SIDE_GRIP), ROBOT_RESTITUTION);
      part.tyre = this.world.createCollider(
        RAPIER.ColliderDesc.ball(spec.radius).setTranslation(centre.x, centre.y, centre.z).setMass(0.01).setFriction(spec.grip).setRestitution(0.05)
          .setCollisionGroups(wheelTyreGroups(this.index))
          .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(DAMAGE.EVENT_THRESHOLD),
        info.body,
      );
      this.byCollider.set(part.tyre.handle, part);
    } else if (p.role === 'component') {
      this.attachShape(part, rs.shape, centre, rot, partMass(p), info.body, GHOST_GROUPS, 0.4, 0.1);
      if (p.component!.type === 'battery') this.batteryParts.push(part);
      if (p.component!.type === 'flamethrower') {
        const c = p.component!;
        this.flames.push({ part, def: c, dir: qrotate(f.rot, { x: 0, y: 0, z: 1 }), fuel: c.fuel, on: false, toggled: false, wasPressed: false });
        // The nozzle is out in the open, not behind armour.
        part.internal = false;
      }
      if (p.component!.type === 'gasTank') {
        this.tankParts.push(part);
        this.gasCapacity += lookup(TANKS, p.component!.part, 'tank').capacity;
      }
    } else {
      this.attachShape(part, rs.shape, centre, rot, partMass(p), info.body, this.groups, material(p.material ?? 'aluminium').friction, ROBOT_RESTITUTION);
      if (p.chain && p.edge === 'saw') this.chains.push({ part, def: p.chain, on: false, toggled: false, wasPressed: false });
    }
    return part;
  }

  private addActuator(p: PartDef, def: ActuatorDef, child: BodyInfo, parent: BodyInfo, axis: V3, anchor: V3, limits: [number, number] | null) {
    const driven = this.parts.find((q) => q.id === p.id)!;
    const what = def.type === 'pneumatic' ? 'ram' : def.type === 'servo' ? 'servo' : 'motor';
    const mass = actuatorMass(def);
    // The motor or ram sits on the parent body at the joint.
    const part = this.addPart({ id: `${p.id}-act`, label: `${p.label} ${what}`, kind: 'actuator', local: anchor, bodyKey: parent.key, internal: true, toughness: COMPONENT_TOUGHNESS, material: 'mildSteel', thickness: 4, edge: 'blunt' });
    part.body = parent.body;
    this.attach(part, RAPIER.ColliderDesc.ball(Math.cbrt((3 * mass) / (4 * Math.PI * 3000))).setTranslation(anchor.x, anchor.y, anchor.z).setMass(mass), parent.body, GHOST_GROUPS);
    const act: Actuator = {
      def, joint: p.joint.type as 'hinge' | 'slider', driven, part, child, parent, axis, anchor, limits,
      area: 0, gasPerShot: 0, timeConstant: 0.05, maxRate: Infinity,
      toggled: false, wasPressed: false, firing: false, fireTime: 0, shotScale: 1, speed: 0, position: 0, ramp: 0,
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

  /**
   * Fit a launcher: the round already built on its slider is the first; the
   * spares are built now as copies, parked (disabled) until loaded. Their
   * mass, the cable and the winch ride on the mount as one weight.
   */
  private addLauncher(d: RobotDesign, p: PartDef, l: LaunchDef, frames: Map<string, { pos: V3; rot: Q }>, paint: number, at: V3, rot: Q) {
    const act = this.actuators.find((a) => a.driven.id === p.id);
    if (!act || act.def.type !== 'pneumatic' || act.joint !== 'slider') return;
    const group = rigidGroup(d, p.id);
    const first: Round = { info: act.child, parts: this.parts.filter((q) => q.bodyKey === act.child.key), firedAt: 0, embed: null };
    const spares: Round[] = [];
    for (let k = 1; k <= (l.rounds ?? 0); k++) {
      const key = `${p.id}~${k}`;
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y, at.z).setRotation(rot)
        .setLinearDamping(AIR_DAMPING).setAngularDamping(0.01).setCcdEnabled(true).setEnabled(false));
      const info: BodyInfo = { key, body, parent: act.parent, origin: act.child.origin, joint: null, detached: true };
      this.bodies_.set(key, info);
      const parts = group.map((id) => this.makePart(d.parts.find((q) => q.id === id)!, info, frames.get(id)!, paint, `${id}~${k}`));
      for (const q of parts) q.detached = true;
      spares.push({ info, parts, firedAt: 0, embed: null });
    }
    const x = launcherExtras(d, p, l);
    const mass = Math.max(0.01, x.spares + x.cable + x.winch);
    const what = l.tether?.winch ? 'winch' : l.tether ? 'cable reel' : 'magazine';
    const mount = this.addPart({ id: `${p.id}-mount`, label: `${p.label} ${what}`, kind: 'actuator', local: act.anchor, bodyKey: act.parent.key, internal: true, toughness: COMPONENT_TOUGHNESS, material: 'mildSteel', thickness: 4, edge: 'blunt' });
    mount.body = act.parent.body;
    this.attach(mount, RAPIER.ColliderDesc.ball(Math.cbrt((3 * mass) / (4 * Math.PI * 4000))).setTranslation(act.anchor.x, act.anchor.y, act.anchor.z).setMass(mass), act.parent.body, GHOST_GROUPS);
    const stroke = act.limits ? act.limits[1] : 0;
    this.launchers.push({
      def: l, partDef: p, act, loaded: first, spares, reloadIn: 0, fired: [], mount,
      anchor: act.anchor, muzzle: vadd(act.anchor, vscale(act.axis, stroke)),
      cable: null, winch: l.tether?.winch ? { def: { input: l.tether.winch.input }, toggled: false, wasPressed: false, speed: 0 } : null, wasPressed: false,
    });
  }

  /** Rounds still to fire: the one in the barrel plus spares. */
  roundsLeft(l: Launcher): number {
    return (l.loaded ? 1 : 0) + l.spares.length;
  }

  /** Is this part (any part of) a cannon round or harpoon — loaded, spare or fired? Ammunition, not robot. */
  isAmmo(part: Part): boolean {
    return this.launchers.some((l) => l.loaded?.parts.includes(part) || l.spares.some((r) => r.parts.includes(part)) || l.fired.some((r) => r.parts.includes(part)));
  }

  /** Is this one of our rounds out of the barrel? */
  roundOf(part: Part): Round | null {
    for (const l of this.launchers) for (const r of l.fired) if (r.parts.includes(part)) return r;
    return null;
  }

  /** Cables between launchers and their rounds, world space, for drawing. */
  cables(): Array<{ from: V3; to: V3; taut: boolean }> {
    return this.launchers.flatMap((l) => (l.cable ? [{ from: this.mountPoint(l, l.muzzle), to: l.cable.round.info.body.translation(), taut: l.cable.taut }] : []));
  }

  private mountPoint(l: Launcher, local: V3): V3 {
    const b = l.act.parent.body;
    return vadd(b.translation(), qrotate(b.rotation(), local));
  }

  /** Fire, reload, cut the cable, and run the winch. Returns current drawn (A). */
  private updateLaunchers(c: ControlState, voltage: number, dt: number): number {
    let amps = 0;
    for (const l of this.launchers) {
      const a = l.act;
      const held = this.buttonHeld(a.def.input, c);
      const pressed = held && !l.wasPressed;
      l.wasPressed = held;
      const mountOk = !l.act.parent.detached && !l.mount.failed;
      // Knocked out of the barrel by a hit: that round's lost; load another.
      if (l.loaded && !l.loaded.info.joint) {
        l.loaded.firedAt = this.clock;
        l.fired.push(l.loaded);
        l.loaded = null;
        l.reloadIn = l.def.reload ?? LAUNCH.RELOAD;
      }
      // Out of the barrel at the end of the stroke — let go the step before
      // it would reach the end stop, or the stop would catch it.
      if (l.loaded && a.child.joint && a.firing && a.limits && a.position + Math.max(0, a.speed) * dt >= a.limits[1] - LAUNCH.RELEASE) this.release(l);
      // Second press with the harpoon out: cut it loose.
      else if (!l.loaded && pressed && l.cable) this.cutCable(l);
      for (const r of l.fired) {
        if (r === l.cable?.round || this.clock - r.firedAt < LAUNCH.SAFE_TIME) continue;
        // Clear of the robot that fired it: ordinary debris now.
        for (const q of r.parts) for (const col of this.collidersOf(q)) if (col.collisionGroups() !== DEBRIS_GROUPS) col.setCollisionGroups(DEBRIS_GROUPS);
      }
      // Load the next round.
      if (!l.loaded && !l.cable && l.spares.length && mountOk) {
        l.reloadIn -= dt;
        if (l.reloadIn <= 0) this.seat(l, l.spares.shift()!);
      }
      if (l.cable && l.winch) amps += this.runWinch(l, c, voltage, dt, mountOk);
      else if (l.cable) this.spool(l, false);
    }
    return amps;
  }

  /** Let the round go: it flies on with the speed the ram gave it. */
  private release(l: Launcher) {
    const r = l.loaded!;
    const a = l.act;
    if (r.info.joint) { this.world.removeImpulseJoint(r.info.joint, true); r.info.joint = null; }
    r.info.detached = true;
    for (const q of r.parts) q.detached = true;
    r.firedAt = this.clock;
    l.fired.push(r);
    l.loaded = null;
    l.reloadIn = l.def.reload ?? LAUNCH.RELOAD;
    a.firing = false;
    const t = l.def.tether;
    if (t) {
      // The drum free-spools: cable pays out as far as the round flies.
      l.cable = { round: r, joint: null, length: 0, jointLength: -1, taut: false };
      this.setRope(l, t.length);
    }
    this.updateMountMass(l);
  }

  /** Put a round in the barrel at its built position, on a fresh slider joint. */
  private seat(l: Launcher, r: Round) {
    const a = l.act;
    const pb = a.parent.body;
    const pos = vadd(pb.translation(), qrotate(pb.rotation(), l.anchor));
    const b = r.info.body;
    if (r.embed) { this.world.removeImpulseJoint(r.embed, true); r.embed = null; }
    b.setEnabled(true);
    b.setTranslation(pos, true);
    b.setRotation(pb.rotation(), true);
    const v = pb.velocityAtPoint(pos);
    b.setLinvel(v, true);
    b.setAngvel(pb.angvel(), true);
    const joint = this.world.createImpulseJoint(RAPIER.JointData.prismatic(l.anchor, { x: 0, y: 0, z: 0 }, a.axis), pb, b, true) as RAPIER.PrismaticImpulseJoint;
    if (a.limits) joint.setLimits(a.limits[0], a.limits[1]);
    r.info.joint = joint;
    r.info.detached = false;
    for (const q of r.parts) {
      q.detached = false;
      for (const col of this.collidersOf(q)) col.setCollisionGroups(this.groups);
    }
    l.fired = l.fired.filter((x) => x !== r);
    a.child = r.info;
    a.driven = r.parts[0];
    a.firing = false;
    a.position = 0;
    a.speed = 0;
    l.loaded = r;
    this.updateMountMass(l);
  }

  private cutCable(l: Launcher) {
    if (!l.cable) return;
    if (l.cable.joint) this.world.removeImpulseJoint(l.cable.joint, true);
    l.cable = null;
    this.emit('cuts its harpoon loose', 'info');
  }

  /** (Re)build the rope joint: the most cable that can be out right now. */
  private setRope(l: Launcher, length: number) {
    const cab = l.cable!;
    if (cab.joint) this.world.removeImpulseJoint(cab.joint, true);
    cab.joint = this.world.createImpulseJoint(RAPIER.JointData.rope(length, l.muzzle, { x: 0, y: 0, z: 0 }), l.act.parent.body, cab.round.info.body, true);
    cab.jointLength = length;
  }

  /**
   * Cable geometry this step. Not winding in, the drum free-spools: cable
   * pays out to follow the round (up to its full length) and the rope only
   * stops it at the end. Winding in, the drum ratchets: the rope is held at
   * what's been wound in so far.
   */
  private spool(l: Launcher, reeling: boolean): { A: V3; B: V3; d: number; dir: V3 } {
    const cab = l.cable!;
    const max = l.def.tether!.length;
    const A = this.mountPoint(l, l.muzzle), B = cab.round.info.body.translation();
    const span = vsub(B, A);
    const d = vlen(span);
    const dir = d > 1e-6 ? vscale(span, 1 / d) : { x: 0, y: 1, z: 0 };
    if (!reeling) cab.length = Math.min(max, Math.max(cab.length, d));
    cab.taut = d >= cab.length - 0.02;
    const want = reeling ? cab.length : max;
    if (Math.abs(want - cab.jointLength) > LAUNCH.ROPE_STEP) this.setRope(l, want);
    return { A, B, d, dir };
  }

  /**
   * The winch: a DC motor through a gearbox onto a drum. Taut, it pulls with
   * torque × gear ÷ drum radius at whatever speed the load allows (the motor
   * model does the torque/speed trade-off), on both ends of the cable — so a
   * light robot reels itself towards a heavy one as much as the other way.
   * Slack, it just winds in at its free speed. −1 lets the drum free-spool.
   */
  private runWinch(l: Launcher, c: ControlState, voltage: number, dt: number, mountOk: boolean): number {
    const cab = l.cable!, w = l.def.tether!.winch!, st = l.winch!;
    const cmd = Math.max(-1, Math.min(1, this.command(st, c)));
    const reeling = cmd > 1e-3 && this.powered && mountOk;
    if (!reeling) { st.speed = 0; this.spool(l, false); return 0; }
    const motor = lookup(MOTORS, w.motor, 'motor');
    const r = w.drum / 1000;
    const health = 0.3 + 0.7 * l.mount.condition;
    const { A, B, d, dir } = this.spool(l, true);
    let amps: number;
    if (cab.taut) {
      // Drum speed from how fast the ends are closing.
      const sep = vdot(vsub(cab.round.info.body.velocityAtPoint(B), l.act.parent.body.velocityAtPoint(A)), dir);
      st.speed = -sep / r;
      const out = dcMotor(motor, voltage, cmd, st.speed * w.gear, health);
      const tension = Math.max(0, (out.torque * w.gear * GEARBOX.efficiency) / r);
      const imp = vscale(dir, tension * dt);
      cab.round.info.body.applyImpulseAtPoint(vscale(imp, -1), B, true);
      l.act.parent.body.applyImpulseAtPoint(imp, A, true);
      amps = out.current;
      cab.length = Math.max(0.05, Math.min(cab.length, d));
    } else {
      // Slack: the drum takes it in at free speed.
      const free = (motor.freeSpeed * RPM_TO_RADS * (voltage / motor.voltage) * health) / w.gear;
      st.speed = free * cmd;
      cab.length = Math.max(d, cab.length - free * r * cmd * dt);
      amps = motor.freeCurrent * cmd;
    }
    // Back at the muzzle and not stuck in anything: it drops back into the barrel.
    if (d < LAUNCH.REDOCK && !cab.round.embed) {
      const round = cab.round;
      if (cab.joint) this.world.removeImpulseJoint(cab.joint, true);
      l.cable = null;
      this.seat(l, round);
    }
    return amps;
  }

  /** A pointed round has gone into `target`'s plate: weld it there where it is. */
  embed(r: Round, target: RAPIER.RigidBody) {
    if (r.embed) return;
    const b = r.info.body;
    const p = b.translation(), q = b.rotation();
    const tq = target.rotation();
    const local = qrotate(qconj(tq), vsub(p, target.translation()));
    r.embed = this.world.createImpulseJoint(RAPIER.JointData.fixed({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, local, qmul(qconj(tq), q)), b, target, true);
  }

  private updateMountMass(l: Launcher) {
    const d = this.design;
    const x = launcherExtras(d, l.partDef, l.def);
    const per = l.def.rounds ? x.spares / l.def.rounds : 0;
    l.mount.collider?.setMass(Math.max(0.01, per * l.spares.length + x.cable + x.winch));
  }

  private addPart(p: Omit<Part, 'condition' | 'failed' | 'collider' | 'extra' | 'body' | 'exposed' | 'detached' | 'announced'>): Part {
    const part: Part = { ...p, condition: 1, failed: false, collider: null, extra: [], body: null, exposed: false, detached: false, announced: 1 };
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

  /** Colliders for every convex piece of a shape, sharing the part's mass by volume. */
  private attachShape(part: Part, shape: Shape, centre: V3, rot: Q, mass: number, body: RAPIER.RigidBody, groups: number, friction: number, restitution: number) {
    const pieces = convexPieces(shape);
    const vols = pieces.map(pieceVolume);
    const total = vols.reduce((a, b) => a + b, 0) || 1;
    pieces.forEach((piece, i) => {
      const { desc, offset } = pieceCollider(piece);
      const at = vadd(centre, qrotate(rot, offset));
      const m = Math.max(1e-4, (mass * vols[i]) / total);
      desc.setTranslation(at.x, at.y, at.z).setRotation(rot).setFriction(friction).setRestitution(restitution)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
      // Rapier's own mass properties go wrong for very flat hulls; use ours.
      const mp = pieceMassProps(piece);
      if (mp) {
        const { values, frame } = principalAxes(mp.inertia);
        const floor = 1e-9;
        desc.setMassProperties(m, { x: mp.com[0], y: mp.com[1], z: mp.com[2] }, { x: Math.max(floor, values.x * m), y: Math.max(floor, values.y * m), z: Math.max(floor, values.z * m) }, frame);
      } else {
        desc.setMass(m);
      }
      desc.setCollisionGroups(groups);
      if (groups !== GHOST_GROUPS) desc.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(DAMAGE.EVENT_THRESHOLD);
      const c = this.world.createCollider(desc, body);
      this.byCollider.set(c.handle, part);
      if (i === 0) part.collider = c; else part.extra.push(c);
    });
  }

  /** All of a part's colliders. */
  collidersOf(p: Part): RAPIER.Collider[] {
    return p.collider ? [p.collider, ...p.extra] : [...p.extra];
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
  buttonUses(): Map<string, Set<ButtonUse>> {
    const out = new Map<string, Set<ButtonUse>>();
    const use = (src: string, kind: ButtonUse) => {
      if (!src.startsWith('button')) return;
      if (!out.has(src)) out.set(src, new Set());
      out.get(src)!.add(kind);
    };
    for (const l of this.launchers) {
      if (l.act.parent.detached) continue;
      // A harpoon that's out: the same button cuts it loose.
      use(l.act.def.input.source, l.def.tether ? (l.cable ? 'cut' : 'harpoon') : 'cannon');
      if (l.winch && (l.cable || l.def.tether)) use(l.winch.def.input.source, 'winch');
    }
    for (const ch of this.chains) {
      const src = ch.def.input.source;
      if (!src.startsWith('button') || ch.part.detached) continue;
      if (!out.has(src)) out.set(src, new Set());
      out.get(src)!.add('chain');
    }
    for (const a of this.actuators) {
      if (!a.def.input.source.startsWith('button') || !a.child.joint || this.launchers.some((l) => l.act === a)) continue;
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
    for (const sp of this.springs) {
      if (!sp.child.joint) continue;
      const m = measure(sp);
      const f = -sp.stiffness * m.position - sp.damping * m.speed;
      if (sp.joint === 'hinge') {
        const t = vscale(m.axis, f * dt);
        sp.child.body.applyTorqueImpulse(t, true);
        sp.parent.body.applyTorqueImpulse(vscale(t, -1), true);
      } else {
        const imp = vscale(m.axis, f * dt), at = sp.child.body.translation();
        sp.child.body.applyImpulseAtPoint(imp, at, true);
        sp.parent.body.applyImpulseAtPoint(vscale(imp, -1), at, true);
      }
    }
    for (const ch of this.chains) {
      const want = this.command(ch, c) > 0.5;
      ch.on = want && this.powered && !ch.part.failed && !ch.part.detached;
      if (ch.on) amps += 45;
    }
    for (const fl of this.flames) {
      const want = this.command(fl, c) > 0.5;
      fl.on = want && this.powered && fl.fuel > 0 && !fl.part.failed && !fl.part.detached;
      if (fl.on) fl.fuel = Math.max(0, fl.fuel - 0.06 * dt);
    }
    amps += this.updateLaunchers(c, voltage, dt);
    this.clock += dt;
    for (const t of this.tankParts) if (t.condition < 0.5 && this.gasLeft > 0) this.gasLeft = Math.max(0, this.gasLeft - 40 * (1 - t.condition / 0.5) * dt);
    // The battery can only give so much; beyond that the voltage sags.
    this.current = Math.min(amps, this.battery.maxCurrent);
    this.energy = Math.max(0, this.energy - (voltage * this.current * dt) / 3600);
  }

  /** Is this input's weapon button down? `c` is what the receiver is passing on (nothing, with no radio). */
  private buttonHeld(input: InputDef, c: ControlState = this.hasControl ? this.control : NEUTRAL_CONTROL): boolean {
    return { button1: c.weapon, button2: c.weapon2, button3: !!c.weapon3, button4: !!c.weapon4 }[input.source as 'button1'] ?? false;
  }

  /** The actuator's command: −1..1 for analog/gait inputs, 0/1 for buttons. */
  private command(a: { def: { input: InputDef }; toggled: boolean; wasPressed: boolean }, c: ControlState): number {
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
        const held = this.buttonHeld(i, c);
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
      let throttle = Math.max(-1, Math.min(1, cmd));
      const soft = a.def.softStart ?? 0;
      if (soft > 0) {
        // Ramp up gently; easing off or letting go is immediate.
        const rising = Math.abs(throttle) > Math.abs(a.ramp) && (a.ramp === 0 || Math.sign(throttle) === Math.sign(a.ramp));
        a.ramp = rising ? a.ramp + Math.sign(throttle) * Math.min(dt / soft, Math.abs(throttle) - Math.abs(a.ramp)) : throttle;
        throttle = a.ramp;
      }
      const out = dcMotor(a.motor!, voltage, throttle, a.speed * a.def.gear, health, a.locomotion);
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
    if (a.ram!.hydraulic) {
      // Hydraulic: the pump makes pressure for as long as there's power.
      if (pressed && !a.firing) { a.firing = true; a.fireTime = 0; a.shotScale = 1; }
    } else if (pressed && !a.firing && this.gasLeft > 0 && !this.tankParts.every((t) => t.failed)) {
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
    if (a.ram!.hydraulic) return a.firing ? (a.ram!.pumpCurrent ?? 60) * Math.min(1, 0.3 + Math.abs(a.speed)) : 0;
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
    energy *= this.damageScale;
    prior *= this.damageScale;
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

  /**
   * Steady wear at a contact point — a saw cutting, a spike piercing. Takes
   * `loss` of condition straight off the part (no elastic threshold) and
   * passes some on to the internals right behind it. Returns condition lost.
   */
  cut(part: Part, loss: number, point: V3): number {
    if (part.detached || part.failed || loss <= 0) return 0;
    loss *= this.damageScale;
    let total = 0;
    const take = (q: Part, l: number) => { const c = q.condition; q.condition = Math.max(0, c - l); total += c - q.condition; };
    take(part, loss);
    if (part.kind !== 'structure') return total;
    // Once a cut is through (the plate's in a bad way), it gets into what's behind.
    const through = 0.15 + 0.85 * (1 - Math.max(0, part.condition));
    const body = this.bodies_.get(part.bodyKey);
    const local = body ? this.toBodyLocal(point, body.body) : part.local;
    for (const q of this.parts) {
      if (!q.internal || q.failed || q.bodyKey !== part.bodyKey) continue;
      const d = vlen(vsub(local, q.local));
      if (d > DAMAGE.TRANSMIT_RADIUS * 0.8) continue;
      take(q, loss * 0.35 * through * (1 - d / (DAMAGE.TRANSMIT_RADIUS * 0.8)));
    }
    return total;
  }

  /** Move the whole robot (everything still attached) by `d`, and stop it dead. */
  shift(d: V3) {
    for (const b of this.bodies_.values()) {
      if (b.detached) continue;
      const t = b.body.translation();
      b.body.setTranslation({ x: t.x + d.x, y: t.y + d.y, z: t.z + d.z }, true);
      b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  /** Is this part's chainsaw running? */
  chainRunning(part: Part): number {
    const ch = this.chains.find((c) => c.part === part);
    return ch?.on ? ch.def.speed : 0;
  }

  /**
   * After each physics step: how hard did the chassis just get jolted? When an
   * impact is over, its worst jolt shakes up the internals.
   */
  measureShock(dt: number): number {
    const v = this.chassis.linvel();
    const n = SHOCK.WINDOW;
    if (this.velRing.length < n) { this.velRing.push(v); return 0; }
    const old = this.velRing[this.velAt];
    this.velRing[this.velAt] = v;
    this.velAt = (this.velAt + 1) % n;
    const t = n * dt;
    const jolt = Math.hypot(v.x - old.x, v.y - old.y + 9.81 * t, v.z - old.z);
    if (jolt > SHOCK.FREE) { this.shockPeak = Math.max(this.shockPeak, jolt); return 0; }
    const peak = this.shockPeak;
    this.shockPeak = 0;
    return peak > 0 ? this.shock(peak) : 0;
  }

  /** Internals rattled by a jolt of `dv` m/s. Returns the condition lost. */
  shock(dv: number): number {
    const k = SHOCK.K * (dv - SHOCK.FREE) ** 2 * this.damageScale;
    if (k <= 0) return 0;
    let loss = 0;
    for (const q of this.parts) {
      if (q.detached || q.failed) continue;
      const c = q.def?.component?.type;
      const sens = q.kind === 'electronics' ? SHOCK.electronics : q.kind === 'actuator' ? SHOCK.actuator : c ? SHOCK[c] : 0;
      if (!sens) continue;
      const before = q.condition;
      q.condition = Math.max(0, q.condition - k * sens);
      loss += before - q.condition;
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
    rate *= this.damageScale;
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
        for (const c of this.collidersOf(q)) c.setCollisionGroups(DEBRIS_GROUPS);
      }
      this.exposeNear(p);
      return true;
    }
    if (!p.collider || p.kind !== 'structure' || !p.visual) return false;
    // A fixed part: recreate it as its own body where it was.
    const br = info.body.rotation();
    const pos = vadd(info.body.translation(), qrotate(br, p.visual.pos));
    const rot = qmul(br, p.visual.rot);
    const vel = info.body.velocityAtPoint(pos);
    for (const c of this.collidersOf(p)) { this.byCollider.delete(c.handle); this.world.removeCollider(c, true); }
    p.collider = null;
    p.extra = [];
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setRotation(rot).setLinvel(vel.x, vel.y, vel.z));
    p.body = body;
    p.detached = true;
    p.visual = { shape: p.visual.shape, pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0, w: 1 } };
    this.attachShape(p, p.visual.shape, p.visual.pos, p.visual.rot, partMass(p.def!), body, DEBRIS_GROUPS, 0.4, 0.1);
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
      for (const c of this.collidersOf(q)) {
        c.setCollisionGroups(this.groups);
        c.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
        c.setContactForceEventThreshold(DAMAGE.EVENT_THRESHOLD);
      }
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
        for (const c of [q.tyre, ...this.collidersOf(q)]) {
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

/** A Rapier collider for one convex piece, and where it sits in the shape frame. */
function pieceCollider(p: Piece): { desc: RAPIER.ColliderDesc; offset: V3 } {
  const zero = { x: 0, y: 0, z: 0 };
  if (p.kind === 'box') return { desc: RAPIER.ColliderDesc.cuboid(p.half[0], p.half[1], p.half[2]), offset: { x: p.centre[0], y: p.centre[1], z: p.centre[2] } };
  if (p.kind === 'hull') {
    const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(p.points.flat()));
    if (!desc) throw new Error('A shape needs some thickness: its points are all flat or there are fewer than 4.');
    return { desc, offset: zero };
  }
  const s = p.shape;
  switch (s.type) {
    case 'box': return { desc: RAPIER.ColliderDesc.cuboid(s.size[0] / 2, s.size[1] / 2, s.size[2] / 2), offset: zero };
    case 'cylinder': return { desc: RAPIER.ColliderDesc.cylinder(s.length / 2, s.radius), offset: zero };
    case 'cone': return { desc: RAPIER.ColliderDesc.cone(s.length / 2, s.radius), offset: zero };
    case 'sphere': return { desc: RAPIER.ColliderDesc.ball(s.radius), offset: zero };
    case 'capsule': return { desc: RAPIER.ColliderDesc.capsule(s.length / 2, s.radius), offset: zero };
  }
}

function pieceVolume(p: Piece): number {
  if (p.kind === 'box') return 8 * p.half[0] * p.half[1] * p.half[2];
  if (p.kind === 'prim') return shapeVolume(p.shape);
  return Math.max(1e-9, hullMetrics(p.points).volume);
}

const hex = (c: string): number => parseInt(c.slice(1), 16);
const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/** Joint position and speed (rad or m, rad/s or m/s) and its world axis. */
function measure(j: { child: { body: RAPIER.RigidBody }; parent: { body: RAPIER.RigidBody }; axis: V3; anchor: V3; joint: 'hinge' | 'slider' }) {
  const pRot = j.parent.body.rotation();
  const axis = qrotate(pRot, j.axis);
  if (j.joint === 'hinge') {
    return { axis, speed: vdot(vsub(j.child.body.angvel(), j.parent.body.angvel()), axis), position: twistAngle(qmul(qconj(pRot), j.child.body.rotation()), j.axis) };
  }
  const rel = qrotate(qconj(pRot), vsub(j.child.body.translation(), j.parent.body.translation()));
  return { axis, position: vdot(vsub(rel, j.anchor), j.axis), speed: vdot(vsub(j.child.body.linvel(), j.parent.body.linvel()), axis) };
}
