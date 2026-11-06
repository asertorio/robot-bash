# Robot Bash

A physics-simulated robot combat game in the spirit of the British TV show
*Robot Wars*. Robots are built from real parts (motors, gearboxes, batteries,
armour plate, pneumatic rams, spinner blades) and every hit is worked out from
real forces. There are no health bars.

**Status: v0.5.** Two-robot fights in an arena with a pit, a floor flipper,
a flame pit and up to four **house robots**. There are thirteen starter
robots, a CPU opponent that uses its weapons, split-keyboard and gamepad
controls with remapping and macros, and the **Garage**: build almost any robot
out of parts, joints and actuators and drive it in a test bay. Tournaments
come next. See [docs/DESIGN.md](docs/DESIGN.md) for the
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

Robots are **trees of parts joined by joints**, so you can build almost
anything that's rigid bits, hinges, sliders and motors: twin flippers, a
rolling ball, a six-legged walker, a full-body spinner, axes, ram spikes,
lifters, clampers…

- **Any shape:**
  - Draw any 2D outline on the sketch board (U-scoops, claws, hooks, saw
    teeth, stars…) and extrude it.
  - Draw a profile and spin it into a drum, dome, bell or disc.
  - Import any **STL or OBJ** model.
  - Or use the primitives: box, wedge, plate, bar, cylinder, cone, sphere,
    capsule and convex hull.

  Concave shapes are split into convex pieces for the physics automatically,
  and imported models are approximated with boxes at a detail level you
  choose.
- **Any material:** aluminium, mild steel, hardened steel, titanium, HDPE,
  polycarbonate, rubber, PTFE and plywood, or **your own** with your own
  density, strength, toughness, grip and price. Every part is solid or a
  hollow shell with any wall thickness.
- **Joints:** every part is fixed to its parent, on a *hinge* (any axis
  direction, optional limits), on a *slider*, or on a *ball joint* (flails,
  chains). Hinges and sliders can have a **spring** (suspension, return
  springs).
- **Actuators** on any hinge or slider:
  - a **DC motor** through a gearbox, for wheels, spinners and drums;
  - a **pneumatic ram**, for flippers, lifters, axes, spikes and crushers;
  - a **servo**, which holds positions, for legs, clamps and steering.
- **Your own parts:** every catalogue dropdown (motors, batteries, wheels,
  rams, valves, gas bottles, materials) has *New custom part…*. It copies
  the spec, and every number is then yours to set.
- **Wiring:** any actuator can follow the left or right drive, throttle,
  steering, weapon buttons 1–4 (held or toggled), or the walking gait
  (stride side, phase, swing or lift).
- **Internals:** batteries (in parallel), gas bottles (one shared supply) and
  ballast.
- **Tools:** add from a parts menu (including ready-wired assemblies: a leg
  with hip and knee servos, an axe, a spinner, a ram spike, a crusher jaw, a
  flail, a sprung suspension wheel, or a flamethrower), mirror a
  part with everything on it to the other side, duplicate, move it onto
  another part, or remove it. Click a part in the 3D view to select it, then
  move, rotate or resize it with handles (tools 1–4, with snap). Undo/redo
  with `Ctrl+Z` / `Ctrl+Y`, `Delete` removes a part, `Ctrl+D` duplicates.

Stats update as you build: weight, cost, drive (top speed and pushing force
for wheeled robots), battery life, and each weapon's force or stored energy
and spin-up time. There's also a full parts list with spares and rebuild time.
**Scrutineering** checks weight class (feather to super-heavy, or **Open**,
which has no weight or size limit and allows banned weapons such as
flamethrowers), budget, size, parts below the floor,
voltage against each motor, gas for the pneumatics, wiring and battery life.
The **test bay** behind the editor lets you drive the robot against a
crash-test dummy, with live telemetry for every joint.

Starter robots: Wedgehog (wedge), Flipside (flipper), Whirlwind (undercutter),
Twin Terror (two flippers), Orb (pendulum-drive sphere), Arachnid (six-legged
walker), Gyrodisc (full-body spinner), Axeman (overhead axe), Drumroll (drum),
Jawbreaker (crusher), Lancer (ram spike), Sawtooth (vertical disc) and Hoister
(lifter). The house robots can be loaded and fought with too. Saved robots
appear on the fight select screen. Designs are plain JSON, so you can copy one out to share it or
paste one in; old saves are upgraded automatically.

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

`Esc` pauses. `Tab` cycles the damage display: a plan view of each robot
coloured by part condition, that plus the full report, or off. Drive keys ramp
from 30% to full throttle over 0.25 s, so a tap is a nudge. Everything can be rebound under
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
the Three.js view and `src/ui` the menus, HUD and garage.
`showroom.html?robot=<id>` (dev server) shows one robot close up. Pushes to
`main` are tested, built and deployed to GitHub Pages.

*Robot Wars and its robots are the property of their respective owners. This
is an unofficial fan project and uses original robot names and designs.*
