/**
 * What a robot's receiver gets each tick, after the transmitter (input layer)
 * has mixed sticks/keys into per-side throttles — like a real RC setup.
 */
export interface ControlState {
  /** Left drive side throttle, −1..1. */
  left: number;
  /** Right drive side throttle, −1..1. */
  right: number;
  /** Primary weapon channel (flipper fire / spinner toggle). */
  weapon: boolean;
  /** Secondary weapon channel (spinner brake). */
  weapon2: boolean;
}

export const NEUTRAL: ControlState = { left: 0, right: 0, weapon: false, weapon2: false };
