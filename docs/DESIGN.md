# Robot Bash — Design Document

A realistic robot-combat game in the spirit of the British TV show *Robot Wars*:
design and build your own fighting robot as you would a real one, then fight it
in an arena with house robots, hazards and the show's competition format.

> **Naming note.** "Robot Wars", the house robots and real competitor robots are
> owned by their rights holders and builders. This project uses its own names
> (e.g. house robots, templates) so it can be shared publicly later. The
> *format* (heats, pit, CPZs, the count, judges' decisions) is what we recreate.

## Pillars

1. **Simulation, not stats.** There are no health bars and no "weapon does 10
   damage". Robots are assemblies of real parts with real masses, materials and
   specs. Forces come out of the physics engine; damage comes out of forces.
2. **Design like a real builder.** Weight limits, budgets, motors, gearing,
   batteries, gas, armour thickness. Derived stats help you read a design, but
   they are *outputs* of the parts, never inputs to combat.
3. **Accessible on-ramp.** Templates and off-the-shelf kits get you fighting in
   a minute; the full builder is there when you want it.
4. **Couch first.** Two players on one keyboard (split halves) or controllers,
   no network needed. Every control is remappable, with macros.
5. **Authentic format.** Arena hazards, house robots, immobilisation counts,
   judges' decisions, heats → final, side events, pit repairs between rounds.

## Units and conventions

- SI everywhere in the simulation: metres, kilograms, seconds, newtons, joules.
- Robot-local frame: **+Z forward, +Y up, +X left**. Parts are positioned in
  this frame relative to the robot origin (centre of the chassis footprint at
  floor level).
- The simulation (`src/sim`) never imports rendering or DOM code, so it can run
  headless in tests and could be moved to another engine later.

## Architecture

```
src/
  data/      Catalogues: materials, parts, robot templates, arena layout
  sim/       Physics + game rules (Rapier). Headless-safe.
    design.ts    RobotDesign — the saved/shared robot format (pure data)
    stats.ts     Derived stats computed from a design (weight, cost, speed…)
    motor.ts     DC motor model (torque/speed/current curves)
    robot.ts     Builds rigid bodies/colliders/joints from a design; runs drive & weapons
    damage.ts    Turns contact impulses into part damage and part failures
    arena.ts     Arena geometry and hazards
    match.ts     Fixed-step loop, rules (count, pit, out of arena, judges)
  input/     Bindings, control profiles, macros, keyboard/gamepad polling
  render/    Three.js scene that mirrors the simulation
  ui/        Menus, HUD, controls editor
```

The **RobotDesign** JSON is the central contract. Templates, the builder, the
campaign, save files and (later) AI-assisted design all produce RobotDesigns.

## Robot model (design format v2)

`src/sim/design.ts` defines a robot as a **tree of parts**. Each part has:

- **What it is:**
  - *structure*: a shape (box, wedge, cylinder, cone, sphere, capsule or
    convex hull), a material, and either solid or a hollow shell with a wall
    thickness;
  - *wheel*: a catalogue wheel, whose axle is its hinge axis;
  - *component*: a battery, gas bottle or ballast.
- **Where it is:** position and rotation (Euler XYZ, in degrees) relative to
  its parent, plus a shape offset from its joint.
- **How it's attached:** *fixed*, *hinge* (axis, optional limits) or *slider*
  (axis, travel limits).
- **What drives it** (hinges and sliders only):
  - a DC motor through a gearbox;
  - a pneumatic ram (ram, valve, pressure, lever arm);
  - a position servo (motor, gearbox, target positions for input −1, 0 and
    +1).
- **What it's wired to:** left or right drive, throttle, steer, buttons 1–4
  (hold or toggle), or the gait clock (side, phase, swing or lift pattern).

**Physics build** (`src/sim/robot.ts`):

- Each jointed part and everything fixed below it becomes one rigid body
  with a compound collider. Masses come from the shape and material.
- All bodies start aligned with the chassis, so each joint's axis is the same
  in both bodies' frames.
- Motors apply torque from the DC model, with an equal and opposite reaction
  on the parent body, so spinners twist their own robot and FBS bases spin
  against their shells.
- Rams apply pressure × area (and × lever arm on a hinge). Flow-limited
  valves cap the stroke speed.
- Servos use Rapier's joint position motor, capped at the motor's real
  torque.
- Each actuator's mass sits on the parent body at the joint, as a damageable
  internal part.

**Failures:**

- When a part on the end of a joint fails, the joint snaps and the whole
  assembly beyond it comes off.
- When a fixed part fails, just that part comes off as debris.
- Batteries, gas bottles and actuators fail in place (power loss, a gas leak,
  a dead motor).

**Shapes** (`src/sim/shapes.ts`): the physics engine only collides convex
pieces, so every shape is reduced to convex pieces, and mass, inertia and
collisions all come from those same pieces.

- Primitives are one piece each.
- Armour shells (a box with sloped sides and raked front/rear edges above a
  belt line), wedges and hulls are one convex hull each. Hull volume and
  surface area are exact, from the hull's face planes, so sloped plate
  weighs what it should.
- Extruded outlines are triangulated (ear clipping), then merged back into
  as few convex polygons as possible (Hertel–Mehlhorn), and each is
  extruded into a prism.
- Lathe profiles become a stack of frustums.
- Imported meshes are voxelised by ray-casting along X, and the voxels are
  greedily merged into boxes.

Rendering uses the true shape.

**Rendering** (`src/render/`) draws each part the way it would be built,
from the design alone, so player-built robots get the same treatment:

- `partMesh.ts`: flat-faced parts are split into their real faces. Edges are
  chamfered like cut and deburred plate, and hollow shells get button-head
  bolts along every panel edge, about every 100 mm. Wheels get a treaded
  tyre, a spoked rim, a hub and axle nuts. Batteries, gas bottles, ballast
  and flamethrowers look like the real items. The chassis' top deck carries
  the robot's name.
- `surfaces.ts`: per-material finishes (brushed aluminium, ground hardened
  steel, matt HDPE, clear polycarbonate, wood grain…) with paint over them.
  Damage chips paint back to the bare material in proportion to part
  condition, and the flame pit leaves soot.
- `mechanisms.ts`: pneumatic rams whose rods extend as the joint opens, drive
  motors and gearboxes behind the wheels, weapon motors, spinner hubs and
  hinge pins.

None of this changes collision shapes; visuals stay within a few millimetres
of the physics. `showroom.html?robot=<id>` (dev server) shows one robot
under a close camera, with `fire=1`, `damage=0.6`, `yaw`, `pitch`, `dist`.

**Also:**

- Ball joints for flails.
- Joint springs.
- Flamethrower components: heat in a cone, with the same heat model as the
  flame pit.
- A design-level `catalog` of custom motors, batteries, wheels, rams,
  valves, tanks and materials, registered by id when the design is built.

What remains a limit is physics: parts are rigid (nothing bends, cuts or
deforms), and a robot's own parts don't collide with each other.

v1 designs (a single shell, two-sided drive and one weapon) still load:
`src/sim/legacy.ts` converts them. The starter and house robots are written
that way, then given real shapes (sloped armour, cheek-plated wedges,
bevelled flipper plates, profiled blades) with `src/data/shaping.ts`.

### Drive

Each drive side has one or more DC motors through a gear reduction. Per
physics step:

```
ω_motor = ω_wheel × gearRatio
τ_motor = throttle × τ_stall × (V_batt/V_rated) × (1 − ω_motor/ω_free) × condition
τ_wheel = τ_motor × gearRatio × η
I       = I_free + (I_stall − I_free) × τ_motor/τ_stall
```

The wheel torque is applied to the wheel body, and the equal and opposite
torque to the chassis. Pushing power, acceleration, top speed, wheelspin and
"pulls to one side when a motor dies" all come out of this; nothing is scripted.
Battery energy drains at `V × I`.

With the sticks centred, a drive speed controller *brakes* (it shorts the
motor, so back-EMF gives `τ = −τ_stall × ω/ω_free`, with no battery current)
rather than letting the robot coast. That is what real drive ESCs do, and what
makes a quick tap a small, controllable move. Weapon motors coast.

### Mass properties

Rapier's own mass properties go badly wrong for very flat convex hulls (a
lathe piece a few mm high comes out with inertia hundreds of times too big),
so hull pieces get theirs from `pieceMassProps` in `src/sim/shapes.ts`:
lathe frustums integrated as thin discs, other hulls by tetrahedra.

### Soft start

A motor actuator can have `softStart` (s): its speed controller ramps the
throttle up over that time. A heavy full-body or disc spinner otherwise twists
the whole robot round the other way while it spins up.

### Pneumatic flipper

```
F_ram   = P(t) × A_bore,      P(t) = P_work × (1 − e^(−t/τ_valve))
τ_hinge = F_ram × leverArm
gas used per shot = ρ_gas(P_work) × A_bore × stroke
```

Whether a flip throws a 100 kg opponent over the wall depends on the pressure,
the bore, the valve, the lever arm and the opponent's real mass and centre of
gravity. Gas is finite: run out and the flipper is dead weight.

### Spinner

A weapon motor spins up a disc or bar with real moment of inertia
`I` (computed from its material and dimensions). Stored energy `½Iω²` is what's
available to a hit, and a hit costs the spinner speed. High tip speeds need
small physics steps, so the simulation runs at 480 Hz with CCD on fast
bodies.

## Damage model

Rapier reports per-step contact forces for every collider pair. From each one we estimate the energy the impact dissipated, using the closing
speed at the contact point just before the step — before the robots' own
motors and rams act that step, or a ram pushing a plate into an opponent would
look like a fresh impact every step:

```
E      ≈ ½ × (F_contact × dt) × v_closing     (robot vs robot: each side absorbs half;
                                               robot vs arena: the robot takes it all)
E_y    = K_yield × σ_yield × t²               (plates resist ~ thickness²)
damage = max(0, E − E_y) / (K_cap × toughness × t × sizeFactor)
```

A single hit often spans several physics steps, so energy is summed per
*impact episode* (same pair of colliders, gaps under 20 ms, at most 250 ms)
and the yield threshold applies to the whole hit. Pushing contests (big
forces, almost no closing speed) do nothing; a spinner strike or a slam into
the floor after a flip does.

**Shock.** Hard landings and slams mostly hurt what's bolted inside, not the
plate. Each robot tracks its chassis' change of velocity over ~25 ms (gravity
taken out, so free fall is nothing); when a jolt is over, every internal takes

```
loss = K_shock × max(0, Δv − 2 m/s)² × sensitivity
```

Batteries and speed controllers are the most sensitive, then motors and rams,
then gas bottles; ballast doesn't care. A 1 m drop costs the electronics
~7%, a 2 m flip landing ~20%, a full-speed ram ~14%; ordinary driving nothing.
Landing damage counts for whoever threw you (they touched you last and you've
been airborne since) with the judges. Constants are in `src/sim/damage.ts` so
balance can be tuned in one place.

Part condition is internal state. The player sees it the way a builder would:
in the commentary feed ("its left wheel has come off!") and in the pit damage
report (OK / damaged / failing / destroyed), never as a hit-point bar. The HUD
can also show a small plan view of each robot with every part coloured by its
condition (green → amber → red, grey when gone); Tab cycles diagram → diagram
and full report → off.

## Scrutineering

`src/sim/rules.ts` checks a design before it fights: weight class
(featherweight 15 kg, lightweight 30 kg, middleweight 55 kg, heavyweight
100 kg), optional budget (£1,500 / £3,000 / £5,000), a 1.5 m × 1.5 m size
limit, armour clear of the floor, wheels on both sides, motor voltage vs.
battery (over 1.6× is rejected), and spinner blades clear of the floor.
Warnings cover a battery that won't last 3 minutes, battery-limited pushing,
flipper plates that can't reach the floor, and very high ground clearance.

## Rules (per fight)

- **Fight length:** 3 minutes (configurable).
- **Immobilisation:** if a robot hasn't moved under its own power for 4 s, the
  referee starts a 10-second count. Being shoved around while helpless doesn't
  count as moving, and nothing that happens while a house robot is touching
  you does. Once the count has started, it takes 0.4 s of real driving to stop
  it. Count reaches 10 → out.
- **The pit:** drive onto the pit release button to open the pit. A robot that
  falls in is out.
- **Out of the arena:** thrown over the wall → out.
- **Judges' decision** if both survive: aggression, control, damage and style,
  scored from what actually happened in the sim.

## Derived stats (shown in the builder)

Weight, cost, top speed, pushing force (traction-limited vs motor-limited),
0–top-speed time, weapon energy (spinner ½Iω² / flipper energy per shot),
flipper shots per tank, battery runtime at full load, armour rating per face,
and **repairability**: spares availability (common / specialist / custom), cost
of a full rebuild, and pit time per part.

## CPU drivers

The CPU chases, lines up and backs off when stuck, through the same controls
a human has. Weapons are worked generically by `WeaponOperator`
(`src/sim/ai.ts`): spinners and drums are switched on and left on; anything
on a stroke (flippers, axes, crushers, rams, servos) is fired only when
sweeping its driven part through the stroke would actually reach the target,
and the button is held for the whole stroke (0.5 s for a dump-valve flipper,
1.6 s for a slow lifter). Slow lifters only fire with the target resting on
top of them. Flamethrowers fire when the target is in the cone. House robots
use the same operator.

## Controls

- Actions: `forward, back, left, right, weapon, weapon2`, plus tank-mode
  `leftForward, leftBack, rightForward, rightBack`.
- Bindings: any number of keyboard keys / gamepad buttons / gamepad axes per
  action.
- Drive mixing: *arcade* (one stick: throttle + steer) or *tank* (one control
  per side), like a real RC transmitter.
- **Key ramp:** keys are on/off, so a held drive key ramps from 30% to full
  throttle over 0.25 s (configurable per player, 0 = instant). A tap is a
  nudge; holding is full power. Sticks are proportional already and weapon
  keys are never ramped.
- **Macros:** a trigger binding runs a timed sequence, e.g.
  `weapon 150, back 300, left 200` (fire, reverse away, turn). Written as a tiny
  text format in the controls screen.
- Defaults: P1 = `WASD`, weapon `E`/`Space`, weapon 2 `Q`, macro `C`
  (+ gamepad 1). P2 = `IJKL` or arrows, weapon `O`/`/`, weapon 2 `U`, macro
  `M` (+ gamepad 2). Saved in browser storage.
- Upside down, a robot's drive is reversed and its sides swap, as in real
  life. (An optional "invert when flipped" transmitter switch is a candidate
  for later.)

## Physics notes

- Fixed 480 Hz step, 8 solver iterations, CCD on chassis, wheels and weapons.
  About 2 ms of CPU per rendered frame for a two-robot fight.
- Wheels are real bodies on revolute joints. Rapier's cylinder-on-box contact
  makes resting wheels creep, so each wheel touches the *floor* through a
  sphere of the same radius and touches *robots* through its cylinder.
- Wheels on one side are coupled to a common speed (chain drive).
- Skids sit a few mm clear of the floor; otherwise the solver lets them carry
  the robot's weight and the wheels lose traction.

## Roadmap

1. **Sandbox (done in v0.1):** arena, two robots, drive physics, split keyboard
   and gamepads, remappable controls and macros, CPU opponent.
2. **Weapons & damage (v0.1, first pass):** flipper and spinner physics, part
   damage and failures, count, pit, out of arena, judges. Needs balancing.
3. **Builder v1 (done in v0.2):** templates and blank chassis, form-based
   editing of armour panels, drive, battery and weapon; live stats and parts
   list; scrutineering against weight class and budget; test bay with a crash
   test dummy and telemetry; save, load, and JSON import/export.
   **Builder v2 (v0.4–v0.6):** robots as free trees of parts, joints and
   actuators; drawn, turned and imported shapes; custom parts and materials;
   drag handles in 3D with undo; soft-start weapon motors. *Next for the
   builder:* per-part cost/availability that feeds into repairs.
4. **The show (done in v0.3):** four original house robots, each confined to
   a CPZ (corner patrol zone) unless a competitor is being counted out; a kinematic floor flipper
   triggered by a robot parking on it; a cycling flame pit whose heat damages
   parts by type and material (`HEAT` in `damage.ts`); flow-limited lifter
   valves. House robots never count towards the result or the judges.
   **v0.6:** shock damage from landings and slams, a CPU that times its
   weapons, house robots selectable as competitors, and thirteen starter
   robots covering wedges, flippers, spinners, drums, discs, axes, crushers,
   rams, lifters, a walker and a rolling ball.
   *Later:* wall spikes/grinders, house-robot weapons beyond lifters and
   spinners (crusher, flame thrower), and the pit being usable by house robots
   to finish victims.
5. **Tournament:** heats → final, side events (sumo, pinball, football,
   gauntlet, trials), pit repairs limited by time, budget and spares.
6. **Campaign:** progression and unlocks; restricted weapons (fire, etc.) in
   special classes.
7. **Full freedom:** AI-assisted design from a description or sketch (a model
   emits a RobotDesign). Free-form shapes and materials are done (v0.4).
