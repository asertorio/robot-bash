import type { CommentaryVoice } from '../data/settings';
import type { CommentaryLine, Match } from '../sim/match';

/**
 * A spoken commentator, using the browser's own speech synthesis (no
 * downloads, no server). It reads the same commentary the feed shows, plus a
 * few things only a commentator says: the line-up during the countdown and
 * the clock ("one minute gone").
 *
 * Speech is slow next to a fight, so it never queues up a backlog: a line
 * that's waited more than a couple of seconds is dropped, a major moment (a
 * knock-out, a big hit) cuts off whatever minor line is being read, and in
 * 'highlights' mode only major lines are read at all.
 */

export const VOICE = {
  /** A line older than this (match seconds) when its turn comes isn't worth saying. */
  stale: 2.5,
  rate: 1.12,
  pitch: 1,
  /** Quiet spells longer than this (s) get a bit of colour, in 'full' mode. */
  fill: 14,
};

const FILLERS = [
  'Very cagey, this.',
  'Plenty of manoeuvring, not much contact.',
  'Somebody needs to commit!',
  'The crowd want to see some action!',
  'They\'re sizing each other up.',
];

export class Commentator {
  private mode: CommentaryVoice = 'highlights';
  private match: Match | null = null;
  private seen = 0;
  private speaking: { level: CommentaryLine['level'] } | null = null;
  private pending: { text: string; level: CommentaryLine['level']; time: number } | null = null;
  private voice: SpeechSynthesisVoice | null = null;
  private said = new Set<string>();
  private lastSpoke = 0;
  private synth: SpeechSynthesis | null = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;

  constructor() {
    const pick = () => {
      const voices = this.synth?.getVoices() ?? [];
      // A British voice if there is one: it's a British show.
      this.voice = voices.find((v) => v.lang === 'en-GB' && /male|daniel|arthur|george|ryan/i.test(v.name))
        ?? voices.find((v) => v.lang === 'en-GB') ?? voices.find((v) => v.lang.startsWith('en')) ?? null;
    };
    pick();
    this.synth?.addEventListener?.('voiceschanged', pick);
  }

  get available(): boolean { return this.synth !== null; }

  setMode(mode: CommentaryVoice) {
    this.mode = mode;
    if (mode === 'off') this.stop();
  }

  /** A new fight to commentate (null: stop talking). */
  setMatch(m: Match | null) {
    this.stop();
    this.match = m;
    this.seen = m ? m.commentary.length : 0;
    this.said.clear();
    this.lastSpoke = 0;
    if (!m || this.mode === 'off') return;
    const names = m.competitors.map((r) => r.design.name);
    const intro = names.length === 2 ? `${names[0]} versus ${names[1]}!`
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}. It's a ${names.length}-way melee!`;
    this.queue(intro, 'major', m.time);
  }

  stop() {
    this.pending = null;
    this.speaking = null;
    try { this.synth?.cancel(); } catch { /* nothing to cancel */ }
  }

  update() {
    const m = this.match;
    if (!m || this.mode === 'off' || !this.synth) return;
    while (this.seen < m.commentary.length) {
      const l = m.commentary[this.seen++];
      if (l.text === 'Activate!') { this.queue('Activate!', 'major', l.time); continue; }
      if (this.mode === 'highlights' && l.level !== 'major') continue;
      this.queue(l.text, l.level, l.time);
    }
    if (m.phase === 'fight') this.clock(m);
    this.flush(m.time);
  }

  /** The clock, once each: one minute gone, a minute left, ten seconds. */
  private clock(m: Match) {
    const left = m.duration - m.time;
    const once = (key: string, text: string, when: boolean) => {
      if (!when || this.said.has(key)) return;
      this.said.add(key);
      this.queue(text, 'major', m.time);
    };
    once('1gone', 'One minute gone.', m.time >= 60 && m.time < 61 && m.duration > 100);
    once('1left', 'One minute left!', left <= 60 && left > 59 && m.duration > 100);
    once('10left', 'Ten seconds to go!', left <= 10 && left > 9);
    if (this.mode === 'full' && m.time - this.lastSpoke > VOICE.fill && !this.pending && !this.synth?.speaking) {
      this.queue(FILLERS[Math.floor(m.time) % FILLERS.length], 'info', m.time);
    }
  }

  private queue(text: string, level: CommentaryLine['level'], time: number) {
    // Never let a minor line bump a major one waiting to be said.
    if (this.pending && this.pending.level === 'major' && level !== 'major') return;
    this.pending = { text, level, time };
    // A major moment interrupts a minor line already being read.
    if (level === 'major' && this.speaking?.level === 'info') this.synth?.cancel();
  }

  private flush(now: number) {
    const p = this.pending;
    if (!p || !this.synth) return;
    if (this.synth.speaking || this.synth.pending) return;
    this.pending = null;
    if (now - p.time > VOICE.stale) return;
    const u = new SpeechSynthesisUtterance(speakable(p.text));
    if (this.voice) u.voice = this.voice;
    u.lang = this.voice?.lang ?? 'en-GB';
    u.rate = VOICE.rate * (p.level === 'major' ? 1.05 : 1);
    u.pitch = VOICE.pitch;
    this.speaking = { level: p.level };
    u.onend = u.onerror = () => { this.speaking = null; };
    this.lastSpoke = now;
    this.synth.speak(u);
  }
}

/** Feed text → something that reads aloud well. */
function speakable(text: string): string {
  return text
    .replace(/…8, 9, 10 — out!/, '... eight, nine, ten. Out!')
    .replace(/ — /g, ', ')
    .replace(/…/g, '...')
    .replace(/(\d+(?:\.\d)?) kJ/g, '$1 kilojoules');
}
