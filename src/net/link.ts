import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import type { ControlState } from '../sim/control';
import type { RobotDesign } from '../sim/design';
import type { WireState } from '../sim/netstate';
import type { GameEvent } from '../sim/match';

/**
 * Two devices, one fight. A WebRTC data channel between the two browsers
 * (PeerJS); the free public PeerJS server only introduces them — once
 * they're connected, the fight goes straight from one to the other.
 *
 * The host shows a four-letter room code, the guest types it in. The host
 * runs the physics; the guest sends its controls and draws the host's
 * snapshots (sim/netstate.ts).
 */
export type NetMessage =
  | { type: 'hello'; design: RobotDesign }
  | { type: 'lobby'; host: string; guest: string | null }
  | { type: 'start'; designs: RobotDesign[]; house: RobotDesign[]; duration: number; damageScale: number; breaks: boolean; finale: boolean; event?: GameEvent; wallSpikes?: boolean }
  | { type: 'ctl'; c: ControlState }
  | { type: 'state'; s: WireState }
  | { type: 'leave' };

/** Room codes avoid letters that look alike (I/1, O/0). */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PREFIX = 'robot-bash-v1-';

export function newRoomCode(): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

/**
 * The matchmaking server: PeerJS's free public one, unless the page says
 * otherwise (`?peer=localhost:9000` for a local PeerServer when developing).
 */
function serverOptions(): PeerOptions {
  const custom = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('peer') : null;
  if (!custom) return {};
  const [host, port] = custom.split(':');
  // Local testing: no STUN/TURN servers, just the machine's own addresses.
  return { host, port: Number(port) || 9000, path: '/', secure: false, config: { iceServers: [] } };
}

export class NetLink {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  onMessage: (m: NetMessage) => void = () => {};
  onOpen: () => void = () => {};
  onClose: (why: string) => void = () => {};
  readonly role: 'host' | 'guest';
  readonly code: string;

  private constructor(role: 'host' | 'guest', code: string) {
    this.role = role;
    this.code = code;
  }

  get connected(): boolean {
    return !!this.conn?.open;
  }

  /** Host: register the room code and wait for a guest. */
  static host(code: string, onReady: () => void, onError: (why: string) => void): NetLink {
    const link = new NetLink('host', code);
    const peer = new Peer(PREFIX + code, serverOptions());
    link.peer = peer;
    peer.on('open', onReady);
    peer.on('error', (e) => onError(describe(e)));
    peer.on('connection', (c) => {
      // One guest at a time.
      if (link.conn?.open) { c.on('open', () => c.close()); return; }
      link.adopt(c);
    });
    return link;
  }

  /** Guest: connect to a host's room code. */
  static join(code: string, onError: (why: string) => void): NetLink {
    const link = new NetLink('guest', code.toUpperCase());
    const peer = new Peer(serverOptions());
    link.peer = peer;
    peer.on('error', (e) => onError(describe(e)));
    peer.on('open', () => link.adopt(peer.connect(PREFIX + link.code, { reliable: true, serialization: 'json' })));
    return link;
  }

  private adopt(c: DataConnection) {
    this.conn = c;
    c.on('open', () => this.onOpen());
    c.on('data', (d) => this.onMessage(d as NetMessage));
    c.on('close', () => { if (this.conn === c) this.onClose('The other player left.'); });
    c.on('error', () => this.onClose('The connection dropped.'));
  }

  send(m: NetMessage) {
    if (this.conn?.open) this.conn.send(m);
  }

  close() {
    try { this.send({ type: 'leave' }); } catch { /* gone already */ }
    this.onClose = () => {};
    this.conn?.close();
    this.peer?.destroy();
    this.conn = null;
    this.peer = null;
  }
}

function describe(e: unknown): string {
  const type = (e as { type?: string }).type;
  if (type === 'unavailable-id') return 'That room code is already in use — try again.';
  if (type === 'peer-unavailable') return 'No fight with that code. Check the code on the host\'s screen.';
  if (type === 'network' || type === 'server-error' || type === 'socket-error') return 'Couldn\'t reach the matchmaking server. Check you\'re online.';
  if (type === 'browser-incompatible') return 'This browser can\'t do online play.';
  return (e as Error).message ?? 'Something went wrong with the connection.';
}
