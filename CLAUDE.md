# Robot Bash

Browser robot-combat game: robots are built from real parts and every hit is
worked out by physics (Rapier) — no health bars, no scripted damage. Three.js
renders, TypeScript throughout, Vite builds, Vitest tests. No UI framework.

`docs/DESIGN.md` is the source of truth for the design: pillars, units, the
RobotDesign format, drive/weapon/damage formulas, rules and roadmap. Read the
relevant section before changing behaviour, and **update it in the same change**
when you change how something works.

> `README.md` is currently corrupted (the same sections repeated ~4,000 times,
> ~14 MB). Don't read it whole; `git show 2688b73:README.md` is a clean early
> version if you need its structure.

## Commands

```sh
npm run dev         # Vite dev server; showroom.html?robot=<id> for one robot close up
npm test            # Vitest, headless physics (~10 s, 150+ tests)
npm run typecheck   # tsc --noEmit (strict, noUnusedLocals/Parameters)
npm run build       # typecheck + static build into dist/
```

Run `npm run typecheck && npm test` before calling a change done. CI
(`.github/workflows/deploy.yml`) runs tests and build on push to `main`, then
deploys to GitHub Pages; a red test blocks the deploy.

## Layout

```
src/
  sim/      Physics + game rules. Headless: never imports render/, ui/, input/ or the DOM.
  data/     Catalogues (parts, materials), built-in robots (templates, roster,
            house, examples), garage save/load (localStorage)
  input/    Key/gamepad bindings, arcade/tank mixing, key ramp, macros
  render/   Three.js view that mirrors the sim; never changes collision shapes
  ui/       Menus, HUD, garage editor, controls screen — plain DOM via h() in ui/dom.ts
  dev/      showroom.ts (dev-only page)
  main.ts   App: screens, match loop, wiring players/CPUs to the sim
tests/      Vitest; helpers.ts initialises Rapier and has run()/spawnAt()/drive()
```

Dependency direction: `data` and `sim` may import each other's types and
catalogues; `input`, `render` and `ui` sit on top. Nothing in `sim` or `data`
may touch `document`, `window` or Three.js (localStorage in `data/garage.ts`
is the one exception, wrapped in try/catch).

## The RobotDesign contract

`src/sim/design.ts` (schema 2) is the central data format: templates, the
garage, saves, JSON import/export and the CPU all use it. Saves live in
users' browsers, so:

- Keep it plain JSON-serialisable data.
- New fields must be optional with a sensible default, or old saves break.
- Schema 1 saves are converted by `fromV1` (`src/sim/legacy.ts`) inside
  `checkDesign` (`src/data/garage.ts`). A breaking change needs a new schema
  number and an upgrade path there.
- `checkDesign` validates untrusted input (imports, old saves) — extend it
  when you add fields that could be malformed.

## Conventions

- **British English** in UI text, comments and docs: armour, aluminium,
  colour, metres, centre, tyre. Code identifiers follow it too (`colour`).
- SI units in the sim (m, kg, s, N, J); a field says when it's in mm or
  degrees. Robot frame: +Z forward, +Y up, +X left.
- Built-in robots and house robots use **original names** — never real
  *Robot Wars* house robots, competitors or branding. The show's *format* is
  fine to recreate.
- Derived stats (`sim/stats.ts`) describe a design; they are outputs, never
  inputs to combat. Combat outcomes come from the physics.
- Tuning constants live in one named object near the top of their module
  (e.g. `DAMAGE`, `SHOCK`, `HEAT` in `sim/damage.ts`) with a doc comment
  giving the formula and what the numbers mean.
- Comments explain *why* and give real-world reasoning ("that's what real
  drive ESCs do"); keep that style.
- Built-in robots are authored in v1 form and reshaped with
  `data/shaping.ts`; `reshape()` throws on unknown part ids on purpose.

## Tests

- Tests drive real `Match`es headlessly. Pass `{ skipCountdown: true }`,
  advance with `run(m, seconds, controls)`, and **always call `m.free()`**
  (Rapier worlds are WASM memory and leak otherwise).
- Assert on physical outcomes (positions, condition, mass, results), with
  tolerances — not on internal call sequences.
- Every built-in robot must be legal for its class and its sim mass must
  match its bill of materials (`tests/sim.test.ts`); new robots get this for
  free by being added to `TEMPLATES`/`ROSTER`/`HOUSE_ROBOTS`.
- Add a test for each behaviour fix (e.g. "a 0.1 s tap moves ~0.1 m").

## Commits

Title in plain English describing the player-visible change, then a body
grouped by area (Garage / Fights / Damage / CPU / Robots / Physics) with
short bullets that give before → after numbers where there are any.
