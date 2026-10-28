import type { RobotDesign } from '../sim/design';
import { computeStats } from '../sim/stats';

const KEY = 'robot-bash.designs.v1';

/** The player's own robots, kept in this browser. */
export function loadDesigns(): RobotDesign[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as unknown[]).flatMap((d) => {
      try { return [checkDesign(d)]; } catch { return []; }
    });
  } catch {
    return [];
  }
}

function store(list: RobotDesign[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable: designs last for this session only.
  }
}

export function saveDesign(d: RobotDesign): RobotDesign[] {
  const list = loadDesigns().filter((x) => x.id !== d.id);
  list.push(d);
  store(list);
  return list;
}

export function deleteDesign(id: string): RobotDesign[] {
  const list = loadDesigns().filter((x) => x.id !== id);
  store(list);
  return list;
}

/** Validate untrusted JSON (an import or old save) as a RobotDesign. Throws with a readable reason. */
export function checkDesign(raw: unknown): RobotDesign {
  const d = raw as RobotDesign;
  if (!d || typeof d !== 'object') throw new Error('Not a robot design.');
  if (d.schema !== 1) throw new Error('Unknown design version.');
  if (typeof d.name !== 'string' || !Array.isArray(d.shell) || !d.drive || !Array.isArray(d.drive.wheels) || !d.battery || !Array.isArray(d.weapons)) {
    throw new Error('The design is missing parts (name, shell, drive, battery or weapons).');
  }
  d.skids ??= [];
  d.colour = /^#[0-9a-f]{6}$/i.test(d.colour) ? d.colour : '#8e44ad';
  d.id ||= `custom-${Date.now().toString(36)}`;
  computeStats(d); // throws on unknown parts or materials
  return d;
}

export function parseDesign(text: string): RobotDesign {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That isn't valid JSON.");
  }
  return checkDesign(raw);
}
