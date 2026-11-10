import type { RobotDesign } from '../sim/design';
import { checkDesign } from './garage';

/**
 * Share links: a robot packed into the URL fragment, `…#robot=<code>`.
 *
 * The code is the design's JSON, deflated (raw DEFLATE, no zlib header) and
 * written as URL-safe base64 without padding. Designs are mostly repeated keys
 * and short numbers, so deflate shrinks them several times over, which keeps
 * links short enough for chat apps. It sits in the fragment rather than the
 * query string because the fragment is never sent to the server, so a static
 * host (GitHub Pages) serves the same page for every robot.
 *
 * Pure functions on strings: CompressionStream and btoa/atob exist in modern
 * browsers and Node 18+, so this runs (and is tested) headlessly.
 */

const HASH_KEY = 'robot=';

/** Bytes → URL-safe base64 (RFC 4648 §5), no `=` padding. */
function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  // Chunked so a big design doesn't overflow the argument limit of fromCharCode.
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('That share code has characters that don\'t belong in it.');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  let bin: string;
  try { bin = atob(b64); } catch { throw new Error('That share code is damaged.'); }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Run bytes through a (de)compression stream and collect the result. */
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** A design as a compact, URL-safe share code. */
export async function encodeDesign(d: RobotDesign): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(d));
  return toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

/** A share code back to a design, validated like any other untrusted import. Throws with a readable reason. */
export async function decodeDesign(code: string): Promise<RobotDesign> {
  const packed = fromBase64Url(code.trim());
  if (!packed.length) throw new Error('That share code is empty.');
  let text: string;
  try {
    // fatal: a code cut short mid-character fails here rather than parsing as junk.
    text = new TextDecoder('utf-8', { fatal: true }).decode(await pipe(packed, new DecompressionStream('deflate-raw')));
  } catch {
    throw new Error('That share code is damaged or cut short.');
  }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('That share code is damaged or cut short.'); }
  return checkDesign(raw);
}

/** A link that opens this design: `base` is the page address without a fragment. */
export async function shareUrl(base: string, d: RobotDesign): Promise<string> {
  return `${base}#${HASH_KEY}${await encodeDesign(d)}`;
}

/**
 * The design in a page fragment such as `location.hash` (with or without the
 * leading `#`), or null when there isn't one or it won't decode — a bad link
 * just opens the game as normal.
 */
export async function designFromHash(hash: string): Promise<RobotDesign | null> {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const code = params.get(HASH_KEY.slice(0, -1));
  if (!code) return null;
  try { return await decodeDesign(code); } catch { return null; }
}
