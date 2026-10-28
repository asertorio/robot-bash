/**
 * Control profiles: which keys / pad inputs drive which robot channels, how
 * they're mixed (arcade vs tank, like an RC transmitter), and macros.
 */

export const DRIVE_ACTIONS = ['forward', 'back', 'left', 'right'] as const;
export const TANK_ACTIONS = ['leftForward', 'leftBack', 'rightForward', 'rightBack'] as const;
export const WEAPON_ACTIONS = ['weapon', 'weapon2', 'weapon3', 'weapon4'] as const;
export const ACTIONS = [...DRIVE_ACTIONS, ...TANK_ACTIONS, ...WEAPON_ACTIONS] as const;
export type Action = (typeof ACTIONS)[number];

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Forward', back: 'Reverse', left: 'Turn left', right: 'Turn right',
  leftForward: 'Left side forward', leftBack: 'Left side reverse',
  rightForward: 'Right side forward', rightBack: 'Right side reverse',
  weapon: 'Weapon button 1', weapon2: 'Weapon button 2', weapon3: 'Weapon button 3', weapon4: 'Weapon button 4',
};

export type Binding =
  | { device: 'key'; code: string }
  | { device: 'padButton'; pad: number; button: number }
  | { device: 'padAxis'; pad: number; axis: number; dir: 1 | -1 };

export interface Macro {
  name: string;
  trigger: Binding | null;
  /** e.g. "weapon 120, back+left 400, wait 100". Durations in ms. */
  script: string;
}

export interface ControlProfile {
  mode: 'arcade' | 'tank';
  /** Arcade steering strength, 0.2–1. Lower = gentler turning. */
  turnRate: number;
  bindings: Record<Action, Binding[]>;
  macros: Macro[];
}

const key = (code: string): Binding => ({ device: 'key', code });
const btn = (pad: number, button: number): Binding => ({ device: 'padButton', pad, button });
const axis = (pad: number, a: number, dir: 1 | -1): Binding => ({ device: 'padAxis', pad, axis: a, dir });

export function defaultProfile(player: number): ControlProfile {
  const pad = player;
  const keys = player === 0
    ? { f: 'KeyW', b: 'KeyS', l: 'KeyA', r: 'KeyD', w: 'KeyE', w2: 'KeyQ', m: 'KeyC', tank: ['KeyW', 'KeyS', 'KeyR', 'KeyF'] }
    : { f: 'KeyI', b: 'KeyK', l: 'KeyJ', r: 'KeyL', w: 'KeyO', w2: 'KeyU', m: 'KeyM', tank: ['KeyI', 'KeyK', 'KeyP', 'Semicolon'] };
  const extra = player === 1
    ? { f: [key('ArrowUp')], b: [key('ArrowDown')], l: [key('ArrowLeft')], r: [key('ArrowRight')], w: [key('Slash'), key('ShiftRight')], w2: [key('Period')] }
    : { f: [], b: [], l: [], r: [], w: [key('Space')], w2: [] };
  return {
    mode: 'arcade',
    turnRate: 0.7,
    bindings: {
      forward: [key(keys.f), ...extra.f, axis(pad, 1, -1)],
      back: [key(keys.b), ...extra.b, axis(pad, 1, 1)],
      left: [key(keys.l), ...extra.l, axis(pad, 0, -1)],
      right: [key(keys.r), ...extra.r, axis(pad, 0, 1)],
      leftForward: [key(keys.tank[0]), axis(pad, 1, -1)],
      leftBack: [key(keys.tank[1]), axis(pad, 1, 1)],
      rightForward: [key(keys.tank[2]), axis(pad, 3, -1)],
      rightBack: [key(keys.tank[3]), axis(pad, 3, 1)],
      weapon: [key(keys.w), ...extra.w, btn(pad, 0), btn(pad, 7)],
      weapon2: [key(keys.w2), ...extra.w2, btn(pad, 1), btn(pad, 6)],
      weapon3: [key(player === 0 ? 'KeyZ' : 'KeyH'), btn(pad, 2), btn(pad, 5)],
      weapon4: [key(player === 0 ? 'KeyX' : 'KeyN'), btn(pad, 3), btn(pad, 4)],
    },
    macros: [
      { name: 'Fire & back off', trigger: key(keys.m), script: 'weapon 150, back 450' },
    ],
  };
}

export function describeBinding(b: Binding | null): string {
  if (!b) return '—';
  if (b.device === 'key') return keyName(b.code);
  if (b.device === 'padButton') return `Pad ${b.pad + 1} ${PAD_BUTTONS[b.button] ?? `button ${b.button}`}`;
  const stick = b.axis < 2 ? 'L-stick' : 'R-stick';
  const dir = b.axis % 2 === 0 ? (b.dir < 0 ? 'left' : 'right') : b.dir < 0 ? 'up' : 'down';
  return `Pad ${b.pad + 1} ${stick} ${dir}`;
}

const PAD_BUTTONS: Record<number, string> = {
  0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT', 8: 'Back', 9: 'Start',
  12: 'D-up', 13: 'D-down', 14: 'D-left', 15: 'D-right',
};

function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code] ?? code;
  return { Slash: '/', Period: '.', Comma: ',', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Space: 'Space' }[code] ?? code;
}

export function sameBinding(a: Binding, b: Binding): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ------------------------------------------------------------------ macros

export interface MacroStep {
  actions: Action[];
  ms: number;
}

/** Parse the macro mini-language. Throws with a readable message on bad input. */
export function parseMacro(script: string): MacroStep[] {
  const steps: MacroStep[] = [];
  for (const raw of script.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^([a-zA-Z0-9+]+)\s+(\d+)$/.exec(part);
    if (!m) throw new Error(`"${part}" should look like "weapon 150" or "back+left 300"`);
    const ms = Number(m[2]);
    if (m[1].toLowerCase() === 'wait') { steps.push({ actions: [], ms }); continue; }
    const actions = m[1].split('+').map((a) => {
      const found = ACTIONS.find((x) => x.toLowerCase() === a.toLowerCase());
      if (!found) throw new Error(`Unknown action "${a}". Use: ${ACTIONS.join(', ')}, wait`);
      return found;
    });
    steps.push({ actions, ms });
  }
  if (!steps.length) throw new Error('Macro is empty');
  return steps;
}

// ------------------------------------------------------------------ storage

const STORAGE_KEY = 'robot-bash.controls.v1';

export function loadProfiles(): ControlProfile[] {
  const defaults = [defaultProfile(0), defaultProfile(1)];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const saved = JSON.parse(raw) as ControlProfile[];
    return defaults.map((d, i) => ({ ...d, ...saved[i], bindings: { ...d.bindings, ...saved[i]?.bindings } }));
  } catch {
    return defaults;
  }
}

export function saveProfiles(profiles: ControlProfile[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  } catch {
    // Storage unavailable (private mode etc.) — settings just won't persist.
  }
}
