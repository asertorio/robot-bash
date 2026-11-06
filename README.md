# Robot Bash

A physics-simulated robot combat game in the spirit of the British TV show
*Robot Wars*. Robots are built from real parts (motors, gearboxes, batteries,
armour plate, pneumatic and hydraulic rams, spinner blades, chainsaws) and
every hit is worked out from real forces and real materials. There are no
health bars.

See [docs/DESIGN.md](docs/DESIGN.md) for the design and roadmap.

## Play

```sh
npm install
npm run dev        # then open the printed localhost URL
```

Everything runs in the browser, with no network play needed.

| | Player 1 | Player 2 |
|---|---|---|
| Drive | `W A S D` | `I J K L` or arrows |
| Weapon 1 (fire / spinner on-off) | `E` or `Space` | `O` or `/` |
| Weapon 2 | `Q` | `U` |
| Macro ("fire & back off") | `C` | `M` |
| Gamepad | Pad 1: left stick, A/RT, B/LT | Pad 2 |

`Esc` pauses, `Tab` cycles the damage display. Everything can be rebound under
**Controls**, including tank-style mixing (one control per side) and your own
macros, e.g. `weapon 150, back+left 300`.

## How you win

- Immobilise them: a robot that can't move under its own power gets a
  10-second count.
- Push them into the pit (hit the red button to open it) or flip them out
  over the wall.
- Otherwise the judges score aggression, control, damage and style when time
  runs out.

## What hits do

Damage depends on what hits what:

- **Materials have a hardness.** A hardened-steel tooth bites about three
  times deeper into aluminium than into hardened steel; an aluminium tooth
  barely marks hardened steel. Robot on robot, the softer side soaks up more
  of an impact.
- **Edges matter.** Every part is *blunt* (plate, wedges), a *blade* (spinner
  teeth), a *spike* (axe heads, lances, crusher beaks) or a *saw*.
- **Saws and chainsaws cut as they slide**, from how hard they're pressed in
  and how fast the teeth move — a chainsaw held on mild steel is through it in
  a few seconds; hardened steel takes several times longer.
- **Crushers and spikes pierce under steady force** once they push past what
  the plate can take (about 4 kN for 6 mm aluminium, 19 kN for 6 mm hardened
  steel). Hydraulic crushers have no gas to run out of, so they can keep
  biting.
- Hits pass through armour to the motors, battery and radio behind it, and
  hard landings shake up the electronics.

## The fight

- **Referee breaks:** two robots shoving nose to nose and going nowhere for 5
  seconds get pulled apart. Robots also slide and bounce off each other the
  way bare plate does, so evenly matched robots come round for another go
  instead of mashing.
- **Finale:** in the last 30 seconds the pit opens and the house robots leave
  their corners and come for everyone.
- **Big hits** get a shout, camera shake and a moment of slow motion.
- **House robots** guard the corner patrol zones: a classic set, or an
  **overpowered** set — Maelstrom (a 1.3 m steel full-body spinner), Pile
  Driver (a 125 kN hydraulic spike that goes through hardened steel), Warden
  (a giant clamp-lifter that carries you to the pit) and Inferno (twin
  flamethrowers and a flipper that throws heavyweights out of the arena) — or
  a mix of both.
- **Settings** (main menu): Realistic or Brutal damage, fight length, finale,
  referee breaks, house robot set, slow motion and camera shake.

## The robots

Starter robots: Wedgehog (wedge), Flipside (flipper), Whirlwind (undercutter),
Twin Terror (two flippers), Orb (pendulum-drive sphere), Arachnid (six-legged
walker), Gyrodisc (full-body spinner), Axeman (overhead axe), Drumroll (drum),
Jawbreaker (pneumatic crusher), Lancer (ram spike), Sawtooth (vertical disc),
Hoister (lifter), and:

- **Brickhouse** — invertible rammer with its wheels tucked *inside* the body;
  the tyres stand proud top and bottom, so it drives the same upside down.
- **Lumberjack** — a chainsaw on a powered arm.
- **Clampdown** — clamp-lifter: grabs, lifts and carries.
- **Tailspin** — thwackbot: spins on the spot to swing a spiked mace on a long
  tail.
- **Gemini** — twin counter-rotating saw discs (their reaction torques
  cancel), with inboard wheels.
- **Vicegrip** — hydraulic crusher: no gas, unlimited bites.

House robots can be picked as competitors too. Saved robots appear on the
fight select screen.

### The Garage

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
  - a **pneumatic ram**, for flippers, lifters, axes, spikes and crushers
    (or a pump-driven **hydraulic cylinder**: slow and strong, no gas);
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
  another part, or remove it. Click a part in the 3D view to select it.

Stats update as you build: weight, cost, drive (top speed and pushing force
for wheeled robots), battery life, and each weapon's force or stored energy
and spin-up time. There's also a full parts list with spares and rebuild time.
**Scrutineering** checks weight class (feather to super-heavy, or **Open**,
which has no weight or size limit and allows banned weapons such as
flamethrowers), budget, size, parts below the floor,
voltage against each motor, gas for the pneumatics, wiring and battery life.
The **test bay** behind the editor lets you drive the robot against a
crash-test dummy, with live telemetry for every joint.

New in the parts menu: a **chainsaw on a servo arm** and a **hydraulic
crusher**. Any structure part can be given an edge (blunt, blade, spike or
saw), and a saw-edged part can carry a driven chain. Designs are plain JSON,
so you can copy one out to share it or paste one in; old saves are upgraded
automatically.

## Develop

```sh
npm test           # simulation + input tests (headless physics)
npm run typecheck
npm run build      # static site in dist/
```

Code layout: `src/sim` is the engine-agnostic simulation (Rapier physics,
damage, rules, CPU driver), `src/data` holds the parts catalogue, robots and
settings, `src/input` handles bindings, mixing and macros, `src/render` is the
Three.js view and `src/ui` the menus and HUD.

*Robot Wars and its robots are the property of their respective owners. This
is an unofficial fan project and uses original robot names and designs.*
