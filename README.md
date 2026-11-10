# Robot Bash

A physics-simulated robot combat game in the spirit of the British TV show
*Robot Wars*. Robots are built from real parts (motors, gearboxes, batteries,
armour plate, pneumatic and hydraulic rams, spinner blades, chainsaws) and
every hit is worked out from real forces and real materials. There are no hit points: armour dents and tears off, hard
landings shake batteries and speed controllers loose, and a robot loses
because something actually broke.

**[Play it in your browser](https://asertorio.github.io/robot-bash/)** — no
install. Keyboard, gamepad or touch screen; two players on one machine (four
with gamepads), you against the CPU, or **two phones online** with a room code.

**Status: v0.9.** One-on-one fights or 3–4 robot melees in a hazard-filled
arena, with synthesised sound and a spoken commentator, twenty-eight starter robots
plus eight house robots to pick from, a CPU opponent that uses its weapons
properly, and the **Garage**, where you build anything out of parts, joints
and actuators and drive it in a test bay. Tournaments come next. See [docs/DESIGN.md](docs/DESIGN.md) for how the simulation works and
the roadmap.

## Play

```sh
npm install
npm run dev        # then open the printed localhost URL
```

Everything runs in the browser; there's no game server (online play uses the
free PeerJS server only to introduce the two devices).

| | Player 1 | Player 2 |
|---|---|---|
| Drive | `W A S D` | `I J K L` or arrows |
| Weapon button 1 | `E` or `Space` | `O`, `/` or right `Shift` |
| Weapon button 2 | `Q` | `U` or `.` |
| Weapon buttons 3 and 4 | `Z`, `X` | `H`, `N` |
| Macro ("fire & back off") | `C` | `M` |
| Gamepad | Pad 1: left stick, A/RT, B/LT | Pad 2 |

`V`, a pad's Back or the 🎥 button switches between the TV camera and a chase
camera behind each robot (Settings → Fight camera picks the default).
`Esc`, the on-screen Pause button or a pad's Start pauses. Menus work with
the keyboard (`Tab`, `Enter`, `Space`) or a gamepad (D-pad to move, A to
pick, B to go back, Start to fight). `Tab` in a fight cycles the damage display: a small plan view of each
robot with every part coloured by health, that plus the full damage report,
or nothing. Each player's panel also shows battery, gas and fuel gauges.

**On a phone or tablet**, turn it sideways: push the thumb-stick bottom left
the way you want to go on screen and the robot turns and drives that way
(gently near the middle, full power at the edge; Settings → Touch stick has
the classic robot's-view RC mix instead), and the robot's weapon
buttons sit bottom right, labelled with what they do. Tap the damage label at
the top to cycle the display. In the garage, tap **Hide panels** to test-drive
with the same controls, and pinch to zoom.

Drive keys ramp up to full power over a quarter of a second, so a quick tap is
a small nudge, and the speed controllers brake when you let go. Everything can
be changed under **Controls**: rebind any key, button or stick (it warns you
if one key ends up doing two things), switch to tank
mixing (one control per side, like a two-stick transmitter), adjust steering
and the key ramp, and write macros such as `weapon 150, back+left 300`.

**Melees:** choose *3-way* or *4-way* on the select screen. Everyone's for
themselves, like the first round of a heat: last robot standing wins, or the
judges score everyone. Players 3 and 4 drive with gamepads 3 and 4; any seat
can be the CPU, which goes for whoever's nearest.

**Online:** *Play online* on the main menu. One device hosts and shows a
four-letter code; the other joins with it and picks any robot, even one from
its own garage. The host's device runs the physics with its own Settings and
streams the fight to the other. Same Wi-Fi or anywhere online.

**Sound and commentary:** motors whine with the current they draw, spinners
howl at their real rpm and bog down when they hit, impacts clang as hard as
the physics says, rams hiss, and the crowd roars at big hits. A spoken
commentator (your browser's own voice) calls the line-up, the clock and the
big moments. Settings → Sound and Commentary voice.

## How you win

- **Immobilise them.** A robot that can't move under its own power for a few
  seconds gets a 10-second count. Being shoved about by a house robot doesn't
  save you — you have to drive away.
- **Pit them or throw them out.** Drive over the red button to open the pit,
  or flip them over the wall.
- **Or win on points.** If both survive 3 minutes, the judges score
  aggression, control, damage and style from what actually happened. A dead
  heat goes to damage, then aggression, and failing that it's a draw.

## The arena

- **The pit:** opened by the red button. Fall in and you're out.
- **Floor flipper:** park on the striped panel and it throws you into the air.
- **Flame pit:** the grille burns on a cycle. Tyres and plastic armour cook
  fast, steel barely notices, internals behind armour get some of the heat.
- **House robots** (0, 1, 2 or 4, chosen on the select screen) guard the
  corner patrol zones and attack anything that strays in. Once a robot is
  being counted out, they come out to finish it off. Pick the classic set, an
  **overpowered** set, or a mix.
- **Referee breaks:** two robots shoving nose to nose and going nowhere for 5
  seconds get pulled apart. Robots also slide and bounce off each other the
  way bare plate does, so evenly matched robots come round for another go
  instead of mashing.
- **Finale:** in the last 30 seconds the pit opens and the house robots come
  for everyone.
- **Big hits** get a shout, camera shake and a moment of slow motion.
- **Settings** (main menu): Realistic or Brutal damage, fight length, finale,
  referee breaks, house robot set, sound, commentary voice, slow motion,
  camera shake and the fight camera.

## What hits do

- **Materials have a hardness.** A hardened-steel tooth bites about three
  times deeper into aluminium than into hardened steel; an aluminium tooth
  barely marks hardened steel. Tyres are tough rubber, so they don't count as
  soft: a spinner won't take a wheel off with one glancing hit.
- **Edges matter:** every part is blunt (plate, wedges), a blade (spinner
  teeth), a spike (axe heads, lances, crusher beaks) or a saw.
- **Saws and chainsaws cut as they slide**, from how hard they're pressed in
  and how fast the teeth move. Held on mild steel, a chainsaw is through it in
  seconds; hardened steel takes several times longer.
- **Crushers and spikes pierce under steady force** once they push past what
  the plate can take (about 4 kN for 6 mm aluminium, 19 kN for 6 mm hardened
  steel). Hydraulic crushers have no gas to run out of.
- **Projectiles are just parts thrown by a ram.** Their speed is the ram's
  work, their punch is their momentum, and a pointed harpoon sticks only into
  plate it can pierce — it glances off a hardened wedge. A winch pulls both
  ends of the cable, so a light robot reels itself in to a heavy one.

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
| Brickhouse | None — invertible rammer, wheels inside the body | 76 kg |
| Lumberjack | Chainsaw on a powered arm | 77 kg |
| Clampdown | Clamp-lifter: grabs, lifts and carries | 97 kg |
| Tailspin | Thwackbot: spins to swing a spiked mace on a tail | 56 kg |
| Gemini | Twin counter-rotating saw discs | 76 kg |
| Vicegrip | Hydraulic crusher, no gas, unlimited bites | 86 kg |
| Whaler | Harpoon on 6 m of cable, and a winch to drag what it hits | 94 kg |
| Bellringer | Shell spinner: a bell spinning round the body, skirt 25 mm off the floor | 83 kg |
| Whisk | Eggbeater: a hollow cage of hardened bars, 2,800 rpm | 89 kg |
| Flipflop | Invertible, with flippers at both ends | 74 kg |
| Whippet | None — a tiny, very low wedge, the fastest robot here | 43 kg |
| Haymaker | Spiked arm that swings sideways across the nose | 83 kg |
| Conker | Flail spinner: spiked balls on chains | 84 kg |
| Limpet | None — a round titanium cone, a wedge on every side | 66 kg |
| Bearhug | Two arms that swing in, grab and hold on | 97 kg |

**Open class:** **Bombard** fires 2 kg steel cannonballs — eight of them,
one every 1.2 s. Little damage, but a real shove from across the arena.
Free-flying projectiles are banned in the weight classes; Whaler's harpoon
is allowed because it's on a cable.

**House robots**, far over the competitor limits and also selectable:
**Ironjaw** (a 254 kg lifter on a 50-bar ram), **Buzzard** (a vertical
circular saw), **Shovelhead** (a 269 kg bulldozer) and **Thresher** (a
horizontal bar spinning at head height). The **overpowered** set:
**Maelstrom** (a 1.3 m steel full-body spinner), **Pile Driver** (a 125 kN
hydraulic spike that goes through hardened steel), **Warden** (a giant
clamp-lifter that carries you to the pit) and **Inferno** (twin flamethrowers
and a flipper that throws heavyweights out of the arena).

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
  spinner, a ram spike, a crusher jaw, a flail, a sprung suspension wheel, a
  flamethrower, a harpoon gun and a gas cannon. Any part on a ram slider can
  be set to fire off the end: pick the cable, winch, spare rounds and reload
  time. Mirror a part to the other side with everything on it.
- **Share links:** *Copy share link* (Robot & saves tab) packs the robot into
  a link, about 1,000 characters for a typical robot. Whoever opens it gets
  the robot in their garage and saved robots.

Stats update as you build: weight, cost, top speed and pushing force, battery
life, each weapon's force or stored energy and spin-up time, spares and
rebuild time, and a full parts list. **Scrutineering** checks the weight
class (feather to super-heavy, or **Open**, which has no limits and allows
flamethrowers and cannons), budget, size, parts below the floor, voltage, gas, wiring and
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
