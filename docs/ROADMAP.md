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

## Current status — v0.0.4 released (2026-06-28)

Releases ship via GitHub Releases (the CI workflow builds + attaches the mod zip on a
published release). **Shipped:** M0 (API verified), part of M1 (selection power tools —
several real BAR Grid binds, plus the keyboard overlay toggled by a movable on-screen
**Keys** button), **M3 (grid build menu)**, **M6 (formations** — freehand right-drag
with a live per-unit preview overlay + non-crossing assignment, v0.0.3), and **M5 (area
commands** — PA-native arm + left-drag; the mod ensures right-drag formations don't
hijack them, v0.0.4). Also shipped: persistent order/queue lines (selection-scoped).
**In progress:** M1 (the faithful `select` DSL tiers). **Next up:** M4 build placement,
then M7 (unit states & set-target).

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

## M3 — Grid build menu  *(c)*  ✅ DONE (2026-06-27)
Spatial 3×4 keyboard build grid (BAR's `gui_gridmenu`), our own Coherent overlay +
keymap. **Shipped:** real build icons; **factory + mobile-builder (fabber)** support;
BAR build categories Economy/Combat/Utility/Production on Z X C V (home overview =
category buttons + a top quick-access row, advanced/basic dedup); click + hotkey
batching (Shift ×5, Ctrl cancel, hold **Space** = front of queue); fabber ghost
placement via PA's native build mode; hover tooltip (name/desc/stats); native build
bar suppressed while open. Design + verified BAR category spec in
[`M3-GRID-BUILD.md`](./M3-GRID-BUILD.md). **Deferred polish:** BAR `PriorityUnits`
top-row override (needs hand-authored data), `.`-key cycle-builder, fabber
auto-return-after-place timing.

## M4 — Build placement: spacing, line & area build  *(b)*  ✅ v0.0.5
Build-spacing modifier + persistent spacing, line build (drag a row), area/grid build,
and BAR build **facing** (`[` / `]` cycle 0..3 S/E/N/W). Phases 1-6 done: capture-phase
left-drag handler driving PA's native screen-coord fab path (`unitBeginFab`/`unitEndFab`)
with arc-length spacing, per-building persisted spacing (Alt+Z/X), and key-controlled
facing applied as the begin→end fab vector — which **replaced** PA's native continuous
left-drag-rotate (faithful to BAR's discrete facing). See `docs/BAR-M4-BUILD-PLAN.md`.

## M5 — Area commands  *(b)*  ✅ v0.0.4
Radius-drag reclaim / repair / capture / area-attack / area-unload are **PA-native**:
the engine enters area mode when a command is armed (our cmd-mode keys) and you
LMB-drag. The mod's job here is non-interference — the right-drag formation handler
has an eligibility gate so non-formation verbs fall through to PA's native area path
instead of being hijacked. (Alt/Ctrl target filters + smart-area-reclaim: future.)

## M6 — Formations  *(b)*  ✅ v0.0.3
CustomFormations2 port: freehand right-drag path with arc-length resample + even
distribution, per-unit `worldview.sendOrder`, GetOrdersNoX non-crossing assignment,
and a live formation overlay (no-input panel composited over the 3D, rAF-repainted).

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
  registered via the `core.js` module registry (`BA.register`), so any can be
  toggled off. (The old monolithic `live_game.js` was split into `core.js` +
  `modules/` on 2026-06-26.)
- Re-test on the installed game every milestone; update `modinfo.json` `build`.
- Items in bucket (d) (terraform/D-gun/cloak/stockpile analogs, wait-family,
  engine selection-volume queries) are explicitly out of scope until proven
  feasible — see catalog porting notes.
