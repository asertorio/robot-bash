import { describe, expect, test } from 'vitest';
import { TEMPLATES } from '../src/data/templates';
import { HOUSE_ROBOTS } from '../src/data/house';
import { decodeDesign, designFromHash, encodeDesign, shareUrl } from '../src/data/share';

const BASE = 'https://example.org/robot-bash/';

describe('share links', () => {
  test.each(TEMPLATES.map((t) => [t.name, t]))('%s survives a round trip through a share code', async (_, d) => {
    const code = await encodeDesign(d);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    // Compare as JSON: that's exactly what a save or export keeps.
    expect(JSON.parse(JSON.stringify(await decodeDesign(code)))).toEqual(JSON.parse(JSON.stringify(d)));
  });

  test('links to the built-in robots are short enough for chat apps', async () => {
    const lengths = (await Promise.all([...TEMPLATES, ...HOUSE_ROBOTS].map((d) => shareUrl(BASE, d)))).map((u) => u.length).sort((a, b) => a - b);
    const median = lengths[Math.floor(lengths.length / 2)];
    console.log(`share link lengths (${lengths.length} robots): min ${lengths[0]}, median ${median}, max ${lengths.at(-1)}`);
    expect(median).toBeLessThan(2000);
  });

  test('designFromHash reads a share link and ignores other fragments', async () => {
    const d = TEMPLATES[0];
    const url = await shareUrl(BASE, d);
    expect(url.startsWith(`${BASE}#robot=`)).toBe(true);
    const hash = url.slice(url.indexOf('#'));
    expect((await designFromHash(hash))?.name).toBe(d.name);
    expect((await designFromHash(hash.slice(1)))?.name).toBe(d.name);
    expect(await designFromHash('')).toBeNull();
    expect(await designFromHash('#controls')).toBeNull();
    expect(await designFromHash('#robot=not-a-robot')).toBeNull();
  });

  test('garbage and cut-short codes are rejected with a reason', async () => {
    const code = await encodeDesign(TEMPLATES[0]);
    await expect(decodeDesign('')).rejects.toThrow();
    await expect(decodeDesign('hello world!')).rejects.toThrow(/characters/);
    await expect(decodeDesign('AAAAAAAAAAAA')).rejects.toThrow();
    await expect(decodeDesign(code.slice(0, Math.floor(code.length / 2)))).rejects.toThrow(/damaged|cut short/);
    await expect(decodeDesign(code.slice(0, -3))).rejects.toThrow();
    // Valid deflate of JSON that isn't a robot still goes through checkDesign.
    const notRobot = await encodeDesign({ schema: 2, name: 'Nothing', parts: [] } as never);
    await expect(decodeDesign(notRobot)).rejects.toThrow(/no parts/);
  });
});
