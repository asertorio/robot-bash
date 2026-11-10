import { describe, expect, it } from 'vitest';
import { WEDGEHOG } from '../src/data/templates';
import { Match } from '../src/sim/match';
import { REPLAY, ReplayPlayer, ReplayRecorder } from '../src/render/replay';
import { drive, run, spawnAt } from './helpers';

describe('action replay', () => {
  it('plays back where the robot was, slowed down, with parts that later came off still on', () => {
    const m = new Match([WEDGEHOG], { skipCountdown: true, sandbox: true, spawns: spawnAt([0, -3, 0]) });
    const rec = new ReplayRecorder();
    rec.reset(m);
    run(m, 2, () => [drive(1)], () => rec.record(m));
    const r = m.robots[0];
    const wedge = r.parts.find((p) => p.kind === 'structure' && p.def?.parent)!;
    r.mirrorDetach(wedge);
    run(m, 0.3, () => [drive(0)], () => rec.record(m));

    const chassis = rec.chassisIndex(m, 0);
    const clip = rec.last(2, chassis, 'test')!;
    expect(clip.frames.length).toBeGreaterThan(50);
    const player = new ReplayPlayer(clip);
    const first = player.advance(0);
    // It drove forward (+z) during the clip: the replay starts further back than it ends.
    expect(first.target.z).toBeLessThan(r.position.z - 0.5);
    // The wedge was still bolted on at the start of the clip: drawn there, near the chassis.
    const w = r.parts.indexOf(wedge) * 8;
    expect(first.poses[w + 7]).toBe(1);
    expect(Math.hypot(first.poses[w] - first.target.x, first.poses[w + 2] - first.target.z)).toBeLessThan(0.7);
    // Playback is slowed: 2 s of fight takes 2 / speed seconds to show.
    let t = 0;
    while (!player.done && t < 20) { player.advance(0.05); t += 0.05; }
    expect(t).toBeGreaterThan((clip.frames[clip.frames.length - 1].time - clip.frames[0].time) / REPLAY.speed - 0.2);
    m.free();
  });

  it('keeps the biggest hit, with time either side of it', () => {
    const m = new Match([WEDGEHOG], { skipCountdown: true, sandbox: true });
    const rec = new ReplayRecorder();
    rec.reset(m);
    run(m, 3, () => [drive(0)], () => {
      if (Math.abs(m.time - 1) < 1e-3) rec.bigHit(m.time, 2000, { x: 0, y: 0, z: 0 });
      if (Math.abs(m.time - 1.2) < 1e-3) rec.bigHit(m.time, 500, { x: 1, y: 0, z: 0 });
      rec.record(m);
    });
    const best = rec.bestHit()!;
    expect(best.energy).toBe(2000);
    expect(best.frames[0].time).toBeLessThan(0.1);
    expect(best.frames[best.frames.length - 1].time).toBeGreaterThan(2.3);
    m.free();
  });
});
