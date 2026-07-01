# Client-Reachable Backlog — highest-value BAR features still portable

Produced 2026-07-01 by a catalog-wide audit (6 parallel scans over every section of
[`BAR-Control-Scheme-Catalog.md`](./BAR-Control-Scheme-Catalog.md) + a ranking pass), excluding what's
already shipped (M1–M8) and the closed engine walls (see
[`SERVER-MOD-INVESTIGATION.md`](./SERVER-MOD-INVESTIGATION.md)). 103 features analyzed → 61 marked
client-reachable → ranked by value × feasibility. This is the "what's next" candidate pool.

## The big correction: the render-at-unit-position overlay tier is a WALL

PA exposes `raycast`/`raycastTerrain` (screen→world) but **no world→screen / projection API** anywhere
(verified in the installed UI source, build 124662 — not on `holodeck.js`, not on `camera.js`, no
`engine.call('*project*')`). PA draws every world-anchored visual (strategic icons, health bars,
selection platters, range rings, build ghosts) engine-side. So a client mod **cannot** draw its own
graphics pinned to a unit's on-screen position. Our own shipped world visuals confirm this: order/queue
lines are PA's *native* setting, and the M6 formation overlay draws in pure screen space and only ever
converts screen→world via raycast, never the reverse.

**Consequence — these ~15 catalog items are NOT reachable** (drop them): Fire-State / Repeat /
Self-Destruct icons, Selected-Units platters, Unit-Group-Number billboards, Idle-Builder "z" icons,
Transport-Load rings, Attack/Defense/Sensor range rings, Blast-radius preview, Show-Builder-Queue
ghosts, Reclaim-field highlight, Build-placement octagons, Building-grid overlay, and AoE-at-cursor
(needs a world-units→pixels scale = projection). Note **Fire-State Icons** was tempting (catalog-rated
high) but is a *double* wall: per-unit fire stance is only exposed as selection-**aggregate** booleans,
never per-unit, **and** it needs projection.

What survives, therefore, is two clean shapes: **fixed screen-space `<panel>` HUDs** (docked, not
unit-anchored) and **screen→world input gestures** (capture the mouse, raycast to world, issue orders).

---

## Tier 1 — clean wins (no walls, APIs already verified). Build these first.

| # | Feature | Effort | Value | The PA path |
|---|---|---|---|---|
| 1 | **Idle Builders panel** | M | High | Docked screen-space `<panel>` (M3/M8 pattern) listing idle builder/factory *types*; poll `api.select.idleFabbers(planet)` + idle factories; LMB→`api.select.idleFabber()` (cycles), Shift+LMB→`api.select.unitsById()` for the whole spec. Lifts economy uptime — the biggest BAR lever — and turns PA's blind `Ctrl+Tab` idle-cycle into an at-a-glance list. |
| 5 | **In-game Keybind / control-scheme panel** | S | High | Screen-space `<panel>` reading the M8 `BA.rebind` registry, tabbed by modifier layer + category; opened from the existing keyboard-overlay button. Zero reachability risk, registry already exists — teaches the whole scheme in-game. The single lowest-risk high-value item on the board. |
| 7 | **Factory move-out (Unit Mover)** | S | Med | Detect newly-produced units via `getWorldView(0).getArmyUnits` id-diffs near factory positions; nudge each a short offset out with `holodeck.unitGo`. No projection, no walls — a consistent QoL every BAR player feels (stops unit-clot at factory mouths). |
| 10 | **Loop-select / lasso polygon** | M | Med | Freehand loop captured in screen space (exactly like `formations.js`); `holodeck.raycast` each vertex → world polygon; even-odd point-in-polygon test on own units' world `pos` (`getUnitState`) → `api.select.unitsById`. Dodges the projection wall entirely (tests happen in world space). Faithful expert selection gesture, self-contained. |

## Tier 2 — high value, but verify ONE dependency before committing.

| # | Feature | Effort | Value | Path + the thing to probe first |
|---|---|---|---|---|
| 3 | **Factory presets (queue manager)** | M | High | Save/recall a factory's whole build queue as numbered presets (`localStorage`, M8 pattern); recall = batch `api.unit.build(spec,count)`. Queue-*read* is a wall, but **the mod already owns build issuance via the M3 grid menu**, so it can *shadow* the queue as the player builds it. **Probe:** wire a queue-shadow into the M3 issuance path. |
| 2 | **Attack-no-Ally (anti-teamkill)** | M | High | Capture-phase RMB (same gate as M5/M6); `holodeck.raycast` the target — if its army is an ally, suppress the native attack. **Probe:** does `raycast` return the target unit's **army/id**? If yes, optionally re-issue a ground-attack at that spot; if the ground-attack rewrite hits PA's target-ground wall (M7), **degrade to pure suppression** — which still delivers the core "don't delete your ally" value. |
| 4 | **Auto-Group (tag a type → auto-join a control group)** | M | High | Watch new units via `getArmyUnits` id-diffs; match spec vs tagged types. Add-to-group is a wall (`captureGroup` only *replaces*), so the workaround is: union the shadow-group set with the new id, momentarily `unitsById(union)`→`captureGroup(n)`→restore prior selection. **Caveat to accept:** that restore briefly mutates the player's live selection each time a tagged unit spawns. |
| 6 | **Quick-build / upgrade extractor** | M | High | RMB near a metal spot → place/upgrade the best extractor; Shift queues. **Probe FIRST (make-or-break):** does PA expose **metal-spot positions** to JS? If not, this — and Extractor-Snap — is itself a wall. Everything else here is downstream of that one fact. |

## Tier 3 — strong but larger (L effort) automations, once Tier 1–2 land.

| # | Feature | Effort | Value | Path |
|---|---|---|---|---|
| 8 | **Transport guards factory → auto-ferry** | L | High | A transport set to GUARD a factory auto-ferries each produced unit to the rally: per-transport state machine `load → unitGo(rally) → unload → re-guard`, driven by the same production-shadow. Big repetitive-micro eliminator for air/island play; cost is the order-chain + edge cases. |
| 9 | **Build-Split across builders** | L | High | Distribute a big line/area build across 2+ selected builders (partition by build power, each takes a chunk then assists). Reachable because the mod owns the M4 fab path; cost is the partition logic. |
| 11 | **Context-build water/ground swap** | M | Med | During build mode, `raycastTerrain` at cursor → auto-swap the armed build spec to the water/land sibling. Value scales with how many paired water/land structures PA's roster actually has (worth a quick roster check). |

## Also-reachable, lower priority (from the raw scan)
Deselect-all (`api.select.empty`, S) · Clear-selection-on-empty-group (S) · Grid-menu pagination &
`.`-cycle-builder (S, extends M3) · Guard-damaged-constructors = assist-not-repair (S) · Only-Fighters-
Patrol auto-STOP (M) · Spectate-Selected for casters (M) · Bomber-attack-ground (M, same degrade path as
Attack-no-Ally) · Immobile-builder fight-stance (S).

## Dropped
- **Projection-overlay family** (~15 items above) — world→screen wall.
- **Already shipped (M1–M8):** select DSL / Ctrl+E / Q / split, grid menu, M4 spacing + line/grid, M5
  area commands, M7 command-modes + states + self-destruct, M8 rebinding. (Build-facing `[`/`]` was built
  then reverted on user preference — do **not** re-propose.)
- **Walls:** area target-filters (Area-Command-Filter, Exclude-Walls, Area-Reclaim-Enemy, Smart-Area-
  Reclaim — need a Recoil GameCMD to filter the native area target set), Factory-Assist-Fix (queue read),
  Auto-Repair-Idle / Priority-Construction-Turrets / Guard-Damaged-Constructors-auto (generic per-unit
  idle and/or HP), move-failed/under-attack notify (HP + world-anchor), terraform/level-ground (PA has no
  terraform).

---

### Recommended next build
**Idle Builders panel (#1)** + **Keybind/control-scheme panel (#5)** — both are clean screen-space HUDs
reusing the proven M3/M8 panel plumbing, both high value, zero reachability risk, and together they'd form
a natural **"M9 — HUD panels"** milestone. In parallel, a 15-minute **metal-spot probe** decides whether
the whole extractor-automation branch (#6) is real or a wall, and a **queue-shadow spike** in the M3 path
unlocks Factory Presets (#3). Tier-3 automations follow once the panel plumbing + production-shadow exist.
