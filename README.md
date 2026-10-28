# Robot Bash

A physics-simulated robot combat game in the spirit of the British TV show
*Robot Wars*. Robots are built from real parts (motors, gearboxes, batteries,
armour plate, pneumatic rams, spinner blades) and every hit is worked out from
real forces. There are no health bars.

**Status: v0.3.** Two-robot fights in an arena with a pit, a floor flipper,
a flame pit and up to four **house robots**. There are three starter robots, a
CPU opponent, split-keyboard and gamepad controls with remapping and macros,
and the **Garage**: build your own robot part by part and drive it in a test
bay. Tournaments come next. See [docs/DESIGN.md](docs/DESIGN.md) for the
design and roadmap.

## The arena

- **The pit:** drive over the red button to open it. Fall in and you're out.
- **Floor flipper:** park on the striped panel and it fires, throwing a robot
  into the air.
- **Flame pit:** the grille burns on a cycle. Tyres and plastic armour (HDPE,
  polycarbonate) cook fast; steel barely notices; internals behind armour get
  some of the heat.
- **House robots** (choose 0, 2 or 4 on the select screen) each guard a
  corner patrol zone and attack anything that strays in. Once a robot is
  being counted out, they all come out to finish it off:
  - **Ironjaw:** a 270 kg lifter on a flow-limited 60-bar ram. It lifts and
    holds.
  - **Buzzard:** a vertical circular saw.
  - **Shovelhead:** a 290 kg bulldozer with a hardened scoop.
  - **Thresher:** a flail bar at head height.

## The Garage

Start from a starter robot or a blank chassis, then change anything:

- **Armour:** box and wedge panels. Choose the material (aluminium, mild
  steel, hardened steel, titanium, HDPE, polycarbonate), plate thickness, size
  and position.
- **Drive:** 2WD with skids or 4WD, wheel type, track and wheelbase, motor,
  motors per side, gear ratio.
- **Power:** the battery's chemistry, voltage, capacity and current limit.
  Over-volting is allowed, with a warning.
- **Weapon:** none, a pneumatic flipper (ram, pressure, valve, gas bottle,
  plate, lever arm) or a spinner (motor, belt reduction, bar or disc, blade
  material and size, horizontal or vertical).

Stats update as you build: weight, cost, speed, pushing force and what limits
it, weapon energy, battery life, spares and rebuild time, plus a full parts
list. **Scrutineering** checks the design against a weight class
(feather/light/middle/heavy) and an optional budget, along with clearance,
size, voltage and blade-hits-floor rules. The **test bay** behind the editor
lets you drive the robot (player 1's controls) against a crash-test dummy,
with live telemetry: speed, current, rpm, gas, the biggest hit in joules, and
the damage on both robots.

Saved robots appear on the fight select screen. Designs are plain JSON, so
you can copy one out to share it or paste one in.

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
