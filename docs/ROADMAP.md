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

## M0 — Verify the PA `live_game` API  ⟵ next
Map the catalog's right-hand columns onto concrete PA capabilities. Confirm:
- reading current selection; iterating units & their types/queues
- issuing orders (move/attack/build) and **queue insert / remove**
- hooking keyboard & mouse input; reading world-space cursor position
- the keybind/config surface
Deliverable: a "hello world" build that loads in `live_game` and logs the live
selection, **plus** an API map appended to the catalog (PA: yes / via X / no).
Reference: Hotbuild2 and other shipped control mods.

## M1 — Command-queue editing  *(a)* — the headline feature
- shift-append (confirm PA-native; wrap only if needed)
- **insert command at front of queue** (BAR's Insert / `CMD.INSERT`)
- **pop / remove front (or selected) queue item** (`CMD.REMOVE`)
- cancel-last-order, clear-queue
Gate: if PA can't address queue items by index/tag, this drops to (d) — flag early.

## M2 — Selection power tools  *(a)*
Control-group parity, select-all-of-type (on-screen / map-wide), idle-builder
cycling, and a JS reimplementation of BAR's `select Source+_Filter_+Conclusion`
DSL (filter over the unit list). Append/subtract/toggle modifiers.

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
