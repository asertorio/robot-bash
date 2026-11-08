import type { ControlState } from '../sim/control';
import { qconj, qrotate, type Q } from '../sim/vmath';
import { DEFAULT_KEY_RAMP, parseMacro, type Action, type Binding, type ControlProfile, type MacroStep } from './bindings';

const DEADZONE = 0.15;
/** Menu buttons on a standard-mapping pad: name, button index, and optionally a stick axis and direction. */
const PAD_MENU: Array<[string, number, number?, number?]> = [
  ['A', 0], ['B', 1], ['Back', 8], ['Start', 9], ['Up', 12, 1, -1], ['Down', 13, 1, 1], ['Left', 14, 0, -1], ['Right', 15, 0, 1],
];

/**
 * How hard each binding is pressed right now, 0..1. `drive` asks for the
 * drive-channel reading, where keys ramp up while held (see `keyLevel`).
 */
export type BindingReader = (b: Binding, drive?: boolean) => number;

/** A key's drive level after being held `held` seconds: a quick tap is a gentle nudge. */
export function keyLevel(held: number, ramp: number): number {
  if (ramp <= 0) return 1;
  return Math.min(1, KEY_START + (1 - KEY_START) * (held / ramp));
}
const KEY_START = 0.3;

/**
 * The transmitter: read a profile's bindings (plus any running macro) and mix
 * them into per-side throttles, exactly as an RC transmitter's mixer would.
 */
export function mixControls(profile: ControlProfile, read: BindingReader, macro: ReadonlySet<Action>): ControlState {
  const level = (a: Action) => Math.max(macro.has(a) ? 1 : 0, ...profile.bindings[a].map((b) => read(b)));
  const drive = (a: Action) => Math.max(macro.has(a) ? 1 : 0, ...profile.bindings[a].map((b) => read(b, true)));
  let left: number, right: number;
  if (profile.mode === 'tank') {
    left = drive('leftForward') - drive('leftBack');
    right = drive('rightForward') - drive('rightBack');
  } else {
    const throttle = drive('forward') - drive('back');
    const turn = (drive('right') - drive('left')) * profile.turnRate;
    left = throttle + turn;
    right = throttle - turn;
    const over = Math.max(1, Math.abs(left), Math.abs(right));
    left /= over;
    right /= over;
  }
  return { left, right, weapon: level('weapon') > 0.5, weapon2: level('weapon2') > 0.5, weapon3: level('weapon3') > 0.5, weapon4: level('weapon4') > 0.5 };
}

/** What on-screen touch controls are doing right now (see ui/touch.ts). */
export interface TouchState {
  /** Stick, −1..1: x right, y down (screen directions), after deadzone and expo. */
  x: number;
  y: number;
  /** The same stick with expo on its distance from centre instead: direction kept, magnitude 0..1. */
  rx: number;
  ry: number;
  /** Weapon buttons 1–4. */
  buttons: [boolean, boolean, boolean, boolean];
}

/**
 * Where the touch-driven robot is and which way the camera looks, so the stick
 * can mean "go that way on screen". Set by the app each frame.
 */
export interface StickPose {
  /** The camera's view direction flattened onto the floor (world x, z; any length). */
  camera: { x: number; z: number };
  /** The robot chassis's orientation. */
  rotation: Q;
  /** Upside down (controls run reversed, as for a real robot). */
  inverted: boolean;
}

/**
 * Point-to-drive steering. Bearing error (rad) → turn: full lock from about
 * 35° off, easing in below so the robot settles onto the line instead of
 * wagging. Throttle falls with cos(error), so a robot facing away pivots on
 * the spot first and only drives off once it's roughly lined up — what a
 * driver does by hand.
 */
const POINT = { turnGain: 1.6, minTurn: 0.45 };

/**
 * Turn a screen-direction stick into left/right throttles: the robot turns to
 * face where the stick points (relative to the camera) and drives that way,
 * whichever way it's facing on screen. On a phone that's far easier than
 * steering a tank from its own point of view.
 */
export function pointToDrive(sx: number, sy: number, pose: StickPose): { left: number; right: number } {
  const mag = Math.min(1, Math.hypot(sx, sy));
  if (mag === 0) return { left: 0, right: 0 };
  const cl = Math.hypot(pose.camera.x, pose.camera.z) || 1;
  const f = { x: pose.camera.x / cl, z: pose.camera.z / cl };
  // Screen right is the camera's right on the floor: forward × up.
  const want = { x: -f.z * sx - f.x * sy, y: 0, z: f.x * sx - f.z * sy };
  const rel = qrotate(qconj(pose.rotation), want);
  if (pose.inverted) rel.x = -rel.x;
  const bearing = Math.atan2(rel.x, rel.z); // + = wanted direction is to its left
  const turn = Math.max(-1, Math.min(1, -bearing * POINT.turnGain)) * Math.max(POINT.minTurn, mag);
  const throttle = mag * Math.max(0, Math.cos(bearing));
  let left = throttle + turn, right = throttle - turn;
  const over = Math.max(1, Math.abs(left), Math.abs(right));
  left /= over;
  right /= over;
  // Upside down the drive runs backwards and the sides swap over.
  return pose.inverted ? { left: -right, right: -left } : { left, right };
}

/**
 * Add the touch controls to a player's controls. With a pose the stick is
 * point-to-drive (see `pointToDrive`); without one it mixes like an arcade
 * transmitter (up is the robot's forward, sideways steers). When it's centred
 * the keyboard or pad still drives. Weapon buttons add to whatever else is held.
 */
export function withTouch(c: ControlState, t: TouchState, profile: ControlProfile, pose: StickPose | null = null): ControlState {
  const out = { ...c, weapon: c.weapon || t.buttons[0], weapon2: c.weapon2 || t.buttons[1], weapon3: !!c.weapon3 || t.buttons[2], weapon4: !!c.weapon4 || t.buttons[3] };
  if (pose) {
    if (t.rx === 0 && t.ry === 0) return out;
    return { ...out, ...pointToDrive(t.rx, t.ry, pose) };
  }
  if (t.x === 0 && t.y === 0) return out;
  const throttle = -t.y;
  const turn = t.x * profile.turnRate;
  let left = throttle + turn, right = throttle - turn;
  const over = Math.max(1, Math.abs(left), Math.abs(right));
  left /= over;
  right /= over;
  return { ...out, left, right };
}

/** Runs one player's macros: a trigger press plays its steps in order. */
export class MacroRunner {
  private steps: MacroStep[] = [];
  private stepIndex = 0;
  private stepLeft = 0;
  private wasDown: boolean[] = [];
  active = new Set<Action>();

  update(profile: ControlProfile, read: BindingReader, dtMs: number) {
    profile.macros.forEach((m, i) => {
      const down = m.trigger ? read(m.trigger) > 0.5 : false;
      if (down && !this.wasDown[i]) {
        try {
          this.steps = parseMacro(m.script);
          this.stepIndex = 0;
          this.stepLeft = this.steps[0].ms;
        } catch {
          this.steps = [];
        }
      }
      this.wasDown[i] = down;
    });
    this.active = new Set();
    while (this.stepIndex < this.steps.length) {
      if (this.stepLeft > 0) {
        for (const a of this.steps[this.stepIndex].actions) this.active.add(a);
        this.stepLeft -= dtMs;
        break;
      }
      this.stepIndex++;
      if (this.stepIndex < this.steps.length) this.stepLeft = this.steps[this.stepIndex].ms;
    }
  }
}

/** Keyboard + gamepad state for the whole couch. */
export class InputManager {
  private keys = new Set<string>();
  /** Seconds each key has been held, for the drive ramp. */
  private held = new Map<string, number>();
  private ramp = 0.25;
  /** Keys that went down since the last poll, so a quick tap is never missed. */
  private tapped = new Set<string>();
  private pads: (Gamepad | null)[] = [];
  private runners: MacroRunner[] = [];
  private capture: ((b: Binding) => void) | null = null;
  private onCaptureCancel: (() => void) | null = null;
  /**
   * What the keyboard is for right now. In menus the browser keeps its keys
   * (Tab, Space and arrows work on buttons and sliders); in the garage the
   * bound keys drive the test bay; in a fight Tab is ours too.
   */
  mode: 'menu' | 'garage' | 'fight' = 'menu';
  /** On-screen touch controls, and which player they drive (null when hidden). */
  touch: TouchState | null = null;
  touchPlayer = 0;
  /** For point-to-drive: the touch robot's pose and the camera (null = robot-relative stick). */
  touchPose: StickPose | null = null;
  private captureBaseline: (Gamepad | null)[] = [];
  /** Codes bound to anything, so we can stop the page scrolling on arrows/space. */
  private boundCodes = new Set<string>();
  private pressed: string[] = [];
  /** Last poll's menu buttons per pad, so presses register once. */
  private padWas: boolean[][] = [];

  constructor(private profiles: ControlProfile[]) {
    window.addEventListener('keydown', (e) => {
      if (this.capture) {
        e.preventDefault();
        if (e.code !== 'Escape') this.finishCapture({ device: 'key', code: e.code });
        else this.cancelCapture();
        return;
      }
      // Typing in a text box shouldn't drive the robot, and nor should shortcuts (Ctrl+Z…).
      const t = e.target;
      if (t instanceof HTMLInputElement && t.type !== 'range' || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Arrow keys on a focused slider move the slider.
      if (t instanceof HTMLInputElement && t.type === 'range' && e.code.startsWith('Arrow')) return;
      const ours = this.mode === 'fight' ? this.boundCodes.has(e.code) || e.code === 'Tab' : this.mode === 'garage' && this.boundCodes.has(e.code);
      if (ours) e.preventDefault();
      if (!e.repeat) this.pressed.push(e.code);
      this.keys.add(e.code);
      this.tapped.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.setProfiles(profiles);
  }

  setProfiles(profiles: ControlProfile[]) {
    this.profiles = profiles;
    this.runners = profiles.map(() => new MacroRunner());
    this.boundCodes.clear();
    for (const p of profiles) {
      for (const list of Object.values(p.bindings)) for (const b of list) if (b.device === 'key') this.boundCodes.add(b.code);
      for (const m of p.macros) if (m.trigger?.device === 'key') this.boundCodes.add(m.trigger.code);
    }
  }

  /** Keys pressed since the last call (for menus: Escape, Enter…). */
  takePressed(): string[] {
    const p = this.pressed;
    this.pressed = [];
    return p;
  }

  read: BindingReader = (b, drive = false) => {
    if (b.device === 'key') {
      if (!this.keys.has(b.code) && !this.tapped.has(b.code)) return 0;
      return drive ? keyLevel(this.held.get(b.code) ?? 0, this.ramp) : 1;
    }
    const pad = this.pads[b.pad];
    if (!pad) return 0;
    if (b.device === 'padButton') return pad.buttons[b.button]?.value ?? 0;
    const v = (pad.axes[b.axis] ?? 0) * b.dir;
    return v > DEADZONE ? (v - DEADZONE) / (1 - DEADZONE) : 0;
  };

  poll(dtMs: number): ControlState[] {
    this.pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
    if (this.capture) this.pollCapture();
    else this.pollPadMenus();
    for (const code of [...this.held.keys()]) if (!this.keys.has(code)) this.held.delete(code);
    for (const code of this.keys) this.held.set(code, (this.held.get(code) ?? 0) + dtMs / 1000);
    const out = this.profiles.map((p, i) => {
      this.ramp = p.keyRamp ?? DEFAULT_KEY_RAMP;
      this.runners[i].update(p, this.read, dtMs);
      const c = mixControls(p, this.read, this.runners[i].active);
      return this.touch && i === this.touchPlayer ? withTouch(c, this.touch, p, this.touchPose) : c;
    });
    this.tapped.clear();
    return out;
  }

  /** Wait for the next key / button / stick push and hand it back as a Binding. */
  captureNext(cb: (b: Binding) => void, onCancel?: () => void) {
    this.capture = cb;
    this.onCaptureCancel = onCancel ?? null;
    this.captureBaseline = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
  }

  cancelCapture() {
    const was = this.capture;
    this.capture = null;
    const cb = this.onCaptureCancel;
    this.onCaptureCancel = null;
    if (was) cb?.();
  }

  /**
   * Gamepad buttons for menus, as press events like keys: `Pad0:A`, `Pad1:Left`…
   * (A, B, Start, Back and the D-pad; the stick counts as the D-pad too).
   */
  private pollPadMenus() {
    this.pads.forEach((pad, pi) => {
      if (!pad) return;
      const ax = (i: number) => pad.axes[i] ?? 0;
      const down = PAD_MENU.map(([, button, axis, dir]) => !!pad.buttons[button]?.pressed || (axis !== undefined && ax(axis) * dir! > 0.7));
      const was = this.padWas[pi] ?? [];
      down.forEach((d, k) => { if (d && !was[k]) this.pressed.push(`Pad${pi}:${PAD_MENU[k][0]}`); });
      this.padWas[pi] = down;
    });
  }

  private pollCapture() {
    this.pads.forEach((pad, pi) => {
      if (!pad || !this.capture) return;
      const base = this.captureBaseline[pi];
      pad.buttons.forEach((b, bi) => {
        if (b.pressed && !base?.buttons[bi]?.pressed) this.finishCapture({ device: 'padButton', pad: pi, button: bi });
      });
      pad.axes.forEach((v, ai) => {
        if (Math.abs(v) > 0.6 && Math.abs(base?.axes[ai] ?? 0) < 0.3) this.finishCapture({ device: 'padAxis', pad: pi, axis: ai, dir: v > 0 ? 1 : -1 });
      });
    });
  }

  private finishCapture(b: Binding) {
    const cb = this.capture;
    this.capture = null;
    this.onCaptureCancel = null;
    cb?.(b);
  }
}
