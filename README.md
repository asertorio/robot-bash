# Robot Bash

A physics-simulated robot combat game in the spirit of the British TV show
*Robot Wars*. Robots are built from real parts (motors, gearboxes, batteries,
armour plate, pneumatic rams, spinner blades) and every hit is worked out from
real forces. There are no hit points: armour dents and tears off, hard
landings shake batteries and speed controllers loose, and a robot loses
because something actually broke.

**[Play it in your browser](https://asertorio.github.io/robot-bash/)** — no
install, keyboard or gamepad, two players on one machine or you against the
CPU.

**Status: v0.6.** Fights in a hazard-filled arena, thirteen starter robots
plus four house robots to pick from, a CPU opponent that uses its weapons
properly, and the **Garage**, where you build anything out of parts, joints
and actuators and drive it in a test bay. Tournaments come next. See [docs/DESIGN.md](docs/DESIGN.md) for how the simulation works and
the roadmap.

## Play

```sh
npm install
npm run dev        # then open the printed localhost URL
```

Everything runs in the browser; there's no server.

| | Player 1 | Player 2 |
|---|---|---|
| Drive | `W A S D` | `I J K L` or arrows |
| Weapon button 1 | `E` or `Space` | `O`, `/` or right `Shift` |
| Weapon button 2 | `Q` | `U` or `.` |
| Weapon buttons 3 and 4 | `Z`, `X` | `H`, `N` |
| Macro ("fire & back off") | `C` | `M` |
| Gamepad | Pad 1: left stick, A/RT, B/LT | Pad 2 |

`Esc` pauses. `Tab` cycles the damage display: a small plan view of each
robot with every part coloured by health, that plus the full damage report,
or nothing. Each player's panel also shows battery, gas and fuel gauges.

Drive keys ramp up to full power over a quarter of a second, so a quick tap is
a small nudge, and the speed controllers brake when you let go. Everything can
be changed under **Controls**: rebind any key, button or stick, switch to tank
mixing (one control per side, like a two-stick transmitter), adjust steering
and the key ramp, and write macros such as `weapon 150, back+left 300`.

## How you win

- **Immobilise them.** A robot that can't move under its own power for a few
  seconds gets a 10-second count. Being shoved about by a house robot doesn't
  save you — you have to drive away.
- **Pit them or throw them out.** Drive over the red button to open the pit,
  or flip them over the wall.
- **Or win on points.** If both survive 3 minutes, the judges score
  aggression, control, damage and style from what actually happened.

## The arena

- **The pit:** opened by the red button. Fall in and you're out.
- **Floor flipper:** park on the striped panel and it throws you into the air.
- **Flame pit:** the grille burns on a cycle. Tyres and plastic armour cook
  fast, steel barely notices, internals behind armour get some of the heat.
- **House robots** (0, 2 or 4, chosen on the select screen) guard the corner
  patrol zones and attack anything that strays in. Once a robot is being
  counted out, they come out to finish it off.

## The robots

Pick any of these for either player, Human or CPU. Your own saved builds are
listed too.

| Robot | Weapon | |
|---|---|---|
| Wedgehog | None — a four-wheel-drive hardened wedge | 90 kg |
| Flipside | Pneumatic front flipper on a dump valve | 74 kg |
| Whirlwind | Horizontal undercutter bar, 1,670 rpm | 88 kg |
| Twin Terror | Two independent flippers | 61 kg |
| Orb | None — a ball split into two driven halves | 71 kg |
| Arachnid | Six-legged walker with a pincer | 57 kg |
| Gyrodisc | Full-body spinning shell, 22 kJ stored | 94 kg |
| Axeman | Overhead axe that comes over the top | 84 kg |
| Drumroll | Toothed drum spinner, 3,000 rpm | 76 kg |
| Jawbreaker | Crusher beak that bites down onto a scoop | 89 kg |
| Lancer | Ram spike that punches out of the nose | 59 kg |
| Sawtooth | Vertical disc spinner, 2,500 rpm | 97 kg |
| Hoister | Wide lifting forks on a slow, strong ram | 88 kg |

**House robots**, far over the competitor limits and also selectable:
**Ironjaw** (a 254 kg lifter on a 50-bar ram), **Buzzard** (a vertical
circular saw), **Shovelhead** (a 269 kg bulldozer) and **Thresher** (a
horizontal bar spinning at head height).

## The Garage

Robots are **trees of parts joined by joints**, so you can build almost
anything that's rigid bits, hinges, sliders and motors: flippers, axes,
crushers, lifters, ram spikes, drums, discs, full-body spinners, walkers,
rolling balls, flails…

- **Edit with the mouse.** Click a part to select it, then drag its handles to
  move, rotate or resize it (tools `1`–`4`), with snapping and world or part
  axes. Or type exact numbers. `Ctrl+Z` / `Ctrl+Y` undo and redo, `Delete`
  removes a part, `Ctrl+D` duplicates. The view stays put while you work.
- **Any shape:** draw a 2D outline and extrude it, draw a profile and spin it
  into a drum or dome, import an **STL or OBJ**, use a sloped **armour shell**,
  or the primitives (box, wedge, plate, bar, cylinder, cone, sphere, capsule,
  convex hull). Concave shapes are split into convex pieces for the physics.
- **Any material:** aluminium, mild steel, hardened steel, titanium, HDPE,
  polycarbonate, rubber, PTFE, plywood, or your own. Solid, or a hollow shell
  with any wall thickness.
- **Joints:** fixed, hinge (any axis, optional limits), slider or ball joint,
  with optional springs.
- **Actuators** on any hinge or slider: a **DC motor** through a gearbox (with
  an optional soft start for heavy spinners), a **pneumatic ram**, or a
  **servo** that holds positions.
- **Wiring:** any actuator can follow the left or right drive, throttle,
  steering, weapon buttons 1–4 (held or toggled), or the walking gait.
- **Your own parts:** every catalogue dropdown has *New custom part…*, which
  copies a spec for you to change.
- **Ready-made assemblies** in the parts menu: a walking leg, an axe, a
  spinner, a ram spike, a crusher jaw, a flail, a sprung suspension wheel and
  a flamethrower. Mirror a part to the other side with everything on it.

Stats update as you build: weight, cost, top speed and pushing force, battery
life, each weapon's force or stored energy and spin-up time, spares and
rebuild time, and a full parts list. **Scrutineering** checks the weight
class (feather to super-heavy, or **Open**, which has no limits and allows
flamethrowers), budget, size, parts below the floor, voltage, gas, wiring and
battery life. The **test bay** behind the editor lets you drive the robot
against a crash-test dummy, with live telemetry, gauges and a health diagram.

Saved robots appear on the robot select screen. Designs are plain JSON, so you
can copy one out to share it or paste one in. You can also load any starter or
house robot as a starting point.

## Develop

```sh
npm test           # simulation, input and builder tests (headless physics)
npm run typecheck
npm run build      # static site in dist/
```

Pushing to `main` runs the tests and deploys the build to GitHub Pages.

Code layout:

- `src/sim` — the simulation, independent of the renderer: Rapier physics,
  robots and actuators, damage, rules and referee, CPU and house-robot drivers.
- `src/data` — the parts catalogue, materials, and the starter and house
  robots.
- `src/input` — key and gamepad bindings, mixing and macros.
- `src/render` — the Three.js view.
- `src/ui` — menus, HUD, garage and the controls screen.

*Robot Wars and its robots are the property of their respective owners. This
is an unofficial fan project and uses original robot names and designs.*
