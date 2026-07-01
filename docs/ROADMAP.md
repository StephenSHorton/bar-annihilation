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

## Current status — v0.0.6 released (2026-06-30)

Releases ship via GitHub Releases (the CI workflow builds + attaches the mod zip on a
published release). **Shipped:** M0 (API verified), **M1** (faithful `select` DSL engine +
the real BAR Grid selection binds; keyboard overlay + movable **Keys** button), **M3**
(grid build menu), **M4** (build placement — line/grid/spacing, native mouse rotation,
v0.0.5), **M5** (area commands — PA-native arm + left-drag, non-interference gate, v0.0.4),
**M6** (formations — freehand right-drag + live preview, v0.0.3), and **M7** (unit states:
fire/move/wait toggles, command modes, repeat, self-destruct; native command/orders bar
shows the mod's keys). Also shipped: persistent order/queue lines.

**Polish audit (2026-06-30, workflow-scoped):** the remaining "polish" items resolved to
already-done or walls — Q select-similar is already faithful (the `visible` DSL source is
dead infra, closed); fabber auto-return already implemented; M4 persist-cursor rejected as
anti-faithful; M3 `.`-cycle-builder + M7 Alt+G quota + M5 area target-filters are walls
(not on the Grid cards and/or need a Recoil GameCMD / server-mod PA can't provide from a
client mod). M3 PriorityUnits top-row deferred (cosmetic; needs a hand-authored PA list).

Also shipped: **M8** (keybind/rebinding layer, v0.0.6) — an in-game Coherent rebind panel
(open via the keyboard overlay's **Rebind Keys** button) + a localStorage `BA.rebind` registry;
1:1 Mousetrap binds rebindable with live conflict detection, reset/reset-all, and BAR-faithful
"unbound = does nothing". **Next:** the server-mod investigation to reclaim the HP/idle/queue
walls (see M0 finding + catalog bucket d).

---

## M0 — Verify the PA `live_game` API  ✅ DONE (2026-06-25)
Mod injects into `live_game` and runs; `model.selection()` returns real unit data;
`api.select.*`, `api.unit.*`, `api.Holodeck`, input hooks all confirmed. Deliverable
`docs/API-MAP.md` written. **Finding:** BAR's queue insert-at-front / pop is **⛔ not
portable** — orders cross to the C++ sim via `engine.call('holodeck.unitCommand', …, queue)`
with `queue` as the only lever; no JS path reads/inserts/removes queue items. Shift-append
is already native. (The old "M1 — command-queue editing" milestone is therefore dropped.)

## M1 — Selection power tools  *(a)*  ✅ DONE (v0.0.4)
> Faithful `select` DSL engine + the BAR Grid selection binds shipped. The one
> remaining tier — the `Visible` source (build-order item 7 below) — is **closed**:
> `Q` "select similar" is already faithful via `selectSameTypeOnScreen`, and a
> `visible` source would be dead infra (viewport box-select flicker, no consumer).
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
Build-spacing modifier + persistent spacing, line build (drag a row), area/grid build.
Phases 1-6 done: a capture-phase **Shift**+left-drag handler driving PA's native screen-coord
fab path (`unitBeginFab`/`unitEndFab`) with arc-length spacing and per-building persisted
spacing (Alt+Z/X). Line/grid face along the drag. PLAIN left-drag is left fully NATIVE — PA's
own click-to-place + continuous drag-rotation (the user prefers mouse rotation; a discrete
`[` / `]` facing-key experiment was built then reverted). See `docs/BAR-M4-BUILD-PLAN.md`.

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

## M7 — Unit states & set-target  *(a / d)*  ✅ DONE (v0.0.2+)
Fire/move states (`;`/`L` absolute-by-tap-count), wait/energy-hold (`Y`), repeat
(`T` factory build-stance), command modes (attack/reclaim/repair/patrol/guard/
load/unload/D-gun etc. arm-then-click), self-destruct (`Ctrl+B`). The native
command/orders bar is patched to show the mod's keys (`actionbar-tooltips.js`).
**Walls (dropped):** `set-target`/target-ground (no PA verb), Alt+G build-quota
(needs a Recoil GameCMD PA lacks). Per-unit default-states for new units: deferred.

## M8 — Keybind / control-scheme layer  *(c)*  ✅ v0.0.6
A config surface for binds so the above features are rebindable, with sensible
BAR-like defaults out of the box. **Architecture (2026-06-30): Option B — an in-game
Coherent rebind panel + a localStorage bind registry** (`BA.rebind`), matching the
mod's existing panel pattern; no PA-API mutation. Plan: `docs/M8-KEYBIND-PLAN.md`.

**Built (Phase 1 registry → Phase 2 bind-refactor + panel in parallel worktrees →
integrate + adversarial review, all on `main`):**
- `modules/rebind-config.js` — the `BA.rebind` registry (deltas-only localStorage
  `barann.binds`, conflict-steal, never-bind-1-0, export/import API, onChange).
- `modules/selection-binds.js` refactored registry-driven (24 actions; `applyBinds`
  unbinds stale keys; default action-bar badges verified byte-for-byte unchanged).
- `modules/rebind.js` + `rebind-panel.html` — the panel (host-owned key-capture,
  live conflict detection, reset/reset-all) opened via a **Rebind Keys** button in
  the keyboard overlay. Display-only rows for the capture-phase gestures.

**Scope:** simple 1:1 (Mousetrap) binds are rebindable; capture-phase binds
(shift+drag build, grid slots, formation drag) shown display-only; **key-chaining**
(BAR's `sc_l,sc_l` multi-tap) deferred. **Import/Export UI deferred** — the panel must
be `no-keyboard` (so the host can capture rebind keys), so a paste textarea can't work;
binds persist automatically and `BA.rebind.export()/import()` remain on the registry for
the console. A click-driven clipboard version is a future item. **Review:** 2 findings,
both fixed (a show()-on-bind-failure key-freeze guard; the Import/Export deferral).

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
