# BAR Annihilation — Roadmap

Build order follows the **porting triage** at the end of
[`BAR-Control-Scheme-Catalog.md`](./BAR-Control-Scheme-Catalog.md): easiest and
most-wanted first, riskiest (engine-dependent) last. Each milestone ends with a
real in-game test on the installed PA before moving on.

Legend — triage buckets from the catalog:
**(a)** discrete order/state via PA's API · **(b)** needs world-space drag/draw
input · **(c)** needs a custom Coherent/JS HUD overlay · **(d)** depends on PA
engine support, may not port.

---

## M0 — Verify the PA `live_game` API  ✅ DONE (2026-06-25)
Mod injects into `live_game` and runs; `model.selection()` returns real unit data;
`api.select.*`, `api.unit.*`, `api.Holodeck`, input hooks all confirmed. Deliverable
`docs/API-MAP.md` written. **Finding:** BAR's queue insert-at-front / pop is **⛔ not
portable** — orders cross to the C++ sim via `engine.call('holodeck.unitCommand', …, queue)`
with `queue` as the only lever; no JS path reads/inserts/removes queue items. Shift-append
is already native. (The old "M1 — command-queue editing" milestone is therefore dropped.)

## M1 — Selection power tools  *(a)*  🚧 IN PROGRESS
Slice 1 shipped & tested: Alt+C all-combat, Alt+D idle-builder, Alt+X split-50%
(provisional binds). Remaining: air/land/naval + on-screen variants, all/idle factories,
idle-builder **cycling** + camera-center, select-all-of-type (on-screen / map-wide),
control-group parity, append/subtract modifiers, and a JS reimplementation of BAR's
`select Source+_Filter_+Conclusion` DSL (filter over the unit list). Then move binds onto
PA's keybind system with BAR-style defaults. ⛔ out (no engine verb): add-to-group,
toggle-in-group. ⚠️ deferred (no per-unit HP in payload): damaged-unit filters.

## M3 — Grid build menu  *(c)*
Spatial keyboard build grid + category keys (BAR's `gui_gridmenu`). Hotbuild2 is
proof-of-concept; build our own Coherent overlay + keymap. Includes build-queue
quantity batching.

## M4 — Build placement: spacing, line & area build  *(b)*
Build-spacing modifier + persistent spacing, line build (drag a row), area build
(radius drag → many of one building). World-space drag handler emitting batched
positioned build orders.

## M5 — Area commands  *(b)*
Radius-drag reclaim / repair / capture / area-attack / area-unload, plus the
Alt/Ctrl target filters and smart-area-reclaim. Reuses M4's drag handler.

## M6 — Formations  *(b)*
CustomFormations2: right-drag line/arc with even distribution, then freehand
path with assignment. Formation rendering overlay.

## M7 — Unit states & set-target  *(a / d)*
Fire/move states, on/off, repeat, **set-target** persistent priority, default
states for new units. Several depend on PA exposing the underlying orders —
verify per item against the M0 API map.

## M8 — Keybind / control-scheme layer  *(c)*
A config surface for binds (PA has a JSON keymap but not BAR's
scancode/keychain semantics) so the above features are rebindable, with sensible
BAR-like defaults out of the box.

---

### Cross-cutting
- Keep each feature an independent module under `ui/mods/<id>/modules/`,
  registered in `live_game.js`, so any can be toggled off.
- Re-test on the installed game every milestone; update `modinfo.json` `build`.
- Items in bucket (d) (terraform/D-gun/cloak/stockpile analogs, wait-family,
  engine selection-volume queries) are explicitly out of scope until proven
  feasible — see catalog porting notes.
