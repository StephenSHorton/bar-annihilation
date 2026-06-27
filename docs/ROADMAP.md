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
The goal is a **faithful** port of BAR's `select Source+_Filter_+Conclusion+`
([`select_api.lua`](../../bar-src/luaui/Include/select_api.lua)) — see the design in
[`SELECT-ENGINE.md`](./SELECT-ENGINE.md). Architecture: one reusable engine
(`BarAnnihilation.select.run`) with a sync def-trait tier (SpecCache), an async
`getUnitState` tier, and group shadow-trackers. Every BAR preset = one `select.run(...)`
wired into `KEYMAP`.

**Already correct:** Ctrl+Tab=idle-builder cycle, Ctrl+Q=split-50% (BAR `SelectPart_50`),
backslash overlay, Ctrl+Shift+R dev reload. **Control-group focus is NATIVE in PA** — its
keyboard 1-9 are themselves `input.doubleTap(recallGroup, camera.track)` (verified
`inputmap.js:154`); single=recall, double=center. So control groups need **no mod code**
(⚠️ never add 1-0 to the Mousetrap override — it clobbers PA's native doubleTap).

**Shipped but NON-FAITHFUL — to fix:** `Ctrl+E` does `allCombatUnits` but BAR's is
`AllMap → SelectAll` (**all** units); `Q` does same-type-on-screen but BAR's is
`Visible+InPrevSel` (narrow-to-on-screen). `Tab` lacks BAR's commander cycle/always-focus.

**Real BAR grid binds — status:** ✅ Ctrl+E=all-units (`AllMap → SelectAll`, fixed
2026-06-26), Tab=`selectcomm focus` (have), Ctrl+Q=split, Ctrl+Tab=idle-builder.
**Dropped:** Shift+Tab=`selectcomm append` — Steam's overlay hotkey is `Shift+Tab`
and intercepts it globally before PA (can't capture from JS); not worth a non-BAR
rebind. **Alt+Q**=damaged-mobiles — `getUnitState` carries no HP (probe 2026-06-26)
and no client path exposes per-unit health → hard wall. Ctrl+W=`AllMap+InPrevSel`
(≈no-op, skip).

**Build order (in-repo, this milestone):** (1) ✅ engine sync core + probe module; (2) ✅
probe run — async surface confirmed (allmap=per-planet; getUnitState=`{planet,unit_spec,pos,
army,orient}`, no HP; categories via `spec:` GET); (3) ✅ faithful `Ctrl+E` (all-units) +
per-planet `allmap`; (4) category filters via `spec:` GET → Aircraft/Radar/Jammer/AntiAir;
(5) position tier (getUnitState `pos` + `raycastTerrain`) → FromMouse/closest; (6) group
shadow → InHotkeyGroup/InGroup_n; (7) the Visible snapshot-hack → faithful `Q`.

⛔ **Not portable — grey out, never fake** (verified): Cloak/Cloaked, Stealth, Resurrect,
**Guarding**, **Waiting** (PA has no wait command → `Ctrl+Y` dead), **Patrolling** (no per-unit
order-queue read); world→screen projection (no JS frustum → `Visible` only via the engine
on-screen-select hack); generic per-unit idle (native idle exists only for fabbers/factories).

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
