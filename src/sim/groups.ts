/** Rapier interaction groups: (membership << 16) | filter. */
const ALL = 0xffff;
export const ARENA_BIT = 1 << 0;
export const DEBRIS_BIT = 1 << 1;
export const robotBit = (index: number): number => 1 << (2 + index);

const pack = (membership: number, filter: number): number => ((membership & 0xffff) << 16) | (filter & 0xffff);

export const ARENA_GROUPS = pack(ARENA_BIT, ALL);
export const DEBRIS_GROUPS = pack(DEBRIS_BIT, ALL);
/** A robot's parts hit everything except the same robot. */
export const robotGroups = (index: number): number => pack(robotBit(index), ALL & ~robotBit(index));
/** Wheel tyres: the sphere touches only the arena; the cylinder everything else. */
export const wheelTyreGroups = (index: number): number => pack(robotBit(index), ARENA_BIT);
export const wheelBodyGroups = (index: number): number => pack(robotBit(index), ALL & ~robotBit(index) & ~ARENA_BIT);
/** Mass-only colliders (internals behind armour) touch nothing. */
export const GHOST_GROUPS = pack(0, 0);
