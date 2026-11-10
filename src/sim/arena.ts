import RAPIER from '@dimforge/rapier3d-compat';
import { ARENA_GROUPS, DEBRIS_GROUPS } from './groups';
import { qaxis, type V3 } from './vmath';

/** Arena layout. Shared by the simulation and the renderer. */
export const ARENA = {
  /** Half-width of the square fighting floor, m. */
  half: 6,
  wallHeight: 0.45,
  wallThickness: 0.15,
  /** Floor beyond the walls (robots thrown out land here), half-width. */
  outerHalf: 9,
  /** Side length of the corner patrol zones, where the house robots live. */
  cpz: 2.2,
  pit: { x: 3.2, z: -3.2, half: 0.8, depth: 1.2 },
  pitButton: { x: -4.3, z: 4.3, half: 0.35 },
  /** Hinged floor panel that throws whatever sits on it. Hinge runs along x at z0. */
  floorFlipper: { x: -3.4, z0: -1.1, halfWidth: 0.6, length: 1.0, maxAngle: 1.0, riseTime: 0.18 },
  /** Grille that belches fire on a cycle. */
  flamePit: { x: 2.6, z: 2.4, half: 0.6, period: 7, burn: 2.2 },
  floorFriction: 1.0,
  /**
   * Wall spikes: hardened-steel strips bolted to the side walls (x = ±half),
   * two each, clear of the corners and the end walls (where football's goals
   * go). Each is a plate standing `depth` proud of the wall carrying rows of
   * points; the collider is the plate, the points are what does the damage
   * (see SPIKES in match.ts).
   */
  spikes: { centres: [-1.6, 1.6], halfLength: 0.9, depth: 0.12, y0: 0.05, y1: 0.32 },
  /** Sumo: a raised steel dais in the middle of the floor. Pushed off it, you're out. */
  dais: { radius: 2.3, height: 0.3 },
  /**
   * Robot football: a light plastic ball, and a goal mouth against each
   * end wall (z = ∓half). It's a goal when the ball's centre is within
   * `depth` of the wall between the posts.
   */
  football: { ballRadius: 0.22, ballMass: 1.6, goalHalfWidth: 1.1, depth: 0.5 },
};

export interface Rect { x0: number; x1: number; z0: number; z1: number }

const pitRect = (): Rect => ({ x0: ARENA.pit.x - ARENA.pit.half, x1: ARENA.pit.x + ARENA.pit.half, z0: ARENA.pit.z - ARENA.pit.half, z1: ARENA.pit.z + ARENA.pit.half });
export const floorFlipperRect = (): Rect => {
  const f = ARENA.floorFlipper;
  return { x0: f.x - f.halfWidth, x1: f.x + f.halfWidth, z0: f.z0, z1: f.z0 + f.length };
};
export const flamePitRect = (): Rect => {
  const f = ARENA.flamePit;
  return { x0: f.x - f.half, x1: f.x + f.half, z0: f.z - f.half, z1: f.z + f.half };
};
export const inRect = (r: Rect, p: V3, margin = 0) => p.x > r.x0 - margin && p.x < r.x1 + margin && p.z > r.z0 - margin && p.z < r.z1 + margin;

/** Split a square floor into rectangles that leave the given holes open. */
export function floorAround(half: number, holes: Rect[]): Rect[] {
  const xs = [...new Set([-half, half, ...holes.flatMap((h) => [h.x0, h.x1])])].sort((a, b) => a - b);
  const out: Rect[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i], x1 = xs[i + 1];
    const cuts = holes.filter((h) => h.x0 <= x0 && h.x1 >= x1).sort((a, b) => a.z0 - b.z0);
    let z = -half;
    for (const c of cuts) {
      if (c.z0 > z) out.push({ x0, x1, z0: z, z1: c.z0 });
      z = Math.max(z, c.z1);
    }
    if (z < half) out.push({ x0, x1, z0: z, z1: half });
  }
  return out;
}

export interface Box {
  centre: V3;
  half: V3;
  kind: 'floor' | 'outerFloor' | 'wall' | 'pitWall' | 'pitFloor' | 'barrier' | 'well';
}

/** Static boxes making up the arena (floor around the pit hole, walls, pit, outer barrier). */
export function arenaBoxes(): Box[] {
  const { half: H, wallHeight, wallThickness: T, outerHalf: O, pit } = ARENA;
  const ft = 0.1; // floor half-thickness; floor top is y = 0
  const out: Box[] = [];
  const slab = (x0: number, x1: number, z0: number, z1: number, kind: Box['kind'], top = 0) => {
    out.push({ centre: { x: (x0 + x1) / 2, y: top - ft, z: (z0 + z1) / 2 }, half: { x: (x1 - x0) / 2, y: ft, z: (z1 - z0) / 2 }, kind });
  };
  // Fighting floor, with holes for the pit and the floor flipper.
  const ff = floorFlipperRect();
  for (const r of floorAround(H, [pitRect(), ff])) slab(r.x0, r.x1, r.z0, r.z1, 'floor');
  // Shallow well under the floor flipper.
  slab(ff.x0, ff.x1, ff.z0, ff.z1, 'well', -0.3);
  // Outside the walls.
  slab(-O, O, H + T, O, 'outerFloor', -0.02);
  slab(-O, O, -O, -H - T, 'outerFloor', -0.02);
  slab(-O, -H - T, -H - T, H + T, 'outerFloor', -0.02);
  slab(H + T, O, -H - T, H + T, 'outerFloor', -0.02);
  // Arena walls.
  const wy = wallHeight / 2;
  out.push({ centre: { x: 0, y: wy, z: H + T / 2 }, half: { x: H + T, y: wy, z: T / 2 }, kind: 'wall' });
  out.push({ centre: { x: 0, y: wy, z: -H - T / 2 }, half: { x: H + T, y: wy, z: T / 2 }, kind: 'wall' });
  out.push({ centre: { x: H + T / 2, y: wy, z: 0 }, half: { x: T / 2, y: wy, z: H }, kind: 'wall' });
  out.push({ centre: { x: -H - T / 2, y: wy, z: 0 }, half: { x: T / 2, y: wy, z: H }, kind: 'wall' });
  // The pit.
  const d = pit.depth, ph = pit.half;
  out.push({ centre: { x: pit.x, y: -d - 0.05, z: pit.z }, half: { x: ph, y: 0.05, z: ph }, kind: 'pitFloor' });
  out.push({ centre: { x: pit.x + ph + 0.05, y: -d / 2, z: pit.z }, half: { x: 0.05, y: d / 2, z: ph + 0.1 }, kind: 'pitWall' });
  out.push({ centre: { x: pit.x - ph - 0.05, y: -d / 2, z: pit.z }, half: { x: 0.05, y: d / 2, z: ph + 0.1 }, kind: 'pitWall' });
  out.push({ centre: { x: pit.x, y: -d / 2, z: pit.z + ph + 0.05 }, half: { x: ph, y: d / 2, z: 0.05 }, kind: 'pitWall' });
  out.push({ centre: { x: pit.x, y: -d / 2, z: pit.z - ph - 0.05 }, half: { x: ph, y: d / 2, z: 0.05 }, kind: 'pitWall' });
  // Bullet-proof screen around everything.
  const bh = 2.5;
  out.push({ centre: { x: 0, y: bh, z: O + 0.1 }, half: { x: O + 0.2, y: bh, z: 0.1 }, kind: 'barrier' });
  out.push({ centre: { x: 0, y: bh, z: -O - 0.1 }, half: { x: O + 0.2, y: bh, z: 0.1 }, kind: 'barrier' });
  out.push({ centre: { x: O + 0.1, y: bh, z: 0 }, half: { x: 0.1, y: bh, z: O }, kind: 'barrier' });
  out.push({ centre: { x: -O - 0.1, y: bh, z: 0 }, half: { x: 0.1, y: bh, z: O }, kind: 'barrier' });
  return out;
}

export class Arena {
  readonly trapdoor: RAPIER.RigidBody;
  readonly pitButton: RAPIER.Collider;
  readonly staticColliders = new Set<number>();
  readonly floorFlipper: RAPIER.RigidBody;
  pitOpen = false;
  /** 0 = closed (flush with floor), 1 = fully lowered. */
  pitOpenAmount = 0;
  /** Floor flipper angle, radians (0 = flush). */
  flipperAngle = 0;
  private flipperState: 'ready' | 'rising' | 'holding' | 'lowering' | 'cooldown' = 'ready';
  private flipperTimer = 0;
  /** Arena clock (s), which runs the flame pit cycle. Public so a network mirror can copy it. */
  time = 0;

  private world: RAPIER.World;

  constructor(world: RAPIER.World) {
    this.world = world;
    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const b of arenaBoxes()) {
      const c = world.createCollider(
        RAPIER.ColliderDesc.cuboid(b.half.x, b.half.y, b.half.z)
          .setTranslation(b.centre.x, b.centre.y, b.centre.z)
          .setFriction(b.kind === 'wall' || b.kind === 'barrier' ? 0.3 : ARENA.floorFriction)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
          .setRestitution(0.05)
          // Robots are a bit bouncy off each other, not off the arena.
          .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
          .setCollisionGroups(ARENA_GROUPS),
        ground,
      );
      this.staticColliders.add(c.handle);
    }
    const { pit, pitButton } = ARENA;
    // The pit is covered by a floor section that drops away when the button is hit.
    this.trapdoor = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pit.x, -0.1, pit.z));
    const td = world.createCollider(
      RAPIER.ColliderDesc.cuboid(pit.half - 0.01, 0.1, pit.half - 0.01)
        .setFriction(ARENA.floorFriction)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
        .setCollisionGroups(ARENA_GROUPS),
      this.trapdoor,
    );
    this.staticColliders.add(td.handle);
    // Floor flipper: a kinematic steel panel, so nothing can stop it.
    const ffd = ARENA.floorFlipper;
    this.floorFlipper = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(ffd.x, 0, ffd.z0));
    const fc = world.createCollider(
      RAPIER.ColliderDesc.cuboid(ffd.halfWidth - 0.01, 0.05, ffd.length / 2 - 0.01)
        .setTranslation(0, -0.05, ffd.length / 2)
        .setFriction(ARENA.floorFriction)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
        .setCollisionGroups(ARENA_GROUPS),
      this.floorFlipper,
    );
    this.staticColliders.add(fc.handle);
    this.pitButton = world.createCollider(
      RAPIER.ColliderDesc.cuboid(pitButton.half, 0.03, pitButton.half)
        .setTranslation(pitButton.x, 0.03, pitButton.z)
        .setSensor(true)
        .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.DEFAULT | RAPIER.ActiveCollisionTypes.KINEMATIC_FIXED)
        .setCollisionGroups(ARENA_GROUPS),
      ground,
    );
  }

  /** True when any collider of the given set is pressing the pit button. */
  buttonPressedBy(handles: Set<number>): boolean {
    let hit = false;
    this.world.intersectionPairsWith(this.pitButton, (other) => { if (handles.has(other.handle)) hit = true; });
    return hit;
  }

  /** True while the flame pit is burning. */
  get flamesOn(): boolean {
    const f = ARENA.flamePit;
    return this.time % f.period > f.period - f.burn;
  }

  get floorFlipperReady(): boolean {
    return this.flipperState === 'ready';
  }

  /** Fire the floor flipper (if it's ready). */
  fireFloorFlipper(): boolean {
    if (this.flipperState !== 'ready') return false;
    this.flipperState = 'rising';
    this.flipperTimer = 0;
    return true;
  }

  update(dt: number) {
    this.time += dt;
    if (this.pitOpen && this.pitOpenAmount < 1) {
      this.pitOpenAmount = Math.min(1, this.pitOpenAmount + dt / 1.5);
      const { pit } = ARENA;
      this.trapdoor.setNextKinematicTranslation({ x: pit.x, y: -0.1 - this.pitOpenAmount * (pit.depth - 0.3), z: pit.z });
    }
    this.updateFloorFlipper(dt);
  }

  private updateFloorFlipper(dt: number) {
    const f = ARENA.floorFlipper;
    this.flipperTimer += dt;
    const t = this.flipperTimer;
    switch (this.flipperState) {
      case 'ready': return;
      case 'rising':
        this.flipperAngle = f.maxAngle * Math.min(1, t / f.riseTime);
        if (t >= f.riseTime) { this.flipperState = 'holding'; this.flipperTimer = 0; }
        break;
      case 'holding':
        if (t >= 0.6) { this.flipperState = 'lowering'; this.flipperTimer = 0; }
        break;
      case 'lowering':
        this.flipperAngle = f.maxAngle * Math.max(0, 1 - t / 1.2);
        if (t >= 1.2) { this.flipperState = 'cooldown'; this.flipperTimer = 0; }
        break;
      case 'cooldown':
        if (t >= 4) this.flipperState = 'ready';
        return;
    }
    // Rotating about −X lifts the free (+z) edge.
    this.floorFlipper.setNextKinematicRotation(qaxis({ x: -1, y: 0, z: 0 }, this.flipperAngle));
  }

  isInPit(p: V3): boolean {
    const { pit } = ARENA;
    return this.pitOpen && p.y < -0.2 && Math.abs(p.x - pit.x) < pit.half + 0.2 && Math.abs(p.z - pit.z) < pit.half + 0.2;
  }

  /** Wall spike strips' colliders (a hit on one is a hit by a spike). */
  readonly spikeColliders = new Set<number>();

  /** Bolt the spike strips to the side walls. */
  addSpikes() {
    const s = ARENA.spikes;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const side of [-1, 1]) {
      for (const z of s.centres) {
        const c = this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(s.depth / 2, (s.y1 - s.y0) / 2, s.halfLength)
            .setTranslation(side * (ARENA.half - s.depth / 2), (s.y0 + s.y1) / 2, z)
            .setFriction(0.5).setRestitution(0.05).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
            .setCollisionGroups(ARENA_GROUPS),
          body,
        );
        this.staticColliders.add(c.handle);
        this.spikeColliders.add(c.handle);
      }
    }
  }

  /** Sumo: raise the dais (once). */
  addDais() {
    const { radius, height } = ARENA.dais;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, height / 2, 0));
    const c = this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(height / 2, radius).setFriction(ARENA.floorFriction)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
        .setRestitution(0.05).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setCollisionGroups(ARENA_GROUPS),
      body,
    );
    this.staticColliders.add(c.handle);
  }

  /** Sumo: off the dais — clear of its edge and below its top. */
  isOffDais(p: V3): boolean {
    const { radius, height } = ARENA.dais;
    return Math.hypot(p.x, p.z) > radius + 0.05 && p.y < height - 0.05;
  }

  /**
   * Robot football: the ball, a hollow plastic sphere. It's debris as far as
   * collisions go: robots and the arena hit it, wheels' floor spheres don't
   * (their cylinders do). Some rolling resistance, so it doesn't roll forever.
   */
  addBall(): RAPIER.RigidBody {
    const f = ARENA.football;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, f.ballRadius + 0.01, 0)
      .setLinearDamping(0.25).setAngularDamping(0.4).setCcdEnabled(true));
    this.world.createCollider(
      RAPIER.ColliderDesc.ball(f.ballRadius).setMass(f.ballMass).setFriction(0.6).setRestitution(0.55)
        .setCollisionGroups(DEBRIS_GROUPS),
      body,
    );
    return body;
  }

  /** Robot football: which end the ball is in the goal at (-1 is the −z end), or 0. */
  goalAt(p: V3): -1 | 0 | 1 {
    const f = ARENA.football;
    if (Math.abs(p.x) > f.goalHalfWidth || p.y > 0.8) return 0;
    if (p.z < -ARENA.half + f.depth) return -1;
    if (p.z > ARENA.half - f.depth) return 1;
    return 0;
  }

  isOutOfArena(p: V3): boolean {
    const edge = ARENA.half + ARENA.wallThickness;
    return (Math.abs(p.x) > edge || Math.abs(p.z) > edge) && p.y < ARENA.wallHeight;
  }
}
