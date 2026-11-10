import RAPIER from '@dimforge/rapier3d-compat';
import { fightBout, type BoutResult, type Entrant } from '../sim/tournament';
import type { MatchOptions } from '../sim/match';

/**
 * Championship bouts nobody's playing, fought on another CPU core so the
 * page doesn't stutter: the same Match and CPU drivers as anywhere else,
 * just with nobody watching.
 */
export interface BoutJob { id: number; entrants: [Entrant, Entrant]; opts: MatchOptions }
export interface BoutDone { id: number; result: BoutResult }

const ready = RAPIER.init();
self.onmessage = async (e: MessageEvent<BoutJob>) => {
  await ready;
  const { id, entrants, opts } = e.data;
  const result = fightBout(entrants, opts);
  (self as unknown as Worker).postMessage({ id, result } satisfies BoutDone);
};
