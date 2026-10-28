# Robot Bash

A physics-simulated robot combat game in the spirit of the British TV show
*Robot Wars*. Robots are built from real parts (motors, gearboxes, batteries,
armour plate, pneumatic rams, spinner blades) and every hit is worked out from
real forces. There are no health bars.

**Status: v0.1, a playable sandbox.** Two robots, an arena with a pit, three
starter robots, a CPU opponent, split-keyboard and gamepad controls with
remapping and macros. The robot builder, house robots and tournaments come
next. See [docs/DESIGN.md](docs/DESIGN.md) for the design and roadmap.

## Play

```sh
npm install
npm run dev        # then open the printed localhost URL
```

Everything runs in the browser, with no network play needed.

| | Player 1 | Player 2 |
|---|---|---|
| Drive | `W A S D` | `I J K L` or arrows |
| Weapon (flipper fire / spinner on-off) | `E` or `Space` | `O` or `/` |
| Weapon 2 (spinner brake) | `Q` | `U` |
| Macro ("fire & back off") | `C` | `M` |
| Gamepad | Pad 1: left stick, A/RT, B/LT | Pad 2 |

`Esc` pauses, `Tab` shows the damage report. Everything can be rebound under
**Controls**, including tank-style mixing (one control per side) and your own
macros, e.g. `weapon 150, back+left 300`.

## How you win

- Immobilise them: a robot that can't move under its own power gets a
  10-second count.
- Push them into the pit (hit the red button to open it) or flip them out
  over the wall.
- Otherwise the judges score aggression, control, damage and style after 3 minutes.

## Develop

```sh
npm test           # simulation + input tests (headless physics)
npm run typecheck
npm run build      # static site in dist/
```

Code layout: `src/sim` is the engine-agnostic simulation (Rapier physics,
damage, rules, CPU driver), `src/data` holds the parts catalogue and robot
templates, `src/input` handles bindings, mixing and macros, `src/render` is
the Three.js view and `src/ui` the menus and HUD.

*Robot Wars and its robots are the property of their respective owners. This
is an unofficial fan project and uses original robot names and designs.*
