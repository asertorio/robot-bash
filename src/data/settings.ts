import type { HouseSet } from './house';

/** Game options, kept in this browser. */
export interface Settings {
  /** 'brutal' doubles all damage: armour tears sooner, fights end sooner. */
  damage: 'realistic' | 'brutal';
  /** Slow motion for a moment after a really big hit. */
  slowMotion: boolean;
  /** The camera shakes on big hits. */
  shake: boolean;
  /** The referee pulls apart robots locked together going nowhere. */
  breaks: boolean;
  /** Last 30 seconds: the pit opens and the house robots leave their corners. */
  finale: boolean;
  /** Which house robots guard the corners. */
  houseSet: HouseSet;
  /** Fight length, seconds. */
  fightLength: number;
  /**
   * Touch stick: 'point' drives the robot the way the stick points on screen;
   * 'robot' is the classic RC mix (up = the robot's forward, sideways steers).
   */
  stick: 'point' | 'robot';
}

export const DEFAULT_SETTINGS: Settings = {
  damage: 'realistic',
  slowMotion: true,
  shake: true,
  breaks: true,
  finale: true,
  houseSet: 'classic',
  fightLength: 180,
  stick: 'point',
};

const KEY = 'robot-bash.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable: settings last for this session only.
  }
}

export const damageScale = (s: Settings): number => (s.damage === 'brutal' ? 2 : 1);
