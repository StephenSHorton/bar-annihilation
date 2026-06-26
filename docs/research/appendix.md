## Appendix — Cross-check additions (web pass)

_Features or details surfaced by the independent web/wiki pass that the source-grounded catalog did not already cover. The canonical catalog above remains source-of-truth; treat these as candidates to verify against the code._

### Genuinely additional features

| Feature | What it does | Default bind / gesture | Engine or Widget | Note |
|---|---|---|---|---|
| Defense range rings | Persistent range rings for defensive structures (own / ally / enemy), split by ground / AA / nuke | `defrange …` actions / WG API (no default key) | Widget — `gui_defenserange_gl4.lua` | Source catalogs attack-range and reclaim-field overlays but has no defense-range-ring widget. |
| Sensor range rings | Toggleable radar / sonar / LoS / jammer coverage rings, plus a radar-placement preview | passive; `togglelos` (Any+' grid / Any+L legacy) | Widget — `gui_sensor_ranges_*` family | Source's only `togglelos` use is the map LoS draw-mode; no per-unit sensor-coverage ring widget is catalogued. |
| Blast radius preview | Death-explosion and self-destruct AoE rings (with a damage label) to judge chain-reaction / self-D placement | Space while placing; Space+X with units selected | Widget — `gui_blast_radius.lua` | Source has self-D skull/countdown icons but no explosion-AoE preview overlay. |
| Reverse move | Reverse-gear-capable units back up while keeping their front to the threat | Ctrl + Move | Widget — `unit_reverse_move.lua` (disabled in repo) | Not present in source feature tables. |
| Locked formation move | Keep relative positions while moving; the whole group caps to the slowest unit's speed | Ctrl + RMB | Engine — Ctrl move modifier | Distinct from the Alt engine box-formation (which travels at own top speed) that source does cover. |
| Alt-invert reclaim ↔ resurrect | Alt on Fight / Patrol / area orders to rez-bots makes them resurrect intact wrecks first, still reclaiming unrezzable heaps | hold Alt before issuing the order | Hybrid — Alt priority flip over `CMD_RESURRECT`/`CMD_RECLAIM` | Source's resurrect and area-reclaim rows do not mention this priority-flip modifier. |
| Aircraft auto-repair level | Aircraft return to a pad to repair below a set health threshold (retreat-to-repair idle behavior) | command-card icon / Unit Start States preset | Engine — `CMD_AUTOREPAIRLEVEL` (135) | Source covers IDLEMODE / fly-land (cmd 145) but not the auto-repair-level state. |
| Factory rally / waypoint | RMB on a factory sets where produced units go; Shift chains a multi-step rally; can be a Fight/Patrol rally | select factory + RMB; Shift to chain | Engine — FactoryCAI new-unit queue | Source references "the factory's first MOVE rally" only in passing (transport-ferry widget); no rally-setting row exists. |
| Factory Add in Front | Insert a unit at the FRONT of a factory's production queue (built next) | Alt + build-icon / Alt + grid letter | Engine — factory queue front-insert | Source's CMD.INSERT/quota cover factory front-insert internally, but not this user-facing gesture. |
| Split Reclaim | Split an area-reclaim order across several constructors so each takes different wrecks | E, then Alt+Space + LMB-drag area | Hybrid — split logic over `CMD_RECLAIM` | Source documents Build Split for builds only; verify whether the same widget also splits reclaim. |
| Remove queued build (re-stamp) | Shift + placing the same blueprint over an already-queued building cancels that build order (engine duplicate-build detection) | Shift + LMB same blueprint on the footprint | Engine — duplicate-build detection | Source removes queued builds via RMB-on-queue or clean-builder-queue, not this re-stamp gesture. |
| Single-unit select / click-empty deselect | LMB on a unit makes it the sole selection; LMB on empty ground clears the selection | LMB on unit / LMB on empty ground | Engine — `HandleSingleUnitClickSelection` | Source's tables list box / smart / group selection but never the basic single-click select-or-deselect. |
| Double-click grouped unit → group | Double-clicking a unit that is in a control group selects the whole group instead of same-type units | double-click a grouped unit | Engine (group membership overrides the same-type path) | Source's double-click row only covers select-all-of-type. |
| In-game Keybind / Mouse Info panel | Tabbed reference listing the active binds per scheme (standard / grid / legacy + modifier pages), read from live binds | opened from menu | Widget — `gui_keybind_info.lua` | Source covers the profile/bind machinery but not this on-screen reference panel. |

### Enrichments to existing features

| Existing feature | Detail the web pass adds |
|---|---|
| Engine command catalogue (`CMD.*`) | Numeric engine ids for nearly every order, which source almost entirely omits: STOP 0, INSERT 1, REMOVE 2, WAIT 5, TIMEWAIT 6, DEATHWAIT 7, SQUADWAIT 8, GATHERWAIT 9, MOVE 10, PATROL 15, FIGHT 16, ATTACK 20, AREA_ATTACK 21, GUARD 25, REPAIR 40, FIRE_STATE 45, MOVE_STATE 50, SELFD 65, LOAD_UNITS 75, LOAD_ONTO 76, UNLOAD_UNITS 80, UNLOAD_UNIT 81, ONOFF 85, RECLAIM 90, CLOAK 95, STOCKPILE 100, MANUALFIRE/DGUN 105, REPEAT 115, TRAJECTORY 120, RESURRECT 125, CAPTURE 130, AUTOREPAIRLEVEL 135, IDLEMODE 145. (Source supplies only CLOAK=37382 and the custom share id 455624.) |
| `CMD.INSERT` / `CMD.REMOVE` primitives | INSERT ALT = position-mode, CTRL = factory queue; REMOVE addresses by unique tag, or by command-id with ALT, with CTRL targeting the factory queue. |
| Command options model | Per-order options bitfield values: META=4, INTERNAL=8, RIGHT=16, SHIFT=32, CTRL=64, ALT=128. Queue is read via `Spring.GetUnitCommands` / `GetFactoryCommands`; tags are what INSERT/REMOVE address. |
| `select` filtered-selection DSL | Web enumerates more default-bound presets + binds: select-matching-map-wide (Ctrl+W grid), -matching-in-view (Q grid), -idle-transports (Ctrl+R grid), -waiting-units (Ctrl+Y grid, for staged attacks), split-army-50% via `SelectPart_50` (Ctrl+Q grid), -armed-non-aircraft and -matching-excluding-grouped/builders/comm (legacy). Also names the `selectclear` group subcommand and the `/selectunits clear|+id|-id` console command. |
| Double-click select-of-type | Modifier behavior: Ctrl = whole-map (ignores the on-screen test), Shift = append. |
| Minimap selection | Beyond the box-drag that source covers, single-click and double-click on the minimap also select (honoring Shift/Ctrl). |
| Reclaim / Resurrect economy | Reclaiming a LIVE unit yields full metal even at 0% HP with no death explosion; resurrect refunds 100% metal / 50% energy and then auto-repairs the revived unit. |
| Self-Destruct / Stockpile | EMP pauses a self-D countdown; anti-nukes auto-launch interceptors from their stockpile. |
| Engine box/front formation (Alt) | BAR HP-sorts the box formation (high-HP units to the front, fragile units to the back); units travel at their own top speed (contrast the Ctrl-locked move at slowest speed). |
| Factory queue-mode toggle | It toggles order ROUTING — orders to the factory's build queue vs to the units it produces (rally inheritance) — not merely cycling the queue display. |
| Unit default-states | Web names the dedicated Unit Start States settings panel (`gui_unit_start_states.lua`) as the unified default-state system; source reaches the same outcome via State Prefs (`unit_stateprefs.lua`) plus the per-type default widgets. |
| Reclaim-field / build overlays | `gui_reclaiminfo.lua` surfaces a field's total reclaim VALUE; `gui_build_eta.lua` shows estimated build time — readouts source lists neither of (it has the highlight + builder-queue ghosts). |
| Smart / context right-click | Frames the engine default-command resolution (auto Move/Attack/Reclaim/Repair/Guard/Build based on what is under the cursor) as one unified mechanic; source only shows it in per-context pieces. |
| Resource sharing | Top-bar resource share control: click-drag it to give a set metal/energy amount, and double-click "Share" to gift the selected units (source has the share dialog and share-unit-to-target, but not the drag-on-the-bar gesture). |
| Queue editing | BAR has NO native drag-to-reorder; reordering = remove + re-insert, and cross-builder handoff is done via Build Split or by gifting units (which carry their queues). Open feature request #4362. |
