# M3 GRID BUILD — DESIGN (synthesis)

# M3 — Grid Build Menu (full implementation design)

## PORTABILITY VERDICT (read this first)

**M3 is FEASIBLE. Both halves work from JS in the `live_game` scene — no un-driveable native clicks required.**

**(a) Enumerate buildables for the selection — FULLY WORKS, zero engine round-trip.**
- Read `model.selection()` → `{ spec_ids:{specId:count}, build_orders:{specId:count}, selected_mobile }` (`live_game.js:1968/2128/2146`).
- For each selected `specId`, read `model.unitSpecs[specId].build` — an array of resolved buildable spec objects (`{id,…}`), cross-referenced at `crossRefUnitSpecs` (`live_game.js:3972-3998`). Union them → the buildable set.
- **Tag caveat:** spec ids carry a `.player`/`.ai` suffix; reuse the stock strip-regex `/(.*\.json)[^\/]*$/` + `.player`/`.ai` fallback (`build_bar.js:246-343`, `buildItemBySpec` `live_game.js:1779-1795`) when looking ids up in `unitSpecs`.
- Each spec also exposes `structure`/`titan` flags (placement-vs-queue discriminator) and `buildGroup`/`buildRow`/`buildColumn` (PA's own grid hints — useful but we override with BAR layouts).

**(b) Trigger build selection + placement/queue — FULLY WORKS for factories, WORKS-with-world-coords for fabbers.**
- **Factory (structure selected, `selected_mobile === false`): clean 1:1, no coordinates.**
  `api.unit.build(specId, count, immediate)` → `engine.call('unit.build', spec, count, immediate)` (`shared/js/api/unit.js`). Cancel/decrement via `api.unit.cancelBuild(specId, count, immediate)`. Applies to the current server-side selection. This is exactly the native button path (`executeStartBuild` factory branch, `live_game.js:1822-1828`). **This is the heart of M3 and it is trivial.**
- **Fabber (engineer selected, `selected_mobile === true`): needs a map location.** Two routes:
  1. **Recommended (world coords, no clicks):** `model.holodeck.view.sendOrder({ units:[handles], command:'build', spec:'/pa/units/.../x.json', location:{ planet, pos:[x,y,z], radius? }, queue, count })` (`worldview.js:140-186`; `model.holodeck.view === api.getWorldView(0)`, `holodeck.js:54`). Pre-snap proposed positions with `worldview.fixupBuildLocations(spec, planet, locations)` (`worldview.js:188-206`) to get engine-legal placements (metal-spot / grid snap).
  2. **Native-identical fallback (screen px):** `api.arch.beginFabMode(spec)` then `model.holodeck.unitBeginFab(x,y,snap)` + `unitEndFab(x,y,queue,snap)` (`holodeck.js:181-191`) — requires screen-pixel coords (cursor pos or computed projection).

**Net:** Enumeration = `model.unitSpecs[…].build`. Factory build = `engine.call('unit.build', …)`. Fabber placement = `view.sendOrder({command:'build', …})` (+ `fixupBuildLocations`). The only genuine friction is *supplying a placement location for fabbers* — solved with world coords. **For M3 we should ship the factory grid first (frictionless), then layer fabber placement.**

---

## Faithful behavior (from the BAR grid spec)

The faithful target is `gui_gridmenu.lua` + `gridmenu_config.lua` + `gridmenu_layouts.lua`.

- **3×4 grid (12 cells), indexed 1..12 row-major from bottom-left.** `index = col + (row-1)*4`. Row 1 = bottom, row 3 = top.
- **Physical-key block maps spatially onto the grid:** top row `Q W E R` (cells 9-12), middle `A S D F` (cells 5-8), bottom `Z X C V` (cells 1-4). **Bind by scancode/physical position, not letter**; display the localized char via a `sanitizeKey`-equivalent. Bottom-left = `Z`, top-right = `R`.
- **Two fundamentally different input modes:**
  - **Factory selected** → no categories; grid is the factory's flat 12-slot layout (`LabGrids[unitName]`); a cell press **enqueues** units with modifier multipliers (no map placement).
  - **Mobile builder** → categories (Economy/Combat/Utility/Production = `Z X C V`) + a "home" overview (one category per column, bottom-up, top-row priority override); a cell press **enters placement** (then click map to place).
- **Modifier batching (factories):** keyboard — key=+1, Shift=+5, Ctrl=−1, Shift+Ctrl=−5. Mouse — left=+1, Shift=+5, Ctrl=+20, Shift+Ctrl=+100; right negates. (BAR/Spring FactoryCAI semantics.)
- **Z/X/C/V dual-purpose:** with no category open → opens the category; with a category already open → selects the bottom-row cell. Resolve by "is a category open AND is there a cell at that index."
- **Shift is overloaded:** ×5 multiplier *and* momentary category-peek (hold Shift, tap category key to browse, release to snap home). Non-shift placement auto-returns home (`CommandNotify`); shift-placement stays open for rapid queuing.
- **Pages:** >12 options → `ceil(count/12)` pages; **B** = next page (wraps); page resets to 1 on selection change.
- **Cycle builders:** `.` (period) advances `activeBuilder` through up-to-5 selected builder *types*.
- **Return to home:** Back button (label "Shift"), Shift-release, right-click off-panel, Escape, or auto-return after a non-shift build.
- **Per-cell content:** unit icon, metal/energy price labels, hotkey label, factory queue-count badge, build-progress radial, disabled/restricted greying, group/radar badges.
- **Layout content** (`gridmenu_layouts.lua`) is authoritative; the engine resolves it against what the builder can actually build and appends un-slotted units (scavengers etc.) into the first empty cells.

> **Porting scope decision:** ship the **side-docked 3×4** layout (not `stickToBottom` 2×6), with `useLabBuildMode=false` (factories always show their grid), and **omit Quota mode** (optional `WG.Quotas` add-on) for v1.

---

## VERIFIED BAR CATEGORY SPEC (2026-06-26, from BAR @master source) + PA mapping

Confirmed verbatim from `luaui/configs/gridmenu_config.lua`, `gui_gridmenu.lua`, `luaui/configs/hotkeys/gridmenu_keys.txt`:

- **Grid is 3×4, indices numbered bottom-up:** cells 1-4 = bottom row (Z X C V), 5-8 = middle (A S D F), 9-12 = top (Q W E R). Physical scancodes (`sc_z` etc.), layout-independent.
- **Exactly 4 categories, fixed order = column:** `Economy(1) Combat(2) Utility(3) Production(4)`. Category index ↔ column 1:1. Z X C V (bottom row) are the 4 category keys.
- **Unit→category** = `categoryGroupMapping[unitDef.customParams.unitgroup]`, **default Utility**:
  `energy,metal→Economy`; `builder,buildert2/3/4→Production`; `util→Utility`; `weapon,explo,weaponaa,weaponsub,aa,emp,sub,nuke,antinuke→Combat`.
- **Home overview** (`homeOptionsForBuilder`): each column = one category; the category's first ≤3 buildables fill that column **bottom-up** (`index = cat + (k-1)*4`); the **top row** of each column is overridden with a priority unit (`PriorityUnits`) when one exists.
- **Z/X/C/V dual-purpose:** no category open → `gridmenu_category N` consumes (opens category); a category open → the category handler bails (`currentCategory and cellRects[i]`) so `gridmenu_key 1 N` builds the bottom cell. Non-shift modifiers (ctrl/alt) always route to the grid-key.
- **Shift peek + return:** explicit `Shift+sc_z..v` binds open (peek) a category; releasing **LShift** → `clearCategory()` (home). After a build, `CommandNotify` returns home **unless** the order was shift-queued (`alwaysReturn` setting forces always).
- **Paging:** `sc_b` = `gridmenu_next_page`, **wraps** 1→N→1 (no prev bound); `pages = ceil(count/12)`; `sc_.` = cycle builder.
- **Factory:** flat hand-authored 12-slot grid (`LabGrids`), **no categories**; grid keys queue directly; paged with B if >12.
- **Gap-filler:** un-slotted buildables fill the first empty cells scanning index 1→12 (bottom-left first).

**PA mapping (our port).** PA has no `unitgroup`, but each buildable carries `buildGroup` (+ `buildIndex`/`buildRow`/`buildColumn`) from `shared/js/build.js` `HotkeyModel.SpecIdToGridMap`. PA's groups = `factory, combat, utility, vehicle, bot, air, sea, orbital, orbital_structure, ammo` (`live_game_build_bar.js:405` tabsTemplate). PA **buries economy inside `utility`**, so we split it out by path:
- Economy ← path matches `metal_extractor|energy_plant|metal_storage|energy_storage|metal_maker`
- Combat ← `buildGroup ∈ {combat, ammo}`
- Production ← `buildGroup === 'factory'`
- Utility ← everything else (radar/jammer/teleporter/barrier/orbital/fallback)
Order within a category = PA `buildIndex`. (Fabbers build only structures, so these 4 cover everything; `PriorityUnits` top-row override deferred — needs hand-authored data; `.`-cycle-builder deferred.)

## Architecture

### Overlay (reuse the `<panel>` pattern)
- One module `gridmenu.js` registered via `BarAnnihilation.register`, living in `ui/mods/com.pa.stephenshorton.bar-annihilation/modules/`.
- On init: create a `<panel>` el, `setAttribute('src','coui://ui/mods/<id>/gridmenu.html')`, set fit + no-input attrs, `document.body.appendChild(el)`, `api.Panel.bindElement(el)`. Painted content (12 cells, category row, page/back buttons, builder strip) lives in `gridmenu.html` (+ its own JS/CSS).
- Data push: parent computes the cell model and calls `api.panels['<id>'].message('grid:update', payload)`. The child paints; **the child issues nothing** (mirrors how stock `live_game_build_bar` only messages back). All order logic stays in the parent module where `model`, `engine.call`, and `api.unit`/`worldview` live.
- The child reports hover/click back via `api.Panel.message(parentId, 'grid:click', {cell, button, shift, ctrl})` *only* as a mouse fallback; the **keyboard is the primary path** and is handled entirely in the parent keymap.

### Keymap (grid keys) — total-override Mousetrap
- Reuse the existing unbind+bind total-override keymap (re-applied on `active_dictionary`).
- Bind the 12 spatial keys by physical position: `Q W E R / A S D F / Z X C V` → `onCell(1..12)`. Bind `B`→nextPage, `.`→cycleBuilder, `Shift` (keydown/keyup) for peek/return, `Esc`→back.
- **Only active when the grid is "open"** (a builder/factory is selected and our menu owns input). When closed, the keymap must *pass through* to PA (or to other BAR modules) — gate each handler on `gridState.open`.
- Track live modifier state (shift/ctrl) from the keydown event for batching.

### Keypress → build item
1. `onCell(cellIndex)` looks up `gridState.cells[cellIndex]` → `{specId, disabled, isStructureBuilder}`.
2. Reject if empty/disabled/restricted.
3. **Z/X/C/V overlap:** if `cellIndex ∈ {1,2,3,4}` AND builder is mobile AND no category open → treat as `openCategory(index)` instead of cell-select. Else cell-select.
4. **Dispatch by mode:**
   - **Factory** → `queueBuild(specId, quantity)` where `quantity` = batching from modifiers (below).
   - **Mobile builder** → `beginPlacement(specId)` (arm fabber build / set blueprint).

### Queue-quantity batching
- Compute `quantity` from modifiers: keyboard {key:+1, shift:+5, ctrl:−1, shift+ctrl:−5}.
- `queueBuild(specId, q)`:
  - If `q > 0`: `api.unit.build(specId, q, urgent)` (urgent = some chosen modifier, default false). One call carries the count — no per-unit loop needed (unlike BAR's `multiQueue` batching, which only existed to fold Spring's per-order multipliers; `unit.build` takes `count` directly).
  - If `q < 0`: `api.unit.cancelBuild(specId, |q|, urgent)`.
- Reflect the predicted new count optimistically in the cell badge; reconcile from `model.selection().build_orders` / the `unit_specs`/selection refresh on the next push.

### Page / category navigation
- `gridState` holds `{builderSpec, isFactory, currentCategory|null, currentPage, pages, cells[1..12], gridOpts[]}`.
- `refreshCommands()` recomputes `gridOpts` (sparse, 1-based) from `model.selection()` + `model.unitSpecs[…].build`, applying the BAR placement engine ported from `gridmenu_config.lua`:
  - Factory → flat `LabGrids` table; append un-slotted buildables to first empty cells.
  - Mobile + category → `UnitGrids[cat]`; append un-slotted.
  - Mobile + home → one category per column (Eco/Combat/Util/Prod), first ≤3 per column, top-row `PriorityUnits` override.
- Category mapping from `customParams.unitgroup` → port `categoryGroupMapping`. **PA caveat:** PA specs may not carry `unitgroup`; see Risks — we will need a PA-side categorization (derive from spec path / `build` role, or hand-author per-faction tables).
- `updateGrid()` slices `gridOpts` by `currentPage` into the 12 cells, attaches price/hotkey/queue/progress, builds `specId→cellIndex` reverse map, then pushes to the panel.
- `nextPage()` wraps `currentPage`; reset to 1 on selection change.

### Return-to-menu
- `clearCategory()` → `currentCategory=null`, cancel any armed placement (`api.arch.endFabMode()` / clear blueprint), `refreshCommands()`, repaint.
- Triggers: Back, Shift-release (after a peek), Esc, right-click off-panel, and auto-return after a non-shift placement (mirror `CommandNotify`: if the issued order was not shift-queued, snap home).
- **Selection drives open/close:** subscribe to the selection handler; when selection becomes a builder/factory → open + `refreshCommands()`; when it loses all builders → close the overlay and release the keymap gate.

---

## BUILD PLAN (numbered, implementable as a new module)

1. **Scaffold the module.** Create `modules/gridmenu.js` (parent logic) + `gridmenu.html`/`.css`/child-JS. Register via `BarAnnihilation.register('gridmenu', …)`. No behavior yet — just create/bind the `<panel>`, append, and confirm it paints a static 3×4 grid.
2. **Selection wiring.** Subscribe to PA's selection updates. On each change, read `model.selection()` and `model.selectedMobile()`; set `gridState.isFactory = !selected_mobile`; open/close the overlay; gate the keymap.
3. **Enumeration layer.** Implement `buildablesForSelection()` → union of `model.unitSpecs[specId].build` over `spec_ids`, with the `.player`/`.ai` tag-fallback resolver. Unit-test the resolver against live spec ids from the probe.
4. **Port the placement engine** from `gridmenu_config.lua`: `getSortedGridForLab` (factory flat table), `getGridForCategory`, `homeOptionsForBuilder` (column-per-category + priority top row), and the "append un-slotted to first empty cell" gap-filler. Drive it from the BAR `gridmenu_layouts.lua` tables **translated to PA spec ids** (see step 11). Output the sparse 1-based `gridOpts`.
5. **Cell model + push.** `updateGrid()`: slice by page, attach `{specId, icon, metalCost, energyCost, hotkeyLabel, queuenr, disabled}` per cell, build `specId→cell` map, `api.panels['<id>'].message('grid:update', …)`. Child paints icons (`"#"+specId`? — confirm PA icon source), prices, hotkey labels.
6. **Keymap — spatial keys.** Bind `Q W E R / A S D F / Z X C V` by physical position to `onCell(1..12)`, plus `B`/`.`/`Shift`/`Esc`. Gate all on `gridState.open`. Display localized chars via a `sanitizeKey`-equivalent on the cell labels.
7. **Factory queue path.** Implement `queueBuild(specId, quantity)` using `api.unit.build` / `api.unit.cancelBuild` with the keyboard modifier table (+1/+5/−1/−5). Optimistic badge update + reconcile from `build_orders`.
8. **Mobile builder placement path.** Implement `beginPlacement(specId)`:
   - Primary: arm via `api.arch.beginFabMode(specId)` then capture the next holodeck click/drag and issue `view.sendOrder({command:'build', spec, units, location:{planet,pos,radius?}, queue})`, snapping with `fixupBuildLocations`. Resolve `units` handles via `getArmyUnits`+`getUnitState` (selection model gives counts, not handles).
   - Keep the native `unitBeginFab`/`unitEndFab` (screen-px) route as a fallback flag.
9. **Categories + home + pages.** Wire `openCategory`/`clearCategory`/`nextPage`/`cycleBuilder`. Implement the **Z/X/C/V overlap** resolution and **Shift peek/return** + auto-return-after-non-shift-build.
10. **Polish cell visuals.** Queue-count badge, build-progress radial (poll `unit_specs`/selection or the progress source), disabled/restricted greying, hover price, group/radar badges (defer badges if asset mapping is unclear).
11. **Layout data translation.** Translate `LabGrids`/`UnitGrids`/`PriorityUnits` (BAR unit names) → PA spec paths per faction. This is the biggest content task; start with one faction's factories, validate, then expand. Where a BAR unit has no PA equivalent, leave the cell empty (let the gap-filler place PA-only units).
12. **Live-probe + iterate** (next section). Confirm `unit.build`, `sendOrder` build, `fixupBuildLocations`, and spec-id/handle spaces in a real match; fix the categorization source.

---

## Live-probe checklist (confirm in a real match first)

1. **`model.unitSpecs` shape:** does `unitSpecs[specId].build` exist and contain resolved spec objects with `.id`? Confirm the tag suffix forms actually seen (`.player` vs `.ai`).
2. **`model.selection()` payload:** verify `spec_ids`, `build_orders`, `selected_mobile` populate for (a) a single factory, (b) multiple factories, (c) a fabber, (d) commander.
3. **Factory build:** call `api.unit.build(specId, 1, false)` with a factory selected → does it enqueue? Test `count=5`, and `cancelBuild`. Confirm `build_orders` reflects the new count.
4. **Categorization source:** inspect a spec for `customParams.unitgroup` (BAR's category key). If absent, determine PA's grouping field (or decide on path-based categorization).
5. **Fabber placement (world coords):** with a fabber selected, `getArmyUnits`/`getUnitState` to get handles → `view.sendOrder({command:'build', spec, units, location:{planet, pos:[x,y,z]}})`. Does a structure actually start? Does `fixupBuildLocations` return snapped legal positions (esp. metal extractors)?
6. **Icon source:** what string does the build-bar child use for unit icons? (Confirm whether `"#"+specId` or a spec field/URL — adapt the child paint accordingly.)
7. **Selection-change cadence:** which event fires on selection change, and is `model.selection()` already updated when it fires?
8. **Build progress + queue badges:** where does live factory queue count / build progress come from for the badge (selection `build_orders` only, or a per-frame source)?

## Risks

- **Categorization gap (highest).** BAR keys categories off `customParams.unitgroup`; PA may not expose an equivalent. Mitigation: derive category from spec path/role or hand-author per-faction category tables. The home overview + category navigation depend on this.
- **Layout-table translation effort.** `gridmenu_layouts.lua` is 3334 lines of BAR-specific unit→cell mappings. Faithful 1:1 requires per-faction PA spec mapping; this is content-heavy and the main schedule risk. Mitigation: gap-filler means an incomplete table still produces a usable grid.
- **Fabber placement coordinate friction.** `sendOrder` world coords is clean, but resolving the right `units` handles and getting `fixupBuildLocations` to match native snapping (metal spots, adjacency) needs live tuning. Factory path has none of this — ship it first.
- **Keymap conflict / pass-through.** The total-override keymap must not swallow `Q/W/E/R/...` when the grid is closed (camera/other binds). Strict `gridState.open` gating is essential; coordinate with the existing select-system keymap so both can coexist on `active_dictionary` re-apply.
- **Z/X/C/V + Shift overload bugs.** The dual-purpose keys and Shift-peek/return state machine are the subtlest BAR behaviors; easy to get wrong. Build a small state-machine and test each transition (open→peek→release, open category→bottom-row select, non-shift auto-return).
- **No batched-order array on the fabber path.** Multi-structure placement (line/area of buildings) would be N `sendOrder` calls; fine for v1 but a scaling note. (Factory `count` is a single call, so factories are unaffected.)
- **Icon/badge asset availability.** Group/radar badge icons (`LuaUI/Images/groupicons/*`) have no PA equivalent; may need omission or custom assets. Non-blocking.

---

# M5 — Area Commands (design sketch)

**Approach — two-tier, faithful-fallback.**
- **Tier A (native radius):** capture a radius-drag (reuse the M4/M6 holodeck drag handler: `mousedown/move/up` on the holodeck div, scale `offsetX/Y` by `ui_scale`, `raycastTerrain` center + edge → world `radius`), then fire one grouped order: `view.sendOrder({ units:selIds, command:'reclaim'|'repair'|'attack'|'attack_ground'|'unload', location:{planet, pos:[x,y,z], radius:R}, group:true, queue:shift })`. If the sim honors `location.radius`, this *is* BAR's engine-native area behavior, for free.
- **Tier B (client enumeration, required for Alt/Ctrl filters):** port `cmd_area_commands_filter.lua` to JS. Build the cylinder set ourselves: `getArmyUnits(army, planet)` → `getUnitState(ids)` → keep `dist(pos,center) ≤ R`. **Ctrl** = all in radius (of the command's allegiance class); **Alt** = only those whose `unit_spec` matches the hovered unit's spec. Sort nearest-first from selection centroid; issue one `sendOrder` per target with `location.entity:<id>` (`queue:true` after the first). Smart-area-reclaim, area-reclaim-enemy, and the unload golden-ratio sunflower spiral are all just different target-set builders on this same enumerate→sort→issue spine.

**PA verbs.** `worldview.sendOrder` (order + `location.radius` + `location.entity` + `group`/`queue`); `worldview.getArmyUnits` + `getUnitState` (cylinder-query substitute); `holodeck.raycastTerrain` (drag center/edge); `model.selection()` (acting units); Coherent `<panel>` overlay for the ring; existing keymap → set "area mode," consume next drag.

**Portability.**
- ✅ reclaim / repair / area-attack / area-unload → real PA commands.
- ⛔ **area-capture** and **area-resurrect** — **no PA verb** (`capture`/`resurrect` absent from both the `live_game` vocab and `sendOrder`'s list). Out of scope; do not fake.
- ⛔ **Meta front-insert / Meta+Shift split** (BAR `CMD.INSERT`) — not portable; `queue` boolean is the only lever. Drop meta variants; keep nearest-first + shift-append.
- ⚠️ Alt/Ctrl filters are **always Tier B** even if native radius works (Alt same-type needs our spec match).
- ⚠️ **No HP** in `getUnitState` → can't pre-filter "repair only damaged"; issue repair on all friendlies in radius and let the sim no-op the healthy.
- ⚠️ **Wrecks/features:** `getArmyUnits` enumerates *units* per army; wreckage may be a neutral/feature entity not covered → smart-reclaim metal-vs-energy center logic uncertain; Tier-A native radius likely needed for wrecks.
- ⚠️ Enumeration is async + per-army; throttle and cap target count (BAR caps ~2000).

**Top unknowns (ranked).**
1. **Make-or-break:** does `sendOrder` with `location.radius` actually produce an area command? (Documented `worldview.js:149` but never called in stock UI.) If yes, Tier A carries reclaim/repair/attack/unload directly.
2. Does `getArmyUnits` return enemy/neutral armies (subject to fog), and are **wrecks** reachable via it or only `raycast`?
3. Does single-target `sendOrder` via `location.entity` work, and does `getArmyUnits`' id space match `entity`/`model.selection()` ids?
4. `group:true` distribution semantics vs per-unit issue.
5. `unload` with radius — native spiral or random scatter? (If random, port the golden-ratio spiral.)
6. Does `attack` accept area/ground, or must we use `attack_ground` for empty-ground area-attack?

---

# M6 — Formations (design sketch)

**Approach.** Replace `live_game.js`'s RMB-drag holodeck branch with a freehand polyline builder. The reusable, engine-agnostic BAR core (`cmd_customformations2.lua`) ports **verbatim**: arc-length even-resample (`GetInterpNodes`), optimal **Hungarian** assignment (`findHungarian`, N ≤ budget), and the NoX line-crossing-swap fallback for large N. PA's native straight-line spreader (`allowCustomFormations` + `holodeck.unitBeginGo(...,allow_custom)`) does *not* provide freehand-arc + optimal assignment — that is the port's value.

**Gesture + flow.**
1. **Capture:** RMB-down over holodeck → `input.capture(holodeck.div, fn)` (stock pattern, `live_game.js:3313-3401`); `scaleMouseEvent` each event. On each `mousemove`, `holodeck.raycastTerrain(offsetX, offsetY)` → append `{pos, planet}` + cumulative arc-length (BAR `AddFNode`/`fDists`).
2. **Release:** if arc-length < threshold → single point order. Else resample to N points (N = movable unit count) → assign units→points (Hungarian/NoX) → emit **one `sendOrder({units:[uid], command:'move', location:{planet,pos}, queue})` per unit, omitting `group`** (group:true is exactly the native spreader we're replacing).
3. **Single-unit freehand path:** stream queued `sendOrder` moves along the drag at min-spacing (BAR L526-552).
4. **Modifiers:** `shift` → `queue:true` (+ assign from each unit's last queued position).

**PA verbs.** `worldview.sendOrder` (per-unit move, `worldview.js:140-186`); `holodeck.raycast`/`raycastTerrain` (batched screen→world, `holodeck.js:246-304`); `input.capture`/`release` (RMB-drag); `model.selection()`/`handlers.selection.spec_ids` + `worldview.getUnitState` (unit ids + positions, filter to mobile).

**Portability.**
- ✅ Per-unit exact-position move orders feasible (omit `group`).
- ✅ Screen→world pick batched (raycast takes an array of points).
- ⛔ **Front-of-queue insert** (BAR `meta`/`CMD_INSERT`) — no `sendOrder` equivalent; `queue` appends only. Drop that modifier.
- ⚠️ **No batched order-array** in JS (BAR has `GiveOrderArrayToUnitArray`); N `engine.call`s on release. Fine for a one-shot; scaling note for very large selections.
- ⚠️ **Curved-planet coords:** linear interpolation of raw world points chords *under* the surface on big planets. Preferred fix: **interpolate node positions in screen space, then batch-`raycastTerrain`** to get true on-surface positions; run assignment on projected/great-circle distances.
- ⚠️ APIs are stock-UI internals (not a stability-guaranteed mod API) but are exactly what shipped `live_game.js` uses.

**Top unknowns.**
1. Does per-unit `sendOrder` (group omitted) place each unit at its exact `pos`, or does the server still snap/cluster?
2. Any insert/front-of-queue path, or is `queue` append-only? (BAR `meta` parity.)
3. Curved-surface node derivation: interpolate-in-screen+raycast vs interpolate-in-world — measure drift on a real planet.
4. Latency/throughput: one async raycast per `mousemove` for live polyline + N `sendOrder` round-trips on release — acceptable at scale?
5. In-world line/dot rendering: `worldview.puppet`/decals vs camera-projected DOM/canvas overlay (defer to phase 2; native drag already draws a line).
6. Robustly reading live movable unit ids + positions (`spec_ids` + `getUnitState`) and filtering by mobility.