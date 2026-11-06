import type { Material } from '../data/materials';
import type { BatterySpec, MotorSpec, RamSpec, TankSpec, ValveSpec, WheelSpec } from '../data/parts';

/**
 * RobotDesign v2: a robot is a tree of parts. Each part has a shape and a
 * material (or is a catalogue component), sits somewhere on its parent, and
 * is attached by a joint — fixed, a hinge, or a slider. Any hinge or slider
 * can carry an actuator (DC motor, pneumatic ram, or position servo) wired
 * to one of the robot's control inputs.
 *
 * That's enough to describe wedges, flippers, spinners, full-body spinners,
 * twin flippers, rolling spheres, walkers, axes, lifters, clampers… anything
 * that's rigid bits, joints and motors.
 *
 * Frames: robot +Z forward, +Y up, +X left; origin on the floor at the
 * centre. Each part's position/rotation is relative to its parent part's
 * frame (the root's is relative to the robot origin). Rotations are Euler
 * angles in degrees, applied X then Y then Z. Lengths in metres unless a
 * field says mm.
 */

export type Vec3 = [number, number, number];

export type Shape =
  | { type: 'box'; size: Vec3 }
  /** Full height at the back (−Z), sloping down to `lip` at the front (+Z). */
  | { type: 'wedge'; size: Vec3; lip: number }
  /** Axis along the part's Y. */
  | { type: 'cylinder'; radius: number; length: number }
  /** Axis along Y, point at +Y. */
  | { type: 'cone'; radius: number; length: number }
  | { type: 'sphere'; radius: number }
  /** Straight section `length` long along Y, rounded ends. */
  | { type: 'capsule'; radius: number; length: number }
  /**
   * Armour shell: a box whose upper edges are cut back, like real sloped
   * armour. Sides rise vertically to `belt` (0 = floor, 1 = top) of the
   * height, then slope in by `sides` (each side); the top front and rear
   * edges are set back by `front` and `rear`. All in metres.
   */
  | { type: 'armour'; size: Vec3; sides: number; front: number; rear: number; belt: number }
  /** Convex hull of arbitrary points. */
  | { type: 'hull'; points: Vec3[] }
  /**
   * Any 2D outline (concave is fine — hooks, claws, teeth), extruded `depth`.
   * 'top': drawn from above (u = left, v = forward), extruded up.
   * 'side': drawn side-on (u = forward, v = up), extruded across.
   * 'front': drawn face-on (u = left, v = up), extruded front-to-back.
   */
  | { type: 'extrude'; outline: Array<[number, number]>; depth: number; plane?: 'top' | 'side' | 'front' }
  /** Solid of revolution about the part's Y: profile points are [radius, height]. */
  | { type: 'lathe'; profile: Array<[number, number]>; segments?: number }
  /** Any triangle mesh (e.g. an imported STL/OBJ). Physics uses voxel boxes `voxel` m across. */
  | { type: 'mesh'; vertices: number[]; indices: number[]; voxel?: number };

export type InputSource = 'left' | 'right' | 'throttle' | 'steer' | 'button1' | 'button2' | 'button3' | 'button4' | 'gait';

/** What drives an actuator. */
export interface InputDef {
  source: InputSource;
  /** Analog sources and gait: multiplier (−1 reverses). */
  scale?: number;
  /** Buttons: 'hold' is on while held; 'toggle' flips on each press. */
  mode?: 'hold' | 'toggle';
  /** Gait: which side's stride clock to follow. */
  side?: 'left' | 'right';
  /** Gait: phase offset, degrees. */
  phase?: number;
  /** Gait: 'swing' sweeps back and forth; 'lift' raises during the forward swing. */
  pattern?: 'swing' | 'lift';
}

export type ActuatorDef =
  /** Continuous rotation through a gearbox (wheels, spinners, drums). Hinges only. */
  | {
    type: 'motor'; motor: string; gear: number; input: InputDef;
    /**
     * Seconds the speed controller takes to ramp to full power (0 or absent =
     * instant). Spinning a heavy weapon up gently stops its reaction torque
     * spinning the robot round the other way.
     */
    softStart?: number;
  }
  /** Gas ram: flippers, lifters, axes, spikes. `leverArm` (m) applies on hinges. */
  | { type: 'pneumatic'; ram: string; valve: string; pressure: number; leverArm: number; input: InputDef }
  /**
   * Position-controlled motor (legs, clamps, steering). `targets` are the joint
   * positions (degrees for hinges, mm for sliders) at input −1, 0 and +1.
   */
  | { type: 'servo'; motor: string; gear: number; input: InputDef; targets: Vec3 };

/** Pulls a joint back to its built position. Hinges: N·m per degree; sliders: N per mm. */
export interface SpringDef {
  stiffness: number;
  /** Damping: N·m·s per degree (hinge) or N·s per mm (slider). */
  damping: number;
}

export type JointDef =
  | { type: 'fixed' }
  /** Rotates about `axis` (in the part's frame). Limits in degrees from the built pose. */
  | { type: 'hinge'; axis: Vec3; limits?: [number, number]; actuator?: ActuatorDef; spring?: SpringDef }
  /** Slides along `axis`. Limits in mm from the built pose. */
  | { type: 'slider'; axis: Vec3; limits: [number, number]; actuator?: ActuatorDef; spring?: SpringDef }
  /** Swings freely in every direction (flails, chains, wrecking balls). */
  | { type: 'ball' };

export type ComponentDef =
  | { type: 'battery'; part: string }
  | { type: 'gasTank'; part: string }
  | { type: 'ballast'; mass: number }
  /** Shoots flame along the part's +Z while its input is on. Burns fuel (kg). */
  | { type: 'flamethrower'; input: InputDef; range: number; fuel: number };

export interface PartDef {
  id: string;
  label: string;
  /** Parent part id; exactly one part (the chassis) has null. */
  parent: string | null;
  /** Where this part's origin (and its joint) sits in the parent's frame. */
  position: Vec3;
  /** Degrees, XYZ. */
  rotation: Vec3;
  joint: JointDef;
  role: 'structure' | 'wheel' | 'component';
  /** Structure: its shape, centred on `shapeOffset` from the part origin. */
  shape?: Shape;
  shapeOffset?: Vec3;
  material?: string;
  /** Hollow shell with this wall thickness (mm). Omit for a solid part. */
  wall?: number;
  /** Wheel: catalogue wheel. Its axle is the hinge axis. */
  wheel?: string;
  /** Component: mass-only internals. */
  component?: ComponentDef;
  /** Paint (CSS hex). Defaults to the robot colour for structure. */
  colour?: string;
}

/** Builder-defined catalogue parts, referenced by id like any other. */
export interface CustomCatalog {
  motors?: Record<string, MotorSpec>;
  batteries?: Record<string, BatterySpec>;
  wheels?: Record<string, WheelSpec>;
  rams?: Record<string, RamSpec>;
  valves?: Record<string, ValveSpec>;
  tanks?: Record<string, TankSpec>;
  materials?: Record<string, Material>;
}

export interface RobotDesign {
  schema: 2;
  id: string;
  name: string;
  description: string;
  colour: string;
  parts: PartDef[];
  /** Your own motors, batteries, materials… */
  catalog?: CustomCatalog;
}
