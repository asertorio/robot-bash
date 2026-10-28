import RAPIER from '@dimforge/rapier3d-compat';
import { ARENA_GROUPS } from './groups';
import type { V3 } from './vmath';

/** Arena layout. Shared by the simulation and the renderer. */
export const ARENA = {
  /** Half-width of the square fighting floor, m. */
  half: 6,
  wallHeight: 0.45,
  wallThickness: 0.15,
  /** Floor beyond the walls (robots thrown out land here), half-width. */
  outerHalf: 9,
  /** Side length of the corner patrol zones (marked now, house robots later). */
  cpz: 2.2,
  pit: { x: 3.2, z: -3.2, half: 0.8, depth: 1.2 },
  pitButton: { x: -4.3, z: 4.3, half: 0.35 },
  floorFriction: 1.0,
};

export interface Box {
  centre: V3;
  half: V3;
  kind: 'floor' | 'outerFloor' | 'wall' | 'pitWall' | 'pitFloor' | 'barrier';
}

/** Static boxes making up the arena (floor around the pit hole, walls, pit, outer barrier). */
export function arenaBoxes(): Box[] {
  const { half: H, wallHeight, wallThickness: T, outerHalf: O, pit } = ARENA;
  const ft = 0.1; // floor half-thickness; floor top is y = 0
  const out: Box[] = [];
  const slab = (x0: number, x1: number, z0: number, z1: number, kind: Box['kind'], top = 0) => {
    out.push({ centre: { x: (x0 + x1) / 2, y: top - ft, z: (z0 + z1) / 2 }, half: { x: (x1 - x0) / 2, y: ft, z: (z1 - z0) / 2 }, kind });
  };
  // Fighting floor, with a square hole for the pit.
  const px0 = pit.x - pit.half, px1 = pit.x + pit.half, pz0 = pit.z - pit.half, pz1 = pit.z + pit.half;
  slab(-H, px0, -H, H, 'floor');
  slab(px1, H, -H, H, 'floor');
  slab(px0, px1, -H, pz0, 'floor');
  slab(px0, px1, pz1, H, 'floor');
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
  pitOpen = false;
  /** 0 = closed (flush with floor), 1 = fully lowered. */
  pitOpenAmount = 0;

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

  update(dt: number) {
    if (!this.pitOpen || this.pitOpenAmount >= 1) return;
    this.pitOpenAmount = Math.min(1, this.pitOpenAmount + dt / 1.5);
    const { pit } = ARENA;
    this.trapdoor.setNextKinematicTranslation({ x: pit.x, y: -0.1 - this.pitOpenAmount * (pit.depth - 0.3), z: pit.z });
  }

  isInPit(p: V3): boolean {
    const { pit } = ARENA;
    return this.pitOpen && p.y < -0.2 && Math.abs(p.x - pit.x) < pit.half + 0.2 && Math.abs(p.z - pit.z) < pit.half + 0.2;
  }

  isOutOfArena(p: V3): boolean {
    const edge = ARENA.half + ARENA.wallThickness;
    return (Math.abs(p.x) > edge || Math.abs(p.z) > edge) && p.y < ARENA.wallHeight;
  }
}
