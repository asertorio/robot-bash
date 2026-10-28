import type { MotorSpec } from '../data/parts';

export const RPM_TO_RADS = (2 * Math.PI) / 60;

export interface MotorOutput {
  /** Shaft torque, N·m (signed). */
  torque: number;
  /** Current drawn from the battery, A (always ≥ 0). */
  current: number;
}

/**
 * Linear brushed-DC model. Torque falls linearly from stall to zero at free
 * speed; both scale with supply voltage (over-volting a motor makes it
 * stronger and faster, as real builders did). `throttle` is −1..1 (the speed
 * controller's duty cycle), `omega` is shaft speed in rad/s.
 */
export function dcMotor(spec: MotorSpec, supplyVoltage: number, throttle: number, omega: number, condition = 1): MotorOutput {
  const vRatio = supplyVoltage / spec.voltage;
  const stall = spec.stallTorque * vRatio * condition;
  const free = spec.freeSpeed * RPM_TO_RADS * vRatio;
  if (Math.abs(throttle) < 1e-3 || stall <= 0 || free <= 0) return { torque: 0, current: 0 };
  // Duty cycle scales the effective voltage, which scales the free speed;
  // back-EMF does the rest.
  const target = throttle * free;
  let torque = stall * ((target - omega) / free);
  // A speed controller can't push more than stall torque either way.
  torque = Math.max(-stall, Math.min(stall, torque));
  // With a plain (non-regenerative) controller, driving against the motor's
  // own direction is just braking: allow it, but it still costs current.
  const load = Math.abs(torque) / Math.max(stall, 1e-6);
  const current = Math.abs(throttle) * (spec.freeCurrent + (spec.stallCurrent * vRatio - spec.freeCurrent) * load);
  return { torque, current };
}
