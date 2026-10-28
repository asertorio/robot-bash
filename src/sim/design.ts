/**
 * RobotDesign is the saved/shared robot format: pure data, no behaviour.
 * Templates, the builder, save files and (later) AI-assisted design all
 * produce one of these. Robot-local frame: +Z forward, +Y up, +X left,
 * origin at the centre of the footprint on the floor. Lengths in metres
 * unless a field says otherwise.
 */

export type Vec3 = [number, number, number];

export interface ShellPanel {
  id: string;
  label: string;
  shape: 'box' | 'wedge';
  /** [width (x), height (y), length (z)] of the outer envelope. */
  size: Vec3;
  /** Centre of the envelope. */
  position: Vec3;
  material: string;
  /** Plate thickness, mm. The panel is a hollow shell of this thickness. */
  thickness: number;
  /** Wedge only: height of the leading edge (0 = knife edge). */
  lipHeight?: number;
}

export interface WheelMount {
  wheel: string;
  /** Axle centre. */
  position: Vec3;
  side: 'left' | 'right';
}

export interface DriveDef {
  motor: string;
  motorsPerSide: number;
  /** Motor revolutions per wheel revolution. */
  gearRatio: number;
  wheels: WheelMount[];
  /** Where the drive motors sit (one per side, mirrored in x). */
  motorPosition: Vec3;
}

/**
 * A low-friction slider that stops a two-wheeled robot tipping onto its nose
 * or tail. Mount it a few mm clear of the floor so the wheels keep the weight.
 */
export interface Skid {
  position: Vec3;
  radius: number;
}

export interface FlipperDef {
  kind: 'flipper';
  ram: string;
  valve: string;
  tank: string;
  /** Regulated working pressure, bar. Capped by the ram's rating. */
  pressure: number;
  /** Centre of the hinge line (hinge axis runs along X). */
  hinge: Vec3;
  /** The plate extends forward (+Z) from the hinge when closed. Thickness in mm. */
  plate: { width: number; length: number; thickness: number; material: string };
  /** Distance from hinge to where the ram acts on the plate, m. */
  leverArm: number;
  /** Max opening angle, degrees. */
  maxAngle: number;
  /** Where the ram + tank sit inside the chassis. */
  gasPosition: Vec3;
}

export interface SpinnerDef {
  kind: 'spinner';
  motor: string;
  /** Motor revolutions per blade revolution. */
  beltRatio: number;
  /** 'horizontal' blades spin flat (vertical axle); 'vertical' blades spin on an X axle. */
  orientation: 'horizontal' | 'vertical';
  /** Bar: length × width. Disc: length is the diameter. Thickness in mm. */
  blade: { shape: 'bar' | 'disc'; length: number; width: number; thickness: number; material: string };
  /** Hub centre. */
  position: Vec3;
  motorPosition: Vec3;
}

export type WeaponDef = FlipperDef | SpinnerDef;

export interface RobotDesign {
  schema: 1;
  id: string;
  name: string;
  description: string;
  /** Paint colour, CSS hex. */
  colour: string;
  shell: ShellPanel[];
  skids: Skid[];
  drive: DriveDef;
  battery: { part: string; position: Vec3 };
  weapons: WeaponDef[];
}
