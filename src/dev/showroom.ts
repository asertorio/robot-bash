import RAPIER from '@dimforge/rapier3d-compat';
import { HOUSE_ROBOTS } from '../data/house';
import { CRASH_TEST_DUMMY, TEMPLATES } from '../data/templates';
import { MatchView } from '../render/view';
import { Match } from '../sim/match';

/**
 * Dev showroom: one robot under a close camera, for checking how robots look.
 * showroom.html?robot=flipside&yaw=0.6&pitch=0.4&dist=2&fire=1
 */
const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);

RAPIER.init().then(() => {
  const all = [...TEMPLATES, ...HOUSE_ROBOTS, CRASH_TEST_DUMMY];
  const design = all.find((d) => d.id === q.get('robot')) ?? all[0];
  const view = new MatchView(document.getElementById('view') as HTMLCanvasElement);
  const match = new Match([design], { sandbox: true, skipCountdown: true, spawns: [{ pos: { x: 0, y: 0.01, z: 0 }, yaw: num('heading', 0) }] });
  // ?damage=0.6 knocks every part down to that much wear, to check battle damage.
  if (q.has('damage')) for (const p of match.robots[0].parts) p.condition = Math.min(p.condition, 1 - num('damage', 0.5));
  view.setMatch(match);
  view.cameraMode = 'follow';
  view.setOrbit(num('yaw', 0.7), num('pitch', 0.42), num('dist', 2.2));
  const fire = q.get('fire') === '1';
  let last = performance.now(), t = 0;
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; t += dt;
    match.update(dt, [{ left: 0, right: 0, weapon: fire && t > 0.6, weapon2: false }]);
    view.render(dt);
    (window as unknown as { ready: boolean }).ready = t > 1.2;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
});
