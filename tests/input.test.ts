import { describe, expect, test } from 'vitest';
import { defaultProfile, parseMacro, type Binding } from '../src/input/bindings';
import { MacroRunner, mixControls } from '../src/input/input';
import { dcMotor } from '../src/sim/motor';
import { MOTORS } from '../src/data/parts';

const keys = (...down: string[]) => (b: Binding) => (b.device === 'key' && down.includes(b.code) ? 1 : 0);

describe('mixing', () => {
  test('arcade: forward + right turns right while moving forward', () => {
    const p = defaultProfile(0);
    const c = mixControls(p, keys('KeyW', 'KeyD'), new Set());
    expect(c.left).toBeGreaterThan(c.right);
    expect(c.left).toBeLessThanOrEqual(1);
  });

  test('tank: each side has its own control', () => {
    const p = { ...defaultProfile(0), mode: 'tank' as const };
    const c = mixControls(p, keys('KeyW', 'KeyF'), new Set());
    expect(c).toMatchObject({ left: 1, right: -1 });
  });

  test('player 2 defaults do not overlap player 1', () => {
    const codes = (i: number) => Object.values(defaultProfile(i).bindings).flat().flatMap((b) => (b.device === 'key' ? [b.code] : []));
    const p1 = new Set(codes(0));
    expect(codes(1).filter((c) => p1.has(c))).toEqual([]);
  });
});

describe('macros', () => {
  test('parses steps and combined actions', () => {
    expect(parseMacro('weapon 150, back+left 300, wait 100')).toEqual([
      { actions: ['weapon'], ms: 150 },
      { actions: ['back', 'left'], ms: 300 },
      { actions: [], ms: 100 },
    ]);
  });

  test('rejects unknown actions with a helpful message', () => {
    expect(() => parseMacro('jump 100')).toThrow(/Unknown action "jump"/);
  });

  test('runs steps in order on a trigger press', () => {
    const p = defaultProfile(0);
    p.macros = [{ name: 't', trigger: { device: 'key', code: 'KeyC' }, script: 'weapon 100, back 200' }];
    const r = new MacroRunner();
    r.update(p, keys('KeyC'), 16);
    expect([...r.active]).toEqual(['weapon']);
    for (let i = 0; i < 8; i++) r.update(p, keys(), 16);
    expect([...r.active]).toEqual(['back']);
    for (let i = 0; i < 20; i++) r.update(p, keys(), 16);
    expect(r.active.size).toBe(0);
  });
});

describe('DC motor model', () => {
  const m = MOTORS.dm750;
  test('stall torque at zero speed, nothing at free speed', () => {
    expect(dcMotor(m, 24, 1, 0).torque).toBeCloseTo(m.stallTorque);
    expect(dcMotor(m, 24, 1, (m.freeSpeed * 2 * Math.PI) / 60).torque).toBeCloseTo(0);
  });
  test('over-volting makes it stronger', () => {
    expect(dcMotor(m, 36, 1, 0).torque).toBeCloseTo(m.stallTorque * 1.5);
  });
});
