import { describe, expect, test } from 'vitest';
import { defaultProfile, parseMacro, type Binding } from '../src/input/bindings';
import { MacroRunner, keyLevel, mixControls, withTouch } from '../src/input/input';
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

  test('drive keys ramp up while held, weapon keys do not', () => {
    const p = defaultProfile(0);
    // A reader like the real one: keys ramp on the drive channel only.
    const held = (t: number) => (b: Binding, drive?: boolean) => (b.device === 'key' && ['KeyW', 'KeyE'].includes(b.code) ? (drive ? keyLevel(t, 0.25) : 1) : 0);
    const tap = mixControls(p, held(0), new Set());
    const hold = mixControls(p, held(1), new Set());
    expect(tap.left).toBeGreaterThan(0.2);
    expect(tap.left).toBeLessThan(0.5);
    expect(hold.left).toBe(1);
    expect(tap.weapon).toBe(true);
    expect(keyLevel(0, 0)).toBe(1);
  });

  test('the touch stick drives like an arcade stick, and adds to the keys', () => {
    const p = defaultProfile(0);
    const none = mixControls(p, keys(), new Set());
    const up = withTouch(none, { x: 0, y: -1, buttons: [false, false, false, false] }, p);
    expect(up).toMatchObject({ left: 1, right: 1 });
    const right = withTouch(none, { x: 1, y: 0, buttons: [false, false, false, false] }, p);
    expect(right.left).toBeGreaterThan(0);
    expect(right.right).toBeLessThan(0);
    // Stick centred: the keyboard still drives; a touch button fires.
    const keysOnly = withTouch(mixControls(p, keys('KeyW'), new Set()), { x: 0, y: 0, buttons: [true, false, false, false] }, p);
    expect(keysOnly).toMatchObject({ left: 1, right: 1, weapon: true });
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
  test('centred sticks brake a drive motor, but let a weapon coast', () => {
    const half = (m.freeSpeed * Math.PI) / 60;
    const brake = dcMotor(m, 24, 0, half, 1, true);
    expect(brake.torque).toBeCloseTo(-m.stallTorque / 2);
    expect(brake.current).toBe(0);
    expect(dcMotor(m, 24, 0, half).torque).toBe(0);
  });
});
