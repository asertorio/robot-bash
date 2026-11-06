# src/sim — simulation

Headless: runs in Node under Vitest. Only imports `@dimforge/rapier3d-compat`,
other `sim/` modules and `src/data` catalogues — never render, ui, input,
Three.js or the DOM. `RAPIER.init()` must have resolved before a `Match` is
built (tests do it in `tests/helpers.ts`, the app in `main.ts`).

## Map

| File | Role |
|---|---|
| `design.ts` | RobotDesign v2 types (the saved format) |
| `legacy.ts` | v1 format and `fromV1` (built-in robots are still authored in v1) |
| `assembly.ts` | Pure geometry, mass and inertia for part trees; `treeErrors` validation |
| `build.ts` | Garage edits on a part tree (add, mirror, re-parent, remove) keeping ids unique |
| `groups.ts` | Rapier collision groups (a robot's own parts don't collide) |
| `shapes.ts` | Every shape → convex pieces; `pieceMassProps` for exact hull mass/inertia |
| `robot.ts` | `Robot`: builds Rapier bodies from a design, runs drive, actuators, failures |
| `motor.ts` | DC motor torque/speed/current model |
| `damage.ts` | `DAMAGE`, `SHOCK`, `HEAT` constants: contact energy → part condition |
| `match.ts` | `Match`: fixed 480 Hz step, count, pit, hazards, judges, commentary |
| `arena.ts`, `house.ts` | Arena geometry/hazards, house robots and their CPZs |
| `ai.ts` | `CpuDriver` and generic `WeaponOperator` |
| `rules.ts` | Scrutineering (weight class, budget, size, voltage, gas…) |
| `stats.ts` | Derived stats shown in the garage |
| `control.ts`, `vmath.ts` | `ControlState`; small vector helpers on `V3` |

## Invariants — don't break these

- **Physics produces outcomes.** No hit points, no "weapon does N damage", no
  scripted results. If behaviour is wrong, fix the model (forces, masses,
  energies), not the outcome.
- **Fixed step `STEP = 1/480`.** Spinner tip speeds need it; don't raise it or
  make it variable. CCD stays on chassis, wheels and weapons.
- **Mass comes from shapes × materials.** `computeStats(d).mass` and the
  built robot's mass must agree (tested). Use `pieceMassProps`, not Rapier's
  own, for hulls — Rapier is badly wrong for flat hulls.
- **Every force has a reaction.** Motor torque on a part is matched by an
  equal and opposite torque on its parent body (spinners twist their robot).
- **CPU and house robots use the same controls as a human** (`ControlState`)
  — no cheating access to physics.
- Damage energy uses closing speed measured **before** the robots' own motors
  and rams act that step; otherwise pushing reads as repeated impacts.
- Wheels touch the floor through a same-radius sphere and robots through
  their cylinder (avoids Rapier's cylinder-on-box creep). Skids sit a few mm
  clear of the floor.
- Damage tuning goes in the constant objects in `damage.ts`, with the formula
  in the doc comment and in `docs/DESIGN.md` → Damage model.
- Anything that owns Rapier objects needs a `free()` path.

Performance budget: ~2 ms CPU per rendered frame for a two-robot fight. Avoid
per-step allocations in hot loops (`Robot` update, contact handling).
