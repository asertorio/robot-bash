import type { RobotDesign } from '../sim/design';
import type { MatchOptions } from '../sim/match';
import { pairUp, type BoutResult, type Entrant } from '../sim/tournament';
import type { BoutPool } from '../workers/pool';

/** One round of the bracket: who fights whom, and how each bout went. */
export interface Round {
  pairs: Array<[number, number]>;
  results: Array<BoutResult | null>;
  /** Bouts already sent off to be fought (not the player's). */
  started: boolean[];
}

/**
 * A championship in progress: eight entrants (the player is entrant 0),
 * a knockout bracket, damage carried between rounds. Other bouts are fought
 * on workers as soon as their round begins; the next round starts once
 * every bout in this one has a result.
 */
export class Championship {
  readonly entrants: Entrant[];
  readonly rounds: Round[] = [];
  champion: number | null = null;
  /** Called whenever a result comes in (to redraw the bracket). */
  onChange: () => void = () => {};

  constructor(you: RobotDesign, field: RobotDesign[], readonly houseCount: number, private pool: BoutPool, private options: () => MatchOptions) {
    this.entrants = [{ design: you, human: true, wear: null }, ...field.map((design) => ({ design, human: false, wear: null }))];
    // A random draw, with the player somewhere in it.
    const order = [...this.entrants.keys()].sort(() => Math.random() - 0.5);
    this.startRound(pairUp(order));
  }

  get round(): Round {
    return this.rounds[this.rounds.length - 1];
  }

  /** The player's bout in this round, if it's still to be fought. */
  get playerBout(): number | null {
    if (this.champion !== null) return null;
    const k = this.round.pairs.findIndex(([a, b]) => this.entrants[a].human || this.entrants[b].human);
    return k >= 0 && !this.round.results[k] ? k : null;
  }

  /** Is the player still in? */
  get playerIn(): boolean {
    return this.rounds.every((r) => r.results.every((res, k) => !res || !r.pairs[k].some((e) => this.entrants[e].human) || this.entrants[res.winner].human));
  }

  private startRound(pairs: Array<[number, number]>) {
    const round: Round = { pairs, results: pairs.map(() => null), started: pairs.map(() => false) };
    this.rounds.push(round);
    pairs.forEach(([a, b], k) => {
      if (this.entrants[a].human || this.entrants[b].human) return;
      round.started[k] = true;
      void this.pool.fight([this.entrants[a], this.entrants[b]], this.options()).then((r) => {
        if (this.rounds.includes(round)) this.record(round, k, { ...r, winner: r.winner === 0 ? a : b });
      });
    });
  }

  /** A bout's result, with `winner` as an entrant index and wear in pair order. */
  record(round: Round, k: number, res: BoutResult) {
    const [a, b] = round.pairs[k];
    round.results[k] = res;
    this.entrants[a].wear = res.wear[0];
    this.entrants[b].wear = res.wear[1];
    if (round === this.round && round.results.every(Boolean)) {
      const winners = round.results.map((r) => r!.winner);
      if (winners.length === 1) this.champion = winners[0];
      else this.startRound(pairUp(winners));
    }
    this.onChange();
  }

  /** The player's own bout (fought in the arena) is over. */
  playerResult(youWon: boolean, reason: string, youWear: number[], oppWear: number[]) {
    const k = this.playerBout;
    if (k === null) return;
    const [a, b] = this.round.pairs[k];
    const youFirst = this.entrants[a].human;
    const [you, opp] = youFirst ? [a, b] : [b, a];
    this.record(this.round, k, { winner: youWon ? you : opp, reason, wear: youFirst ? [youWear, oppWear] : [oppWear, youWear], highlights: [] });
  }

  /** The player's bout, as [you, opponent] entrant indices (you first). */
  playerPair(): [number, number] | null {
    const k = this.playerBout;
    if (k === null) return null;
    const [a, b] = this.round.pairs[k];
    return this.entrants[a].human ? [a, b] : [b, a];
  }
}
