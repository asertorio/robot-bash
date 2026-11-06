# src/render — Three.js view

Mirrors the simulation; it never drives it. Each frame, `view.ts` reads body
transforms and part state from the `Match` and updates meshes.

- **Draw from the design alone.** `partMesh.ts`, `surfaces.ts` and
  `mechanisms.ts` must work for any player-built RobotDesign, not just the
  built-ins — no per-robot special cases keyed on ids or names.
- **Never change collision shapes or mass from here.** Visual detail
  (chamfers, bolts, treads, ram rods) stays within a few mm of the physics
  shape from `src/sim/shapes.ts`.
- Damage shows the way a builder would see it: paint chipped back to bare
  material in proportion to part condition, soot from fire. No health bars on
  robots.
- Catalogue materials have hand-tuned finishes in `bareFinish()`
  (`surfaces.ts`); custom materials fall back to one from density and
  colour. A new catalogue material in `src/data/materials.ts` should get its
  own case there.

Check visual changes with the showroom (dev server):
`showroom.html?robot=<id>&yaw=0.6&pitch=0.4&dist=2&fire=1&damage=0.6`.
Robot ids come from `src/data/templates.ts`, `roster.ts` and `house.ts`.
