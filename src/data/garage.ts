import type { RobotDesign } from '../sim/design';
import { treeErrors } from '../sim/assembly';
import { fromV1, type DesignV1 } from '../sim/legacy';
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
  let d = raw as RobotDesign;
  if (!d || typeof d !== 'object') throw new Error('Not a robot design.');
  if ((d as unknown as DesignV1).schema === 1) {
    const v1 = d as unknown as DesignV1;
    if (!Array.isArray(v1.shell) || !v1.drive || !Array.isArray(v1.drive.wheels) || !v1.battery || !Array.isArray(v1.weapons)) throw new Error('The design is missing parts.');
    v1.skids ??= [];
    d = fromV1(v1);
  }
  if (d.schema !== 2) throw new Error('Unknown design version.');
  if (typeof d.name !== 'string' || !Array.isArray(d.parts) || !d.parts.length) throw new Error('The design has no parts.');
  d.colour = /^#[0-9a-f]{6}$/i.test(d.colour) ? d.colour : '#8e44ad';
  d.id ||= `custom-${Date.now().toString(36)}`;
  d.description ??= '';
  const tree = treeErrors(d);
  if (tree.length) throw new Error(tree[0]);
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
