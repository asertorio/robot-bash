import { describe, expect, it } from 'vitest';
import { FLIPSIDE, WEDGEHOG, WHIRLWIND } from '../src/data/templates';
import { HOUSE_ROBOTS } from '../src/data/house';
import { CpuDriver } from '../src/sim/ai';
import { Match } from '../src/sim/match';
import { applyState, captureState, fromWire, toWire } from '../src/sim/netstate';
import { run } from './helpers';

/** Online play: a guest's Match mirrors the host's from snapshots alone. */
describe('network mirror', () => {
  it('a guest built from the same designs ends up where the host is', () => {
    const designs = [WEDGEHOG, WHIRLWIND];
    const opts = { skipCountdown: true, house: HOUSE_ROBOTS.slice(0, 2) };
    const host = new Match(designs, opts);
    const guest = new Match(designs, opts);
    const cpus = [new CpuDriver(), new CpuDriver()];
    run(host, 4, () => host.competitors.map((r, i) => cpus[i].update(r, host.competitors[1 - i], false, 1 / 480)));
    // A plate torn off on the host comes off on the guest too.
    const wedge = host.competitors[0].parts.find((p) => p.kind === 'structure' && p.def?.parent)!;
    host.competitors[0].mirrorDetach(wedge);
    run(host, 0.5);

    // Through the wire format (JSON, five significant figures), as online.
    applyState(guest, fromWire(JSON.parse(JSON.stringify(toWire(captureState(host, 0))))));
    host.robots.forEach((r, i) => {
      const g = guest.robots[i];
      expect(g.position.x).toBeCloseTo(r.position.x, 3);
      expect(g.position.z).toBeCloseTo(r.position.z, 3);
      expect(g.rotation.w).toBeCloseTo(r.rotation.w, 3);
      r.parts.forEach((p, k) => {
        expect(g.parts[k].detached).toBe(p.detached);
        expect(g.parts[k].condition).toBeCloseTo(p.condition, 3);
        if (p.body && p.detached) expect(g.parts[k].body!.translation().y).toBeCloseTo(p.body.translation().y, 3);
      });
    });
    // Spinner speed (for its sound and blur) and the clock come across.
    expect(guest.robots[1].rotors()[0].rpm).toBeCloseTo(host.robots[1].rotors()[0].rpm, 0);
    expect(guest.time).toBeCloseTo(host.time, 6);
    host.free();
    guest.free();
  });

  it('commentary arrives once, and a half-way blend sits between two snapshots', () => {
    const designs = [FLIPSIDE, WEDGEHOG];
    const host = new Match(designs, { skipCountdown: true });
    const guest = new Match(designs, { skipCountdown: true });
    const go = () => [{ left: 1, right: 1, weapon: false, weapon2: false }, { left: 0, right: 0, weapon: false, weapon2: false }];
    run(host, 0.5, go);
    const a = captureState(host, 0);
    run(host, 0.2, go);
    host.commentary.push({ time: host.time, text: 'Test line', level: 'info' });
    const b = captureState(host, a.commentary.length);
    applyState(guest, a);
    applyState(guest, b, a, 0.5);
    applyState(guest, b);
    expect(guest.commentary.filter((l) => l.text === 'Test line')).toHaveLength(1);
    // Blend: half-way along the robot's path between the two snapshots.
    const za = a.poses[0][2], zb = b.poses[0][2];
    applyState(guest, b, a, 0.5);
    expect(guest.robots[0].chassis.translation().z).toBeCloseTo((za + zb) / 2, 3);
    host.free();
    guest.free();
  });
});

describe('designs sent online', () => {
  it('every built-in robot comes through JSON and checkDesign with the same parts and bodies', async () => {
    const { checkDesign } = await import('../src/data/garage');
    const { TEMPLATES, OPEN_CLASS } = await import('../src/data/templates');
    const { MONSTER_HOUSE } = await import('../src/data/house');
    for (const d of [...TEMPLATES, ...OPEN_CLASS, ...HOUSE_ROBOTS, ...MONSTER_HOUSE]) {
      const sent = checkDesign(JSON.parse(JSON.stringify(d)));
      const a = new Match([d], { skipCountdown: true });
      const b = new Match([sent], { skipCountdown: true });
      expect(b.robots[0].parts.map((p) => p.id), d.name).toEqual(a.robots[0].parts.map((p) => p.id));
      expect(captureState(b, 0).poses[0].length, d.name).toBe(captureState(a, 0).poses[0].length);
      a.free();
      b.free();
    }
  });
});
