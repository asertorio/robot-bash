/**
 * What a robot's receiver gets each tick, after the transmitter (input layer)
 * has mixed sticks/keys into per-side throttles — like a real RC setup.
 */
export interface ControlState {
  /** Left drive side throttle, −1..1. */
  left: number;
  /** Right drive side throttle, −1..1. */
  right: number;
  /** Weapon button 1. */
  weapon: boolean;
  /** Weapon button 2. */
  weapon2: boolean;
  /** Weapon buttons 3 and 4, for robots with more weapons. */
  weapon3?: boolean;
  weapon4?: boolean;
}

export const NEUTRAL: ControlState = { left: 0, right: 0, weapon: false, weapon2: false };
