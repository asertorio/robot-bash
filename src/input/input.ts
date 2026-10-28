import type { ControlState } from '../sim/control';
import { parseMacro, type Action, type Binding, type ControlProfile, type MacroStep } from './bindings';

const DEADZONE = 0.15;

/** How hard each binding is pressed right now, 0..1. */
export type BindingReader = (b: Binding) => number;

/**
 * The transmitter: read a profile's bindings (plus any running macro) and mix
 * them into per-side throttles, exactly as an RC transmitter's mixer would.
 */
export function mixControls(profile: ControlProfile, read: BindingReader, macro: ReadonlySet<Action>): ControlState {
  const level = (a: Action) => Math.max(macro.has(a) ? 1 : 0, ...profile.bindings[a].map(read));
  let left: number, right: number;
  if (profile.mode === 'tank') {
    left = level('leftForward') - level('leftBack');
    right = level('rightForward') - level('rightBack');
  } else {
    const throttle = level('forward') - level('back');
    const turn = (level('right') - level('left')) * profile.turnRate;
    left = throttle + turn;
    right = throttle - turn;
    const over = Math.max(1, Math.abs(left), Math.abs(right));
    left /= over;
    right /= over;
  }
  return { left, right, weapon: level('weapon') > 0.5, weapon2: level('weapon2') > 0.5, weapon3: level('weapon3') > 0.5, weapon4: level('weapon4') > 0.5 };
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
  /** Keys that went down since the last poll, so a quick tap is never missed. */
  private tapped = new Set<string>();
  private pads: (Gamepad | null)[] = [];
  private runners: MacroRunner[] = [];
  private capture: ((b: Binding) => void) | null = null;
  private captureBaseline: (Gamepad | null)[] = [];
  /** Codes bound to anything, so we can stop the page scrolling on arrows/space. */
  private boundCodes = new Set<string>();
  private pressed: string[] = [];

  constructor(private profiles: ControlProfile[]) {
    window.addEventListener('keydown', (e) => {
      if (this.capture) {
        e.preventDefault();
        if (e.code !== 'Escape') this.finishCapture({ device: 'key', code: e.code });
        else this.capture = null;
        return;
      }
      // Typing in a text box shouldn't drive the robot.
      const t = e.target;
      if (t instanceof HTMLInputElement && t.type !== 'range' || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      if (this.boundCodes.has(e.code)) e.preventDefault();
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
    this.boundCodes.add('Tab');
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

  read: BindingReader = (b) => {
    if (b.device === 'key') return this.keys.has(b.code) || this.tapped.has(b.code) ? 1 : 0;
    const pad = this.pads[b.pad];
    if (!pad) return 0;
    if (b.device === 'padButton') return pad.buttons[b.button]?.value ?? 0;
    const v = (pad.axes[b.axis] ?? 0) * b.dir;
    return v > DEADZONE ? (v - DEADZONE) / (1 - DEADZONE) : 0;
  };

  poll(dtMs: number): ControlState[] {
    this.pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
    if (this.capture) this.pollCapture();
    const out = this.profiles.map((p, i) => {
      this.runners[i].update(p, this.read, dtMs);
      return mixControls(p, this.read, this.runners[i].active);
    });
    this.tapped.clear();
    return out;
  }

  /** Wait for the next key / button / stick push and hand it back as a Binding. */
  captureNext(cb: (b: Binding) => void) {
    this.capture = cb;
    this.captureBaseline = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
  }

  cancelCapture() {
    this.capture = null;
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
    cb?.(b);
  }
}
