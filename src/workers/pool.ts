import type { MatchOptions } from '../sim/match';
import { fightBout, type BoutResult, type Entrant } from '../sim/tournament';
import type { BoutDone, BoutJob } from './bout.worker';

/**
 * Runs championship bouts on background workers, one per spare CPU core (up
 * to three: a round has at most three bouts the player isn't in). Without
 * workers, a bout is fought on the page instead, which stalls it while it runs.
 */
export class BoutPool {
  private workers: Worker[] = [];
  private queue: Array<{ job: BoutJob; resolve: (r: BoutResult) => void }> = [];
  private busy = new Map<Worker, (r: BoutResult) => void>();
  private nextId = 1;

  constructor() {
    const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency ?? 2) - 1));
    try {
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./bout.worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e: MessageEvent<BoutDone>) => {
          const done = this.busy.get(w);
          this.busy.delete(w);
          done?.(e.data.result);
          this.pump();
        };
        this.workers.push(w);
      }
    } catch {
      this.workers = [];
    }
  }

  fight(entrants: [Entrant, Entrant], opts: MatchOptions): Promise<BoutResult> {
    // Designs and wear are plain data; copy them so later edits can't race the worker.
    const job: BoutJob = { id: this.nextId++, entrants: JSON.parse(JSON.stringify(entrants)), opts: JSON.parse(JSON.stringify(opts)) };
    if (!this.workers.length) {
      return new Promise((resolve) => setTimeout(() => resolve(fightBout(job.entrants, job.opts)), 50));
    }
    return new Promise((resolve) => { this.queue.push({ job, resolve }); this.pump(); });
  }

  private pump() {
    for (const w of this.workers) {
      if (this.busy.has(w) || !this.queue.length) continue;
      const { job, resolve } = this.queue.shift()!;
      this.busy.set(w, resolve);
      w.postMessage(job);
    }
  }

  /** Stop everything (leaving the championship). */
  dispose() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.queue = [];
    this.busy.clear();
  }
}
