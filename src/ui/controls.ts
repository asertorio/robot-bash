import {
  ACTION_LABELS, DEFAULT_KEY_RAMP, DRIVE_ACTIONS, TANK_ACTIONS, WEAPON_ACTIONS, defaultProfile, describeBinding, parseMacro, sameBinding,
  type Action, type Binding, type ControlProfile,
} from '../input/bindings';
import type { InputManager } from '../input/input';
import { h } from './dom';
import { PLAYER_COLOURS } from './hud';

/** The controls editor: remap anything, pick arcade/tank mixing, write macros. */
export function controlsScreen(profiles: ControlProfile[], input: InputManager, save: (p: ControlProfile[]) => void, back: () => void): HTMLElement {
  const root = h('div', { class: 'screen top' });
  let listening: string | null = null;

  const commit = () => { save(profiles); render(); };

  const capture = (id: string, done: (b: Binding) => void) => {
    listening = id;
    render();
    input.captureNext((b) => { listening = null; done(b); commit(); });
  };

  function bindingRow(p: ControlProfile, pi: number, action: Action) {
    const list = p.bindings[action];
    const id = `${pi}-${action}`;
    return h('div', { class: 'ctl-row' },
      h('span', { class: 'label' }, ACTION_LABELS[action]),
      ...list.map((b, bi) => h('span', { class: 'chip' }, describeBinding(b),
        h('button', { title: 'Remove', onclick: () => { list.splice(bi, 1); commit(); } }, '×'))),
      listening === id
        ? h('span', { class: 'chip listening' }, 'Press a key or button… (Esc cancels)')
        : h('button', { class: 'small', onclick: () => capture(id, (b) => { if (!list.some((x) => sameBinding(x, b))) list.push(b); }) }, '+ add'));
  }

  function macroRow(p: ControlProfile, pi: number, mi: number) {
    const m = p.macros[mi];
    let err = '';
    try { parseMacro(m.script); } catch (e) { err = (e as Error).message; }
    const id = `${pi}-macro-${mi}`;
    const errEl = h('div', { class: 'err' }, err);
    return h('div', { class: 'macro' },
      h('input', { type: 'text', value: m.name, placeholder: 'Name', oninput: (e: Event) => { m.name = (e.target as HTMLInputElement).value; save(profiles); } }),
      listening === id
        ? h('span', { class: 'chip listening' }, 'Press trigger…')
        : h('button', { class: 'small', onclick: () => capture(id, (b) => (m.trigger = b)) }, `Trigger: ${describeBinding(m.trigger)}`),
      h('button', { class: 'small', onclick: () => { p.macros.splice(mi, 1); commit(); } }, 'Delete'),
      h('input', {
        type: 'text', class: 'script', value: m.script, placeholder: 'weapon 150, back+left 300, wait 100',
        oninput: (e: Event) => {
          m.script = (e.target as HTMLInputElement).value;
          try { parseMacro(m.script); errEl.textContent = ''; } catch (x) { errEl.textContent = (x as Error).message; }
          save(profiles);
        },
      }),
      errEl);
  }

  function card(p: ControlProfile, pi: number) {
    const driveActions: readonly Action[] = p.mode === 'tank' ? TANK_ACTIONS : DRIVE_ACTIONS;
    return h('div', { class: 'ctl-card', style: `--pc:${PLAYER_COLOURS[pi]}` },
      h('h3', { style: `color:${PLAYER_COLOURS[pi]}` }, `Player ${pi + 1}`),
      h('div', { class: 'ctl-opts' },
        h('span', {}, 'Mixing'),
        h('span', { class: 'seg' },
          h('button', { class: p.mode === 'arcade' ? 'on' : '', onclick: () => { p.mode = 'arcade'; commit(); } }, 'Arcade'),
          h('button', { class: p.mode === 'tank' ? 'on' : '', onclick: () => { p.mode = 'tank'; commit(); } }, 'Tank')),
        p.mode === 'arcade' && h('label', {}, 'Steering ',
          h('input', { type: 'range', min: 0.2, max: 1, step: 0.05, value: p.turnRate, oninput: (e: Event) => { p.turnRate = Number((e.target as HTMLInputElement).value); save(profiles); } })),
        h('label', { title: 'How long a drive key takes to reach full power. Longer = finer control with quick taps; 0 = instant.' }, 'Key ramp ',
          h('input', { type: 'range', min: 0, max: 0.6, step: 0.05, value: p.keyRamp ?? DEFAULT_KEY_RAMP, oninput: (e: Event) => { p.keyRamp = Number((e.target as HTMLInputElement).value); save(profiles); } }))),
      h('div', { class: 'hint' }, p.mode === 'arcade'
        ? 'Arcade: one stick or four keys — throttle and steering are mixed for you.'
        : 'Tank: each side of the robot has its own forward/reverse control, like a real two-stick transmitter.'),
      ...driveActions.map((a) => bindingRow(p, pi, a)),
      ...WEAPON_ACTIONS.map((a) => bindingRow(p, pi, a)),
      h('div', { class: 'ctl-section' },
        h('h3', {}, 'Macros'),
        h('div', { class: 'hint' }, 'A macro plays a timed sequence when its trigger is pressed. Steps are "action ms", joined with commas; combine actions with +. Actions: forward, back, left, right, weapon, weapon2, wait.'),
        ...p.macros.map((_, mi) => macroRow(p, pi, mi)),
        h('div', { class: 'actions', style: 'justify-content:flex-start;margin-top:10px' },
          h('button', { class: 'small', onclick: () => { p.macros.push({ name: 'New macro', trigger: null, script: 'weapon 100' }); commit(); } }, '+ Macro'),
          h('button', { class: 'small', onclick: () => { profiles[pi] = defaultProfile(pi); commit(); } }, 'Reset to defaults'))));
  }

  function render() {
    root.replaceChildren(
      h('h2', {}, 'Controls'),
      h('div', { class: 'controls-grid' }, ...profiles.map((p, i) => card(p, i))),
      h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => { input.cancelCapture(); back(); } }, 'Done')),
      h('div', { class: 'footnote' }, 'Gamepads: press any button on a pad to wake it up. Pad 1 is player 1, pad 2 is player 2 by default. Changes save automatically in this browser.'));
  }

  render();
  return root;
}
