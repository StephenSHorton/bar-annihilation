# Beyond All Reason — Complete Control Scheme Catalog

Beyond All Reason (BAR) runs on the **Recoil** engine (a fork of Spring/Spring-RTS). Its unit-control scheme is built from two distinct layers, and understanding the split is essential before porting any of it:

- **Engine commands** — Native Spring/Recoil orders, each with a numeric `CMD_*` id (e.g. `CMD_MOVE = 10`). They are *synced* (run identically on every client), live in every unit's command queue, carry a uniform **options bitfield** (Shift=queue, Alt, Ctrl, Right, Meta), and are issued through `Spring.GiveOrder`. They are bound to keys as **engine actions** (`move`, `attack`, `select …`, `group set`, `buildfacing inc`, `viewspring`, etc.). Reimplementing these means reimplementing the order/queue model itself.
- **Widgets** — Client-side **Lua** scripts (`luaui/Widgets/*.lua`) layered on top of the engine. They register their own **actions** (`gridmenu_key`, `selectbox_idle`, `commandinsert`, `add_to_autogroup`, `blueprint_place`, `attack_range_inc`, …) via the widget action registry, can be toggled or replaced by the player, and usually orchestrate engine commands under the hood (often `CMD_INSERT`/`CMD_REMOVE`/area-radius drags). Most of BAR's "feel" (grid build menu, custom formations, smart select, range rings, command FX) is widget code.
- **Hybrid** — A widget that intercepts/extends an engine command (e.g. SmartSelect over the engine box-select, CustomFormations over `CMD_MOVE`, Set Target as a custom gadget command).

The **engine command vs widget** distinction maps directly to portability: engine commands are discrete orders you can reissue through any RTS API, while widget behaviors need world-space drag input, custom UI overlays, or engine hooks that the target engine may or may not expose. The final section triages every feature on exactly that axis for a **PA: TITANS** client mod.

Two default keybind layouts ship: **GRID** (current default; frees the QWER rows for the positional build menu) and **LEGACY** (classic per-letter binds). Binds below give GRID first, with LEGACY noted where it differs. Scancodes (`sc_*`) make binds keyboard-layout-agnostic.

---

## 1. Selection & Control Groups

| Feature | What it does | Default bind / gesture | Engine or Widget |
|---|---|---|---|
| Single-unit select | Left-click a unit makes it the sole selection; left-click empty ground clears the selection | LMB on unit / LMB empty ground = deselect all | Engine — `CSelectedUnitsHandler::HandleSingleUnitClickSelection` |
| Box / drag select | Drag a rectangle to select friendly units inside; drag must exceed `dragSelectionThreshold` to count as a box vs a click | LMB drag | Hybrid — engine `HandleUnitBoxSelection` + `unit_smart_select.lua` |
| Additive selection | Hold Shift while clicking or box-dragging to ADD to the current selection | Shift + click / Shift + box-drag | Hybrid — engine + SmartSelect `mods.append` |
| Subtractive / toggle selection | Hold Ctrl to REMOVE units from the selection (click toggles; box removes already-selected inside) | Ctrl + click / Ctrl + box-drag | Hybrid — engine `RemoveUnit` + SmartSelect `mods.deselect` |
| Double-click select-of-type | Selects every visible friendly unit of that exact unitDef; Ctrl ignores on-screen test (whole map); Shift appends | Double-click unit (Ctrl=map-wide, Shift=append) | Engine — `HandleSingleUnitClickSelection selectType=true` |
| Double-click a grouped unit | If the double-clicked unit is in a control group, selects the whole group instead of same-type units | Double-click a grouped unit | Engine (group membership overrides same-type path) |
| `select` command grammar | The core programmable selection primitive: `select SOURCE+FILTER+CONCLUSION+` (AllMap/Visible/PrevSelection/FromMouse; Builder/Idle/Aircraft/Waiting/RelativeHealth_N/InHotkeyGroup/…; SelectAll/SelectOne/SelectPart_P). Every "select X" bind is built from this | `bind <key> select …` | Engine — `select` action / `SelectionKeyHandler` |
| Select all units (map) | Selects every unit/building you own across the whole map | Ctrl+E (GRID) / Ctrl+A (LEGACY) | Engine — `select AllMap++_ClearSelection_SelectAll+` |
| Select all matching units (map) | Selects all units map-wide whose type matches the current selection | Ctrl+W (GRID) / Ctrl+Z (LEGACY) | Engine — `select AllMap+_InPrevSel+…` |
| Select matching in view | Selects on-screen units of the current selection's type (keyboard form of double-click-of-type) | Q (GRID) / double-click (LEGACY) | Engine — `select Visible+_InPrevSel+…` |
| Select matching, exclude grouped | Same-type units map-wide, skipping anything already in a control group (ADDS to selection) | Ctrl+X (LEGACY) | Engine — `select AllMap+_InPrevSel_Not_InHotkeyGroup+_SelectAll+` |
| Select matching, exclude builders/comm & grouped | Same-type units excluding constructors, commander, and grouped units | Ctrl+V (LEGACY) | Engine — `select AllMap+_Not_Builder_InPrevSel_Not_InHotkeyGroup+…` |
| Select armed non-aircraft | Selects every weaponed, non-air unit map-wide (your ground/sea combat force) | Ctrl+W (LEGACY) | Engine — `select AllMap+_Not_Aircraft_Weapons+…` |
| Select idle builder (cycle) | Selects one idle builder and centers on it; repeat cycles through all idle builders | Ctrl+Tab (GRID) / Ctrl+B (LEGACY) | Engine — `select AllMap+_Builder_Idle+…_SelectOne+` (UI: `gui_idle_builders.lua`) |
| Select idle transports | Selects all idle transports map-wide | Ctrl+R (GRID; unbound LEGACY) | Engine — `select AllMap+_Transport_Idle+…` |
| Select waiting units | Selects all on-screen units currently under a Wait order (for staged-attack management) | Ctrl+Y (GRID) | Engine — `select Visible+_Waiting+…` |
| Select damaged units (<60% HP) | Keeps only the wounded, non-building units in the selection for retreat micro | Alt+Q (GRID) | Engine — `select PrevSelection+_Not_Building_Not_RelativeHealth_60+…` |
| Split army (50%) | Reduces the selection to ~50% of its units to split a blob into two groups | Ctrl+Q (GRID) | Engine — `select PrevSelection++_ClearSelection_SelectPart_50+` |
| Select commander | Selects (focus) or appends the commander | Tab focus / Shift+Tab append (GRID); Ctrl+C (LEGACY) | Hybrid — `selectcomm` (`cmd_comselect.lua`); engine fallback `_ManualFireUnit_` |
| Select control group | Press a number to select that group (without centering camera) | 0–9 | Engine — `group select <n>` |
| Double-tap group → center | Tapping the group number twice selects AND pans/snaps the camera to its center | `<n>,<n>` | Engine — `group focus <n>` (`GroupHandler`) |
| Set / create control group | Assigns the selection to a numbered group, clearing the group first | Ctrl+0 … Ctrl+9 | Engine — `group set <n>` / `CMD_GROUPSELECT` |
| Add selection to control group | Adds current selection to an existing group without clearing it | Ctrl+Shift+0 … Ctrl+Shift+9 | Engine — `group add <n>` / `CMD_GROUPADD` |
| Add group members to selection | Adds group N's units to the current selection without switching to group N | Shift+0 … Shift+9 | Engine — `group selectadd <n>` |
| Toggle group members in selection | Toggles each member of group N in/out of the current selection | Ctrl+Alt+0 … Ctrl+Alt+9 | Engine — `group selecttoggle <n>` |
| Remove from control group | De-assigns the selected units from whatever group they were in | Ctrl+` | Engine — `group unset` / `CMD_GROUPCLEAR` |
| `group` subcommand vocabulary | Full control-group verb set: select/set/add/selectadd/selectclear/selecttoggle/focus/unset + modifier-aware bare `group <n>` | `bind <key> group <sub> <n>` | Engine — `group` action |
| Auto-group on build | Tags a unit TYPE so every newly built unit of that type auto-joins control group N | Alt+0 … Alt+9 | Widget — `unit_auto_group.lua` (`add_to_autogroup`) |
| Remove from auto-group | Stops new units of the selected type from auto-joining | Alt+` | Widget — `remove_from_autogroup` |
| Load auto-group preset | Swaps between saved unit-type→group layouts | Shift+Alt+0 … Shift+Alt+9 | Widget — `load_autogroup_preset <n>` |
| Unit Groups panel | On-screen stacked group icons: click=select, Shift=add, Ctrl=remove, RMB=select+center | Click group icon (+ modifiers) | Widget — `gui_unitgroups.lua` |
| Minimap selection | Click/box/double-click on the minimap selects units (honors Shift/Ctrl) | LMB / LMB-drag / double-click on minimap | Engine — `CMiniMap::SelectUnits` |
| Cycle matching units (SelectOne) | Any `_SelectOne` select centers on one match; repeating the key advances through the set | Repeat the bound key | Engine — `SelectionKeyHandler` |
| PrevSelection / refine selection | Selection commands can source from or filter by the prior selection (`PrevSelection`/`InPrevSel`); practical "restore/refine" equivalent | Inside select strings (damaged, split) | Engine — `select` grammar |
| SelectUnits chat command | Low-level explicit selection by unit id/keyword: clear, +id, -id | `/selectunits clear | +id | -id` | Engine — `CSelectedUnitsHandler::SelectUnits` (Lua: `Spring.SelectUnitArray`) |
| Factory presets (number-key) | Save/recall factory build-order presets on the number keys (shares the 0–9 keyspace) | Meta+0-9 load / Meta+Alt+0-9 save / Space show | Widget — `factory_preset` |
| PiP selection tracking | A secondary PiP viewport can track the current selection and swap cameras | Alt+T track / Space+Tab swap | Widget — PiP via `WG.SmartSelect_SelectUnits` |
| Spectator team-select on numbers | While spectating, 1–9 jump to a player's team instead of acting as control groups | 1–9 (spectator) | Engine — `specteam <n>` |

---

## 2. Command Queue & Order Editing

| Feature | What it does | Default bind / gesture | Engine or Widget |
|---|---|---|---|
| Queue / append command (Shift) | Holding Shift while issuing ANY command appends it to the queue instead of replacing; the foundational queueing mechanic | Shift + issue command | Engine — option `OPT_SHIFT` (=32) on the command |
| Issue without Shift = clear + execute now | A command with no modifier wipes the queue and starts immediately; simplest way to clear a queue | Issue command, no modifier | Engine (replace behavior) |
| Command queue visualization | Engine draws queued command lines, build-ghost outlines and per-command icons for the selected units' whole queue | Automatic on selection | Hybrid — engine render (`cmdcolors.txt`) + `gui_ordermenu.lua` |
| `CMD_INSERT` primitive | Inserts a command at a queue position rather than appending: params = pos, cmd id, opts, params…; ALT=position-mode, CTRL=factory queue | Lua only | Engine — `CMD_INSERT` (id 1) |
| Command Insert / Add in Front | Hold Space + issue a command to insert it at the FRONT (pos 0); unit does it now, then resumes its old queue | Any+Space + issue command | Widget — `cmd_commandinsert.lua` → `CMD_INSERT {0,…}{"alt"}` |
| Command Insert "between" | Space+Shift splices the new command at the cheapest insertion point (minimizes detour walking) | Space + Shift + issue command | Widget — `cmd_commandinsert.lua` `prepend_between` |
| Command Insert "prepend_queue" mode | Optional FIFO front-insert: each Space+Shift order stacks at an incrementing front position (off by default) | Space + Shift (opt-in bind) | Widget — `cmd_commandinsert.lua` `prepend_queue` |
| `CMD_REMOVE` primitive | Removes queued commands by unique tag (or by command id with ALT); CTRL targets factory queue | Lua only | Engine — `CMD_REMOVE` (id 2) |
| Skip current / Queue to Next | Pops the front command so the unit jumps to its next order | N | Hybrid — `command_skip_current` → `CMD_REMOVE` first tag |
| Cancel last command | Pops the back command (undo the most recently appended order) | Ctrl+N | Hybrid — `command_cancel_last` → `CMD_REMOVE` last tag |
| Remove queued waypoint | Shift + right-click a queued command marker deletes just that order | Shift + RMB on marker | Engine — GuiHandler order-cancel |
| Remove queued build | Shift + place the same blueprint over a queued building removes that build order | Shift + LMB same blueprint on footprint | Engine — duplicate-build detection |
| Stop (clear all orders) | Clears the entire command queue and halts the selected units | S (LEGACY) / G (GRID), Shift+ variant | Engine — `CMD_STOP` (id 0) |
| Wait | Pauses units (or a queue point) without clearing orders; toggling on a waiting unit lifts it | W (LEGACY) / Y (GRID) | Engine — `CMD_WAIT` (id 5) |
| Wait queued (barrier) | Inserts a Wait into the queue at a chosen point for staged execution | Shift+W (LEGACY) / Shift+Y (GRID) | Engine — `CMD_WAIT` (queued) |
| Gather Wait | Holds units until the whole group has gathered, then releases together | P / Shift+P (GRID) | Engine — `CMD_GATHERWAIT` (id 9) |
| Time Wait | Pauses the queue for a set number of seconds | No default bind | Engine — `CMD_TIMEWAIT` (id 6) |
| Death Wait | Holds the queue until a designated target/area is dead | No default bind | Engine — `CMD_DEATHWAIT` (id 7) |
| Squad Wait | Holds produced units until N have accumulated, then releases the squad | No default bind | Engine — `CMD_SQUADWAIT` (id 8, a.k.a. square-wait) |
| Smart / context right-click (default command) | Right-click auto-picks Move/Attack/Reclaim/Repair/Guard/build based on what's under the cursor; Shift queues it | RMB (Shift to queue) | Engine — default-command resolution |
| Command options model | The per-order options bitfield driving all queue edits: META=4, INTERNAL=8, RIGHT=16, SHIFT=32, CTRL=64, ALT=128 | Internal | Engine — command options contract |
| Reading the queue | Lua reads each command's id/params/options/unique **tag** via `Spring.GetUnitCommands` (factory: `GetFactoryCommands`); tags are what INSERT/REMOVE target | Lua API | Engine — queue tag model |
| Queue handoff (no native drag-reorder) | BAR has NO drag-to-reorder; practical handoff = Build Split (across your cons) or gifting units (carries their queues). Reorder = remove + re-insert | Build Split / gift units | Hybrid (open feature request #4362) |
| Queue hygiene: no-duplicate / clean builder queue | Prevents stacking an identical order twice; strips invalid/duplicate build orders from a con's queue | Automatic | Widget — `cmd_no_duplicate_orders.lua`, `unit_clean_builder_queue.lua` |
| Remove Guard / remove queued state-toggle | Utility actions to strip a Guard or a queued state-change off the command list | Bindable actions | Widget — `cmd_guard_remove.lua`, `cmd_state_remove.lua` |

---

## 3. Movement & Formations

| Feature | What it does | Default bind / gesture | Engine or Widget |
|---|---|---|---|
| Move (basic) | Travel to a waypoint; on a selected factory it sets the build rally point. Move lines render green | RMB (default cmd) / M to arm; Shift queues | Engine — `CMD_MOVE` (id 10) |
| Move Line Drag / Custom Formations | Right-drag draws a line; selected units distribute evenly along it (Hungarian-optimal assignment). Single unit + Shift = multi-waypoint path. Min drag ~20 elmos | RMB drag | Hybrid — `cmd_customformations2.lua` over `CMD_MOVE` |
| Fight Line Drag | Same right-drag distribution but with Fight, so units attack-move spread along the line | F, then RMB drag | Hybrid — CF2 over `CMD_FIGHT` |
| Fight / Attack-Move | Move toward a point but stop and engage enemies in range; cons repair/assist along the path. Fight lines render purple. Alt+Fight = rez units resurrect along path | F (both), LMB point / LMB-drag area / RMB-drag line | Engine — `CMD_FIGHT` (id 16) |
| Patrol | Repeatedly walk a route (Fight-mode); cons/rez assist, repair and reclaim along it | H (GRID) / P (LEGACY) | Engine — `CMD_PATROL` (id 15) |
| Patrol loop (multi-waypoint) | Chain several patrol waypoints into a closed loop the units cycle forever | Shift + Patrol-click each waypoint | Engine — queued `CMD_PATROL` (auto-loops) |
| Guard / Assist | Persistently follow and help a unit/building: combat units fight for it, cons repair/assist its construction | O (GRID) / G (LEGACY) / RMB own/ally unit | Engine — `CMD_GUARD` (id 25) |
| Attack | Order weaponed units to attack a unit or ground; overrides Hold/Return Fire. Attack lines render red | A then LMB / RMB enemy; Shift queues; RMB-drag = attack line | Engine — `CMD_ATTACK` (id 20) |
| Attack a ground position (force-fire) | Attack on empty ground fires at that spot (into fog, radar dots, area saturation), independent of fire-state | A + LMB ground (point) / A + RMB-drag line / A + LMB-drag circle | Engine — `CMD_ATTACK` ground variant |
| Area Attack | Define a circle in which units spread their fire (artillery/bombers) | Alt+A, drag circle | Engine — `CMD_AREA_ATTACK` (id 21) |
| Move and assume formation | Units move and arrange into an engine box/front formation on arrival (higher-HP units front, weak back); travel at own top speed | Alt + RMB | Hybrid — engine box formation + BAR HP-sort (CF2 self-disables on Alt) |
| Move in formation (locked) | Keep relative positions while moving; whole group caps to the slowest unit's speed to stay together | Ctrl + RMB | Engine — Ctrl move modifier |
| Formation facing / orientation | Drag direction sets the formation's facing (line draw-order; box front). No post-placement drag-to-rotate in BAR | Implicit in drag vector | Hybrid — engine box + CF2 |
| Reverse move | Reverse-gear units back up keeping their front to the threat (flag move with Ctrl). Ships disabled by default in BAR | Ctrl + Move (reverse-capable units) | Widget — `unit_reverse_move.lua` (`enabled=false` in repo) |
| Factory rally / waypoint | Sets where produced units go; Shift chains a multi-step rally; can be Fight/Patrol rally. Move-state set on the factory becomes produced-unit default | Select factory, RMB; Shift to chain | Engine — FactoryCAI new-unit queue |
| Waypoint Dragger | Grab and reposition an already-queued waypoint live; Ctrl grabs nearby waypoints, Alt copies instead of moves | Shift + LMB-drag on a waypoint node | Widget — `unit_waypoint_dragger_2.lua` (INSERT+REMOVE) |
| Attack-no-ally guard | Prevents the Attack command from targeting allied units (no accidental friendly force-attack) | Automatic | Widget — `cmd_attack_no_ally.lua` |
| Exclude walls from Area Attack | Area-attack skips walls/dragon's teeth so units don't waste fire on fortifications | Automatic | Widget — `cmd_exclude_walls_area_attacks.lua` |
| Bomber attack-building → ground | Converts "Attack a building" into attack-ground at its position so the straight bomb run actually lands | Automatic with bombers | Widget — `cmd_bomber_attack_building_ground.lua` |
| Retreat — NOT in core BAR | No auto-retreat / retreat-zone command, gadget, widget or bind exists in the main repo; done with manual Move/stance/kite micro | None (custom addition only) | Absent (flag for porting) |

---

## 4. Construction, Build Placement & Area Commands

| Feature | What it does | Default bind / gesture | Engine or Widget |
|---|---|---|---|
| Place single building | After choosing a building, place one build order at the cursor | LMB | Engine — build command (negative `-unitDefID`) |
| Build facing / rotate | Rotate the building's facing in 90° steps (factory exit, turret) | `[` inc / `]` dec | Engine — `buildfacing inc/dec` |
| Build spacing | Adjust the gap between buildings in line/grid drags; thumb buttons also adjust with no modifier | Alt+Z inc / Alt+X dec; Mouse4/Mouse5 | Hybrid — engine `buildspacing inc/dec` + `gui_buildspacing.lua` |
| Line Build | Drag to queue a straight row of the same building, evenly spaced | Shift + LMB-drag (blueprint active) | Engine — build-line placement |
| Build Grid | Drag to queue a filled 2D field of the same building (windfarm/solars) | Shift+Alt + LMB-drag | Engine — build-grid placement |
| Build Border / Wall | Drag to place a hollow rectangle (perimeter) of buildings in one gesture | Ctrl+Alt+Shift + LMB-drag | Engine — build-border placement |
| Build Split | Splits a dragged build line/grid across all selected constructors so they build it in parallel | Shift+Space drag (line) / Shift+Alt+Space drag (grid) | Widget — `cmd_buildsplit.lua` |
| Split Reclaim | Splits an area-reclaim order across many cons so each takes different wrecks | E then Alt+Space + LMB-drag area | Hybrid — split logic over `CMD_RECLAIM` |
| Blueprint | Save a group of buildings as a reusable template and stamp it elsewhere; create/place/delete/cycle | Alt+C create / Alt+B place / Alt+D delete / Alt+[ , Alt+] cycle | Widget — `cmd_blueprint.lua` / `api_blueprint.lua` |
| Easy Facing | Set a building's facing by dragging the mouse during placement (alt to bracket keys) | LMB-drag (rotate) / RMB-drag while queue-placing | Widget — `gui_easyFacing.lua` |
| Reclaim (single) | Reclaim metal/energy from wrecks, trees, rocks, or live units/buildings; live units give full metal at 0% with no death explosion | RMB reclaimable; E then click; Shift queues | Engine — `CMD_RECLAIM` (id 90) |
| Area Reclaim | Drag a circle to reclaim all features of the hovered type inside the radius | RMB-drag circle (or E then drag) | Engine — `CMD_RECLAIM` with radius |
| Area Reclaim — unit-type filter | Reclaim only one specific unit-type within the circle (e.g. all your T1 solars) | Alt + area-reclaim while hovering the type | Hybrid — Alt filter |
| Smart Area Reclaim / Reclaim Enemy | Smarter area reclaim, incl. an option to target enemy units/wrecks specifically | Area-reclaim drag (widget logic) | Widget — `unit_smart_area_reclaim.lua`, `unit_area_reclaim_enemy.lua` |
| Repair (single / assist) | Restore HP (no cost); the same command assists construction of an unfinished unit/building | RMB damaged/incomplete; R then click | Engine — `CMD_REPAIR` (id 40) |
| Area Repair | Drag a circle; every damaged unit inside is repaired in turn | RMB-drag circle (or R then drag) | Engine — `CMD_REPAIR` with radius |
| Persistent Area Repair | Keep the repair area live after everything is healed (front-line repair bubble) | Alt while dragging repair circle / Repeat ON | Hybrid — Alt persist |
| Resurrect (single) | Rez-bots revive a unit from its wreck (100% metal, 50% energy discount), then auto-repair it | W (GRID) / Ctrl+R (LEGACY) / RMB wreck | Engine — `CMD_RESURRECT` (id 125) |
| Area Resurrect | Revive every resurrectable wreck in a dragged circle, most-efficient order | W then RMB-drag circle | Engine — `CMD_RESURRECT` with radius |
| Capture (single) | Capture an enemy unit and convert it to your team | W (GRID) / Capture button + click | Engine — `CMD_CAPTURE` (id 130) |
| Area Capture | Capture all eligible enemy units within a dragged radius | Capture + RMB-drag circle | Engine — `CMD_CAPTURE` with radius |
| Alt-invert reclaim↔resurrect | Alt on Patrol/Fight/Area orders to rez-bots makes them resurrect intact wrecks first, still reclaiming unrezzable heaps | Hold Alt before issuing | Hybrid — Alt priority flip |
| Restore / Terraform-Restore (area) | Restore terrain inside a dragged circle toward original height | M (GRID; Shift+M queue), then drag | Engine — `CMD_RESTORE` terraform |
| Area Mex (Upgrade Mex Area) | True "build all metal spots": drag a circle to build extractors on unclaimed spots and upgrade T1→T2 within the radius | Double-select any mex in build menu, LMB-drag; or `areamex` (Z / Ctrl+Alt+Z legacy) | Widget/gadget — `cmd_area_mex.lua` |
| Upgrade T1 mex / geo → T2 (single) | Right-click a T1 extractor/geo with a T2 con to upgrade it in place (reclaim+rebuild, placed adjacent) | T2 con, RMB the T1 extractor | Hybrid — mex-upgrade gadget over build command |
| Context / Quick Build Extractor / snap | Cursor-aware build helpers: build the right thing under cursor, quick-place a mex, snap placement to metal spots | Context-sensitive | Widget — `cmd_context_build.lua`, `cmd_quick_build_extractor.lua`, `cmd_extractor_snap.lua` |
| Area command mechanic | Generic radius-drag that applies a command to everything of a type in the circle (attack/reclaim/repair/resurrect/capture/unload/mex) | RMB-drag circle with a command active | Engine — area-command radius |
| Area Command Filter | Centering an area command on a unit/feature + modifier filters WHAT is targeted: Alt=exact same unitDefID, Ctrl=all, Meta=front-of-queue, Meta+Shift=split across cons | Alt/Ctrl/Meta with area command | Widget — `cmd_area_commands_filter.lua` |
| Factory build count modifiers | Click a build icon to add to the factory queue; modifiers batch the count | Click +1 / Shift +5 / Ctrl +20 / Ctrl+Shift +100; RMB removes | Hybrid — engine factory queue + grid menu multipliers |
| Factory Add in Front | Insert a unit at the FRONT of the factory's production queue (built next) | Alt + build-icon / Alt + grid letter | Engine — factory queue front-insert |
| Factory Guard (auto-assist) | Toggle so every con the factory produces auto-guards/assists it | Ctrl+G (tap on / double-tap off) | Widget — `factoryguard` |
| Factory Stop Production | Cancel/stop the factory's in-progress unit (separate from full Stop) | G (GRID, layered) / Ctrl+S (LEGACY) | Hybrid — `cmd_factory_stop_production.lua` (`stopproduction`) |
| Factory queue manager / quota / presets | Quota mode (maintain N units in the field), repeat-queue management, saveable presets | Alt+G (`factoryqueuemode`); presets Meta+0-9 / Meta+Alt+0-9 | Widget — `cmd_factoryqmanager.lua`, `unit_factory_quota.lua` |
| Factory queue mode toggle | Toggle whether orders to a factory go to its build queue vs to the units it produces (rally inheritance) | Alt+G (`factoryqueuemode`) | Engine — factory order routing |
| Construction Priority (High / Low — "passive") | Per-builder resource priority: High funded before Low when tight; set nanos/labs to Low so they only draw spare resources and never stall eco | "Priority" command-card button (bindable) | Hybrid — `CMD_PRIORITY` + `unit_builder_priority.lua` |
| Idle Constructor Guard After Build | A con that finishes assisting a factory with an empty queue auto-Guards it (keeps assisting) | Automatic | Widget — `unit_idle_guard.lua` |
| Auto-repair for idle builders | Idle mobile builders auto-repair nearby damaged units without an order | Automatic | Widget — `unit_auto_repair_idle_builders.lua` |
| Nano-turret assist priority | Stationary nano turrets pick their assist target by priority instead of splitting indiscriminately | Automatic | Widget — `cmd_nanoturrets_assist_priority.lua` |

---

## 5. Unit States, Stances & Special Abilities

| Feature | What it does | Default bind / gesture | Engine or Widget |
|---|---|---|---|
| Fire State / Stance | Per-unit weapon engagement: Hold Fire (0) / Return Fire (1) / Fire at Will (2). An explicit Attack overrides Hold/Return. New combat units default Fire at Will | L multi-tap (GRID: 1=FaW,2=Hold,3=Return; Shift+L queued); command-card icon (LEGACY) | Engine — `CMD_FIRE_STATE` (id 45) |
| Move State / Positioning | Per-unit movement aggression: Hold Position (0) / Maneuver (1) / Roam (2); governs how far a unit wanders to engage. Inherited from the building factory | `;` multi-tap (GRID; Shift+; queued); command-card icon (LEGACY) | Engine — `CMD_MOVE_STATE` (id 50) |
| Repeat (loop queue) | Re-appends completed orders to the back so the unit loops forever; on a factory, loops the whole build queue | T (GRID; tap on, double-tap off); command-card icon (LEGACY) | Engine — `CMD_REPEAT` (id 115) |
| On / Off | Activate/deactivate a unit/structure (metal makers, jammers/radar, cloak fields, shields, drone hubs). Default state presettable | B (GRID, tap on/off) / X (LEGACY) | Engine — `CMD_ONOFF` (id 85) |
| Cloak toggle + wantcloak | Toggle personal cloak (invisible to enemies, subject to decloak radius/firing); `wantcloak` sets the desired auto-re-engaging state | K (both); Any+K = `wantcloak` | Hybrid — `CMD_CLOAK` (id 95) + auto-cloak widget |
| Trajectory (Low / High / Auto) | Ballistic-weapon firing arc: Low (0, flat) / High (1, lobbed over terrain) / Auto (2) | B multi-tap (GRID, `trajectory_toggle`); command-card icon (LEGACY) | Engine — `CMD_TRAJECTORY` (id 120) |
| Set Target (persistent priority) | Sticky preferred target a unit/turret keeps firing at whenever in range, even while moving; doesn't force it out of position | S = settarget / Alt+S = settargetnoground (GRID); Alt+Y / Y (LEGACY) | Hybrid — `CMD.UNIT_SET_TARGET` (`unit_target_on_the_move.lua`) |
| Cancel Target | Clears a Set Target assignment, returning to normal auto-acquisition | Ctrl+S (GRID) / J (LEGACY); command-card button | Hybrid — same gadget |
| Area Set-Target / type-filtered | Alt+drag a circle assigns a persistent priority target on all units in an area, or only the hovered unit-type | Alt + Set Target, drag circle | Widget — over `unit_target_on_the_move.lua` |
| Manual Fire / D-Gun / Manual Launch | Fire a special manual weapon once: Commander D-Gun (instant-kill, 500e/shot, immune to enemy comms); manual-launch for launch-type weapons. Ignores fire-state | D (both); Shift queues | Engine — `CMD_MANUALFIRE` (id 105, aka CMD_DGUN) |
| D-Gun friendly-fire / wasted-ground guards | Safety filters: D-Gun won't fire through/at allies, won't waste on empty ground | Automatic | Widget — `cmd_dgun_no_ally.lua`, `cmd_dgun_no_ground*.lua` |
| Stockpile | Queue how many missiles a launcher builds (nukes, anti-nukes, tactical/EMP). Anti-nukes auto-launch intercepts from the stockpile | Stockpile command-card button: LMB +1 / RMB −1 / Shift batch | Engine — `CMD_STOCKPILE` (id 100) |
| Self-Destruct | Countdown then explode (often bigger than death explosion), leaving NO wreck (denies reclaim). EMP pauses it; re-issue cancels. Queueable | Ctrl+B (GRID) / Ctrl+D (LEGACY); Ctrl+Shift+ = queued | Engine — `CMD_SELFD` (id 65) |
| Stop cancels Self-Destruct | A Stop order to a unit mid self-D aborts the countdown | Stop (S) during self-D | Widget — `cmd_stop_selfd.lua` |
| Load Units (transport) | Order a transport to pick up units: click one, or drag a circle to area-load all eligible in radius | J (GRID) / L (LEGACY); Shift queues | Engine — `CMD_LOAD_UNITS` (id 75); `CMD_LOAD_ONTO` (76) inverse |
| Unload Units (+ Area Unload) | Drop cargo at a point, or drag a circle to spread units over an area (golden-ratio spacing widget avoids clumping) | U (both); LMB point / RMB-drag circle | Hybrid — `CMD_UNLOAD_UNITS` (80) / `CMD_UNLOAD_UNIT` (81) + `cmd_area_unload.lua` |
| Load Own Moving | Air transports pick up your own units while those units are still moving (no need to stop the cargo) | Order transport to Load a moving friendly | Widget — `unit_load_own_moving.lua` |
| Ferry Routes / Supply Lines | Emergent shuttle: Load (area staging) + Unload (area landing) + Repeat, then park the transport near staging; it auto-ferries any units that gather | Built from Load+Unload+Repeat | Engine (documented pattern, no dedicated cmd) |
| Transport preserve commands | Units retain and resume their original queue after being dropped, instead of going idle | Automatic on unload | Widget — `cmd_transport_preserve_commands.lua` |
| Idle Mode / Fly-Land (aircraft) | Aircraft idle behavior: stay airborne vs land when idle; related auto-repair/retreat-level state | Command-card icon; Unit Start States preset | Engine — `CMD_IDLEMODE` (id 145); `CMD_AUTOREPAIRLEVEL` (135) |
| Fighter fly / only-fighters-patrol | Keep fighters airborne instead of landing; restrict a patrol so only fighter-type aircraft engage | Widget-managed default states | Widget — `unit_set_fighters_fly.lua`, `unit_only_fighters_patrol.lua` |
| Unit Start States widget | Preset DEFAULT states for every newly built unit/structure (fire/move state, repeat, cloak, on/off, fly-land, con behavior) | Settings menu | Widget — `gui_unit_start_states.lua` |
| Factory Hold Position widget | Auto-sets new land factories (and thus their units) to Hold Position so fresh armies don't wander off | Automatic (on by default) | Widget — `cmd_fac_holdposition.lua` |
| Auto Cloak widget | Re-applies cloak after a unit decloaks (firing/moving) so cloakers stay hidden without manual re-toggling | Automatic (on by default) | Widget — `unit_auto_cloak.lua` |

---

## 6. Control Widgets & Keybind System

| Feature | What it does | Default bind / gesture | Engine or Widget |
|---|---|---|---|
| Grid Menu (build UI) | BAR's signature positional build UI: a fixed 3×4 grid where each cell maps to a fixed physical key; category switch (Z/X/C/V = Eco/Combat/Utility/Production), Quick Build multi-press cycling, pagination, multi-builder cycle, Lab Build Mode | `gridmenu_key <row> <col>` on Z X C V / A S D F / Q W E R; `gridmenu_category` Z/X/C/V; next page B; cycle builder `.` | Widget — `gui_gridmenu.lua` (issues `-unitDefID`) |
| Legacy build hotkeys | Pre-grid scheme: Z/X/C/V bound to ordered lists of `buildunit_<name>` actions; engine picks the first valid for the selected builder | Z/X/C/V (+Shift), `[` `]` rotate | Widget config — `legacy_keys.txt` |
| Build Menu / Build Bar / Order Menu | The clickable command card + build palette mirroring the keyboard binds | Mouse click panels | Widget — `gui_buildmenu.lua`, `gui_ordermenu.lua`, `gui_buildbar.lua` |
| Smart Select | Box-select that filters live as you drag (mobile-priority; buildings excluded when mobiles present) with modifier sub-actions: idle-only, same-type, mobile-only, append, deselect, any/all | LMB drag; hold Space/Z/Alt/Shift/Ctrl = `selectbox_*` | Widget — `unit_smart_select.lua` |
| Loop Select | Cycles selection among matching units; can invert (units NOT in selection) or add | `selectloop` Space / `_invert` Ctrl / `_add` Shift | Widget — `unit_loop_select.lua` |
| Chain Actions | One keybind fires multiple chained actions/console commands in sequence (`chain [force] a | b`) | `bind <key> chain …` | Widget — `cmd_chainactions.lua` |
| Attack Range rings (GL4) | Weapon/attack range rings for selected units (ground/AA/build), per-type cycling of which weapon rings show | Alt+. inc / Alt+, dec; `cursor_range_toggle` (unbound) | Widget — `gui_attackrange_gl4.lua` |
| Defense Range rings (GL4) | Persistent range rings for defensive structures (enemy/ally) split by ground/AA/nuke | `defrange …` actions / WG API (no default key) | Widget — `gui_defenserange_gl4.lua` |
| Sensor range rings | Toggleable radar/sonar/LoS/jammer coverage rings + radar placement preview | Passive; `togglelos` (Any+' GRID / Any+L LEGACY) | Widget — `gui_sensor_ranges_*` family |
| Attack AoE / splash preview | Shows splash radius and projected scatter for the selected unit's weapon at the cursor (artillery aiming) | Passive while AoE unit selected + hover Attack | Widget — `gui_attack_aoe.lua`, `gui_projectile_target_aoe.lua` |
| Blast Radius preview | Death-explosion and self-destruct AoE rings (with damage label) to gauge chain-reaction/self-D bomb placement | Space while placing; Space+X with units selected | Widget — `gui_blast_radius.lua` |
| Reclaim Field Highlight / Info | Highlights reclaimable wreck/metal fields and surfaces total reclaim value to target reclaim commands | Always-on overlay (toggleable) | Widget — `gui_reclaim_field_highlight.lua`, `gui_reclaiminfo.lua` |
| Building grid / placement overlay | Validity overlay, snapping grid, build ETA, ghost of queued buildings, pre-game build queueing | Passive while build command held | Widget — `gui_building_grid_gl4.lua`, `gui_build_eta.lua`, `gui_pregame_build.lua` |
| Command/order visual feedback | The "feel" layer: animated command lines, queue dots, selection platters, cursor FX, and wait/repeat/idle/firestate icons | Passive | Widget — `gui_commands_fx.lua`, `gui_show_orders.lua`, `gui_team_platter.lua`, … |
| Map drawing / pings / labels | Draw lines, drop text labels, and ping allies on the map/minimap | `drawinmap` ` (Q legacy) hold+drag; double-tap = `drawlabel` | Engine — `drawinmap`/`drawlabel` + polish widgets |
| Keybind profile system | The whole bind scheme is composed from modular .txt files via engine console commands; players pick Grid/Legacy (+60% variants), keyloading shared files (`num_keys`, `chat_and_ui_keys`) | `unbindall`, `keyload <file>`, `bind`/`unbind` | Engine console + `luaui/configs/hotkeys/*.txt` |
| uikeys.txt user-override loader | Players drop a personal `uikeys.txt` to apply extra/overriding binds atop the chosen profile | Place `LuaUI/Widgets/uikeys.txt` | Widget — `cmd_uikeys_loader.lua` |
| In-game Keybind / Mouse Info panel | Tabbed reference listing active binds per scheme (standard/grid/legacy + modifier pages), reading live binds | Opened from menu | Widget — `gui_keybind_info.lua` |
| Bindable action list | The full bindable namespace: engine actions (move/attack/fight/select/group*/buildfacing/…) + widget actions (gridmenu_*, selectbox_*, commandinsert, blueprint_*, …), bound via `bind <key> <action>` | N/A | Hybrid — engine action table + widget action registry |
| Multi-tap state cycling | Keybind-config trick: pressing a state key 1/2/3 times picks the tri-state (e.g. L/LL/LLL = firestate 2/0/1) | GRID config | Widget config (over engine state commands) |
| Quick Share Unit to Target | Gifts the selected units to an ally by clicking any of that ally's units or nearby ground | `quicksharetotarget` then LMB ally unit/area | Widget — `cmd_share_unit.lua` (`Spring.ShareResources`) |
| Drag-share metal/energy + Share-to-gift | Click-drag the Share control to give an amount of metal/energy; double-click "Share" to gift the selected unit | UI control drag / double-click | Hybrid — engine sharing via BAR UI |
| /take | Transfers all units and resources of a dead/AFK/resigned teammate to you | `/take` in chat | Widget — `cmd_take_proxy.lua` (engine take mechanic) |
| Smart Cast — NOT a named widget | No "smart cast" module exists; BAR's press-key-then-click ability/command issuing is handled by the engine command system + grid menu | N/A | Absent (note for porting) |

---

## 7. Camera / View / Minimap Control *(adjacent — view control, not unit commands)*

These are **view controls**, included for completeness. Engine camera-mode integer ids: 0=fps, 1=ta/overhead, 2=spring (default), 3=rot-overhead, 4=free, 5=overview.

| Feature | What it does | Default bind / gesture | Engine or Widget |
|---|---|---|---|
| Camera: Spring | Default rotatable top-down cam (overhead + Total-War hybrid); edge/MMB pan, Alt rotate, wheel zoom-to-cursor | Ctrl+F6 (GRID) / Ctrl+F3 (LEGACY) | Engine — `viewspring` (mode 2) |
| Camera: Overhead / TA | Fixed non-rotatable classic TA top-down; pan only | Ctrl+F5 (GRID) / Ctrl+F2 (LEGACY) | Engine — `viewta` (mode 1) |
| Camera: FPS | First-person/ground-level engine controller | Ctrl+F1 (LEGACY; unbound GRID) | Engine — `viewfps` (mode 0) |
| Camera: Rotatable Overhead | Top-down cam that tilts/rotates differently from Spring cam (used by joystick widget) | Ctrl+F4 (LEGACY; unbound GRID) | Engine — `viewrot` (mode 3) |
| Camera: Free | Free-flight 6-DOF camera with velocity and zoom-to-ground | Ctrl+F5 (LEGACY; unbound GRID) | Engine — `viewfree` (mode 4) |
| Map Overview Switch | Toggle to a flat full-map overview cam; press again returns, scroll zooms to mouse | Ctrl+T (GRID) / Tab (LEGACY) | Engine — `toggleoverview` (mode 5) |
| Toggle Camera Mode cycle | Cycles sequentially through all camera controllers | Shift/Ctrl+Backspace (LEGACY) | Engine — `togglecammode` |
| Camera Flip | Flips the camera 180° N↔S to view your base from the opposite side | Alt+O (GRID) / Ctrl+Shift+O (LEGACY) | Hybrid — `cameraflip` (`camera_flip.lua`) |
| Camera pan (keyboard) | Scroll/pan the camera across the map | Arrow keys / Numpad 8-2-4-6 | Engine — `moveforward/back/left/right` |
| Camera raise / lower | Raise/lower camera height (keyboard zoom) | PageUp/PageDown / Numpad 9-3 | Engine — `moveup`/`movedown` |
| Camera move-fast | Speeds up keyboard panning while held | Hold Shift / Numpad 1 | Engine — `movefast` |
| Camera move-slow | Slows keyboard panning for precision | Hold Ctrl | Engine — `moveslow` |
| Camera move-reset | Fast camera reset (tilt/zoom) on mouse-wheel while held | Hold Alt + wheel | Engine — `movereset` |
| Camera rotate | Free-rotate the Spring cam on X/Y with MMB held + mouse move | Alt + MMB + move | Engine — `moverotate` |
| Camera tilt | Tilt camera pitch with the mouse wheel while held | Ctrl + wheel | Engine — `movetilt` |
| Mouse-wheel zoom | Scroll zooms toward the cursor/ground point (zoom-to-cursor) | Mouse wheel | Engine — camera zoom |
| Middle-click pan | Hold/toggle MMB and move to drag-scroll the map (cursor hidden) | MMB drag/hold | Engine — pan (opt. `camera_middle_mouse_alternate.lua`) |
| Screen-edge scroll | Mouse at a screen edge pans the camera (Spring-cam top band rotates) | Mouse to screen edge | Engine — `EdgeMoveWidth`/`EdgeMoveDynamic` |
| Field of View change | Increase/decrease/set camera FOV in degrees | Ctrl+O dec / Ctrl+P inc; `fov [n]` | Hybrid — `camera_fov_changer.lua` (disabled by default) |
| Increase / Decrease view radius | Adjust rendered ground/icon draw distance/detail | Home / End (LEGACY) | Engine — `increaseViewRadius`/`decreaseViewRadius` |
| Track selected units | Lock the camera to follow the current selection | T (LEGACY); custom bind (GRID) | Engine — `track` (`trackoff` disables) |
| Track mode cycle | Cycle how the camera follows tracked units | Ctrl+T (LEGACY); custom bind (GRID) | Engine — `trackmode` |
| Set camera anchor (1–4) | Save the current camera position/orientation into one of 4 slots | Ctrl+F1–F4 (GRID) | Widget — `set_camera_anchor` |
| Focus camera anchor (1–4) | Jump the camera to a saved anchor slot (smooth transition) | F1–F4 (GRID) | Widget — `focus_camera_anchor` |
| Camera goto coordinate | Target the camera to an absolute map X/Z position (scriptable) | `/goto x z` | Widget — `camera_goto.lua` |
| Center on current selection | Recenter the camera on whatever is selected (no group required) | Bindable "center & select" | Widget — `gui_center_n_select.lua` |
| Minimap left-click/drag move camera | Click/drag the minimap to recenter the world camera | LMB / LMB-drag on minimap | Widget — `gui_minimap.lua` (suppressed when a command cursor is held) |
| Issue commands via minimap | With a command active, click/drag the minimap to issue it at that world location | Command active + LMB/drag minimap | Hybrid — engine + `gui_minimap.lua` pass-through |
| Minimap drag-select | Drag a box on the minimap to select units in that region | LMB-drag box on minimap | Engine — minimap selection |
| Minimap minimize / maximize | Minimize or maximize the minimap; auto-hides in overview cam | UI button / config | Widget — `gui_minimap.lua` |
| Minimap rotation | Auto-flip/auto-rotate/auto-landscape or manual 90°/180° rotation to match camera | `minimap_rotate …` (bindable) | Widget — `minimap_rotation_manager.lua` |
| Picture-in-Picture minimap | Interactive R2T map view with pan/zoom/track/teleport — a second live camera window | Default UI element | Widget — `gui_pip.lua`, `gui_pip_minimap.lua` |
| PIP left-button pan | LMB pans the camera within the PIP when zoomed out and not tracking | LMB/drag on PIP | Widget — `gui_pip.lua` |
| PIP middle-click teleport | MMB a point in the PIP to teleport the world camera there (auto-zoom) | MMB (no drag) on PIP | Widget — `gui_pip.lua` |
| PIP wheel zoom (Alt-gated) | Wheel zooms the PIP toward the cursor; optional Alt-gate so plain scroll passes through | Wheel (Alt+wheel if configured) | Widget — `gui_pip.lua` |
| PIP Alt+drag | Alt+drag pans the PIP and cancels player-camera tracking | Alt + drag on PIP | Widget — `gui_pip.lua` |
| PIP copy camera | Copy the main camera position into a PIP slot | Meta+Ctrl+Tab (`pip1_copy`) | Widget — `gui_pip.lua` |
| PIP switch camera | Swap the world camera with the PIP viewport (jump between two viewpoints) | Meta+Tab (`pip1_switch`) | Widget — `gui_pip.lua` |
| PIP track selected | Make the PIP follow the current selection without moving the main camera | Alt+T (`pip1_track`) | Widget — `gui_pip.lua` |
| PIP/minimap focus modes | Auto-focus behaviors: pan to markers (activity), auto-follow action (TV), track a player, team-view/LoS limit | `pip0_activity/tv/trackplayer/view` (unbound) | Widget — `gui_pip.lua` |
| Lock camera to player | Spectator: lock your camera to another player's viewpoint (opt. hide enemies, sync LoS) | UI / `WG.lockcamera` | Widget — `camera_lockcamera.lua` |
| Player TV / Camera / View | Spectator modes: TV auto-director, lock to a player's camera, or show a player's viewpoint/LoS | `playertv`/`playercamera` (bindable) | Widget — `camera_player_tv.lua` |
| Camera Remember Mode | Restores your last camera mode/orientation at game start; forces Spring cam as the safe default | Automatic | Widget — `camera_remember_mode.lua` |
| Camera Joystick | Drives the rot-overhead cam with a physical joystick; record/playback camera sequences | Switch to Ctrl+F4 + joystick server | Widget — `camera_joystick.lua` (disabled by default) |
| Camera Shake | Screen-shake on large explosions/impacts (cosmetic) | Auto (toggle in settings) | Widget — `camera_shake.lua` |
| Startup Camera | Sets/animates the initial camera at match start (focus on start position) | Automatic at game start | Widget — `camera_startup.lua` |
| Show / Hide UI | Toggle all on-screen interface off/on (clean view for screenshots/streaming) | Ctrl+F7 (GRID) / F5 (LEGACY) | Engine — `HideInterface` |
| Fullscreen toggle | Toggle fullscreen/windowed | Alt+Enter / Alt+Backspace | Engine — `fullscreen` |
| Map view overlays | Toggle map-render modes: LoS colors, heightmap, metal map, path traversability, jump-to-last-message | `togglelos`; ShowElevation/Metal/Path F-keys | Engine — map draw-mode toggles |
| Camera config states | Persistent camera-feel toggles via Settings/config: cardinal-lock, scroll speed, edge-move band, minimap LMB-move, smoothness, invert-zoom | Settings menu / `springsettings.cfg` | Engine — `SpringSettings` |

---

## Porting notes for a PA: TITANS client mod

High-level triage of every catalog feature by likely portability. *(PA = Planetary Annihilation; the engine, command model, and Lua/coherent-UI surface differ from Spring/Recoil — these are directional groupings, not PA API claims.)*

**(a) Straightforward — issues a discrete order/state via the existing command API**
- Basic orders that map to a single command id: Move, Attack, Fight/attack-move, Patrol, Guard/Assist, Stop, Repeat, Wait, Reclaim, Repair, Capture, Load/Unload, Self-Destruct, Manual-fire/D-Gun-equivalent.
- Per-unit state toggles: Fire State, Move State, On/Off, Cloak, Trajectory, Set Target / Cancel Target, Idle fly-land — each is a discrete state set on a unit.
- Control groups (set/select/add/toggle/focus) and queue-append (Shift) — straightforward given an ordered per-unit queue.
- Skip-current / cancel-last and front-insert (CMD_INSERT/REMOVE-equivalents), provided the queue exposes per-command tags + position addressing.
- Selection helpers expressible as filtered queries: select-all, select-matching, select-idle-builder, select-damaged, split-50%, select-commander.
- "Default" auto-states (Unit Start States, Factory Hold Position, Auto Cloak, auto-group-on-build) — react to unit-created events and issue the above orders.
- Sharing / team actions (gift units, drag-share resources, /take) if an equivalent resource/unit transfer API exists.

**(b) Needs world-space drag/draw input (area commands, formations, line/area build)**
- Custom Formations: right-drag line distribution with optimal (Hungarian) unit→node assignment; Fight/Patrol/Attack/Unload line variants.
- Engine box/front formation (Alt-move), locked formation move (Ctrl-move), formation facing from drag vector.
- Area commands: drag-circle Reclaim / Repair / Resurrect / Capture / Area-Attack / Area-Unload / Area-Mex, plus the area-command-filter modifiers (same-type / all).
- Build placement gestures: Line Build, Build Grid, Build Border/Wall, Build Split, Split Reclaim, build spacing + facing during a drag, Easy-Facing drag-rotate, Blueprint stamping.
- Waypoint Dragger (grab and reposition queued nodes) and Shift+RMB remove-waypoint.
- Minimap command issuing / drag-select and PIP teleport/pan — world-space input routed through a secondary map view.

**(c) Needs custom UI overlay (grid menu, range rings, command card)**
- The Grid build menu (positional 3×4 keyed cells, categories, pagination, multi-builder cycle, Lab Build Mode) — the central piece of BAR's feel; pure UI + bind layer.
- Command card / order menu / build bar clickable parity with binds.
- Range/AoE overlays: attack-range rings, defense-range rings, sensor (radar/sonar/LoS/jammer) rings, projectile-splash AoE, blast-radius preview, reclaim-field highlight, build-placement grid/ETA/ghost.
- Command/order visual FX (queue lines, dots, platters, wait/repeat/idle icons) and the keybind-info reference panel.
- The keybind profile system itself (modular bind files, Grid/Legacy schemes, multi-tap state cycling, uikeys override loader, scancode/layout remap) — a configurable input layer over a command/action registry.

**(d) May not be portable / depends on PA engine support**
- Engine command-options bitfield semantics and per-command unique tags — only portable if PA's queue model exposes equivalent addressing; otherwise insert/remove/reorder fidelity is limited.
- The full `select SOURCE+FILTER+CONCLUSION` grammar with SelectOne camera-cycling and PrevSelection — needs an engine-level selection-query facility.
- Specialized Wait family (Time/Death/Squad/Gather/Square wait) and synchronized group-gather movement.
- Stockpile mechanic (per-missile build + auto-intercept launch) and the cloak/decloak-radius/jammer/radar state machine — depend on PA having the underlying unit subsystems.
- Transport ferry-route emergence, "load own moving", transport-preserve-commands — depend on PA transport mechanics.
- Reverse-gear move, terraform Restore, mex-spot upgrade-in-place — depend on PA movement/terrain/economy models (PA has no metal-spot/terraform analogue, so Area-Mex and Restore likely have no equivalent).
- Spectator camera lock / Player-TV broadcast, PiP R2T second viewport, camera joystick — depend on PA's camera/render and spectator infrastructure.
- **Already absent in BAR (build fresh, don't port):** auto-Retreat / retreat-zones and any "smart cast" module — neither exists in BAR, so there is nothing to port; both would be net-new for either client.
