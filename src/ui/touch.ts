import type { TouchState } from '../input/input';
import { h } from './dom';

/** Stick travel, px: the knob stops at the edge of the base. */
const STICK_RADIUS = 56;
const DEADZONE = 0.12;
/**
 * Expo, like an RC transmitter's: the middle of the stick is gentle (fine
 * control), the edge is still full power. 0 = linear.
 */
const EXPO = 0.4;

const shape = (v: number): number => {
  const a = Math.abs(v);
  if (a < DEADZONE) return 0;
  const t = (a - DEADZONE) / (1 - DEADZONE);
  return Math.sign(v) * ((1 - EXPO) * t + EXPO * t * t * t);
};

/**
 * On-screen controls for phones and tablets: a thumb-stick bottom left and
 * the robot's weapon buttons bottom right. Multi-touch, so you can steer and
 * fire at once. Everything else on screen (menus, the garage) is already
 * plain taps.
 */
export class TouchControls {
  readonly el: HTMLDivElement;
  readonly state: TouchState = { x: 0, y: 0, buttons: [false, false, false, false] };
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private pad: HTMLDivElement;
  private buttons: HTMLButtonElement[] = [];
  private stickPointer: number | null = null;
  private labels = '';

  constructor() {
    this.knob = h('div', { class: 'touch-knob' });
    this.base = h('div', { class: 'touch-stick', 'aria-label': 'Drive' }, this.knob);
    this.pad = h('div', { class: 'touch-buttons' });
    this.el = h('div', { class: 'touch-controls', style: 'display:none' },
      this.base, this.pad,
      h('div', { class: 'touch-rotate' }, 'Turn your phone sideways for more room'));
    this.bindStick();
    // No long-press menus, text selection or double-tap zoom on the controls.
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get visible(): boolean {
    return this.el.style.display !== 'none';
  }

  show(on: boolean) {
    if (on === this.visible) return;
    this.el.style.display = on ? '' : 'none';
    if (!on) this.release();
  }

  /**
   * Which weapon buttons to show, and what to call them (null hides one).
   * Cheap to call every frame: it only rebuilds when something changed.
   */
  setButtons(labels: Array<string | null>) {
    const key = labels.join('|');
    if (key === this.labels) return;
    this.labels = key;
    this.state.buttons = [false, false, false, false];
    this.buttons = labels.map((label, i) => {
      const b = h('button', { class: `touch-btn${i === 0 ? ' main' : ''}`, 'aria-label': `Weapon button ${i + 1}`, style: label ? '' : 'display:none' }, label ?? '');
      const down = (e: PointerEvent) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        this.state.buttons[i] = true;
        b.classList.add('on');
        navigator.vibrate?.(12);
      };
      const up = () => { this.state.buttons[i] = false; b.classList.remove('on'); };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      return b;
    });
    this.pad.replaceChildren(...this.buttons);
  }

  private bindStick() {
    const move = (e: PointerEvent) => {
      const r = this.base.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      if (d > STICK_RADIUS) { dx *= STICK_RADIUS / d; dy *= STICK_RADIUS / d; }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.state.x = shape(dx / STICK_RADIUS);
      this.state.y = shape(dy / STICK_RADIUS);
    };
    this.base.addEventListener('pointerdown', (e) => {
      if (this.stickPointer !== null) return;
      e.preventDefault();
      this.stickPointer = e.pointerId;
      this.base.setPointerCapture(e.pointerId);
      this.base.classList.add('on');
      move(e);
    });
    this.base.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickPointer) move(e); });
    const end = (e: PointerEvent) => { if (e.pointerId === this.stickPointer) this.releaseStick(); };
    this.base.addEventListener('pointerup', end);
    this.base.addEventListener('pointercancel', end);
    this.base.addEventListener('lostpointercapture', end);
  }

  private releaseStick() {
    this.stickPointer = null;
    this.state.x = this.state.y = 0;
    this.knob.style.transform = '';
    this.base.classList.remove('on');
  }

  /** Let go of everything (hidden, paused, app switched away). */
  release() {
    this.releaseStick();
    this.state.buttons = [false, false, false, false];
    for (const b of this.buttons) b.classList.remove('on');
  }
}

/** A short word for what a weapon button does, from what's wired to it. */
export function buttonLabel(kinds: Set<string> | undefined, flame: boolean): string | null {
  if (flame) return 'Flame';
  if (!kinds?.size) return null;
  if (kinds.has('spinner')) return 'Spin';
  if (kinds.has('chain')) return 'Saw';
  if (kinds.has('pneumatic')) return 'Fire';
  if (kinds.has('servo')) return 'Grab';
  if (kinds.has('motor')) return 'Run';
  return 'Go';
}
