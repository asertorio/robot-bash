import type { HouseSet } from './house';
import type { GameEvent } from '../sim/match';

export type SoundLevel = 'off' | 'quiet' | 'loud';
export type CommentaryVoice = 'off' | 'highlights' | 'full';

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
  /** Competitors per fight: 2 (a duel) or 3–4 (a melee). */
  robots: number;
  /** Fight camera to start with: the TV gantry view, or behind your robot. V (or a pad's Back) switches mid-fight. */
  camera: 'tv' | 'chase';
  /** Fight sounds: motors, spinners, impacts, the crowd. */
  sound: SoundLevel;
  /** Spoken commentary: off, big moments only, or everything. */
  voice: CommentaryVoice;
  /** An action replay of the knockout or the biggest hit before the result. */
  replays: boolean;
  /** What the select screen starts: a fight, sumo or football. */
  event: GameEvent;
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
  robots: 2,
  camera: 'tv',
  sound: 'loud',
  voice: 'highlights',
  replays: true,
  event: 'fight',
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
