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

v1 designs (a single shell, two-sided drive and one weapon) still load:
`src/sim/legacy.ts` converts them. The starter robots are written that way.

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
speed at the contact point just before the step:

```
E      ≈ ½ × (F_contact × dt) × v_closing     (each side absorbs half)
E_y    = K_yield × σ_yield × t²               (plates resist ~ thickness²)
damage = max(0, E − E_y) / (K_cap × toughness × t × sizeFactor)
```

A single hit often spans several physics steps, so energy is summed per
*impact episode* (same pair of colliders, gaps under 20 ms, at most 250 ms)
and the yield threshold applies to the whole hit. Pushing contests (big
forces, almost no closing speed) do nothing; a spinner strike or a slam into
the floor after a flip does. Constants are in `src/sim/damage.ts` so balance
can be tuned in one place.

Part condition is internal state. The player sees it the way a builder would:
in the commentary feed ("its left wheel has come off!") and in the pit damage
report (OK / damaged / failing / destroyed), never as a health bar.

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
- **Immobilisation:** if a robot hasn't moved under its own power for 3 s, the
  referee starts a 10-second count. Being shoved around while helpless doesn't
  count as moving. Count reaches 10 → out.
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

## Controls

- Actions: `forward, back, left, right, weapon, weapon2`, plus tank-mode
  `leftForward, leftBack, rightForward, rightBack`.
- Bindings: any number of keyboard keys / gamepad buttons / gamepad axes per
  action.
- Drive mixing: *arcade* (one stick: throttle + steer) or *tank* (one control
  per side), like a real RC transmitter.
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
   test dummy and telemetry; save, load, and JSON import/export. *Next for the
   builder:* drag-and-drop placement in 3D, more weapon types (lifter, axe,
   crusher, drum), and per-part cost/availability that feeds into repairs.
4. **The show (done in v0.3):** four original house robots, each confined to
   a CPZ (corner patrol zone) unless a competitor is being counted out; a kinematic floor flipper
   triggered by a robot parking on it; a cycling flame pit whose heat damages
   parts by type and material (`HEAT` in `damage.ts`); flow-limited lifter
   valves. House robots never count towards the result or the judges.
   *Later:* wall spikes/grinders, house-robot weapons beyond lifters and
   spinners (crusher, flame thrower), and the pit being usable by house robots
   to finish victims.
5. **Tournament:** heats → final, side events (sumo, pinball, football,
   gauntlet, trials), pit repairs limited by time, budget and spares.
6. **Campaign:** progression and unlocks; restricted weapons (fire, etc.) in
   special classes.
7. **Full freedom:** free-form chassis shapes, all materials, AI-assisted design
   from a description or sketch (a model emits a RobotDesign).
