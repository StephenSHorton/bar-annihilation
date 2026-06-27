# BAR Annihilation — Selection Engine design

A faithful port of BAR's `select Source+_Filter+_Conclusion+`
([`select_api.lua`](../../bar-src/luaui/Include/select_api.lua)) onto PA:TITANS'
client API. This is the core of M1 "Selection power tools". Grounded in the
runtime capability surface mapped 2026-06-26 (see [`API-MAP.md`](./API-MAP.md)).

## What PA actually exposes (capability surface)

- **Enumerate units**: `model.selection().spec_ids` (sync, current selection —
  `{spec_id: [unitId]}`, gives ids *and* spec) · `api.getWorldView(0).getArmyUnits(armyIdx, planetIdx)`
  (async, all own units; `-1` = all planets — **verify**).
- **Per-unit runtime state**: `api.getWorldView(0).getUnitState([ids])` (async).
  Confirmed fields (from the identical hover serialization, `live_game_world_popup.js`):
  `health{current,max}`, `shield_fraction`, `ammo_fraction`, `location{x,y,z}`,
  `production/consumption`, `army` (colors only), and `tool_details`
  (action inferred: `weapon_target`→attacking, `build_target`→building/reclaiming,
  `payload_details`→transport). **The exact field set must be confirmed live** —
  source only directly reads `.planet`.
- **Blueprint traits**: `model.unitSpecs[spec]` (sync push: `structure`, `canBuild`,
  `build[]`, `commands[]`, `dps`/`damage`/`max_range`) + richer on-demand
  `$.get('/'+spec)` / `spec:/path` (adds `unit_types[]` categories, weapon ranges,
  recon). Defs are static → **cache forever**.
- **Cursor→world**: `api.Holodeck.focused.raycastTerrain(x,y)`.
- **Subscribe**: `model.selection.subscribe`; wrap `api.select.captureGroup/forgetGroup`;
  watch/alert channel (idle/damage/death/created).

### Two structural ceilings
1. **No JS world→screen projection / frustum** → BAR's `Visible`/on-screen has no
   clean path (only an engine on-screen-select → snapshot → restore hack).
2. **No per-unit order/queue/stance read** (player orders bypass JS) → cloak,
   generic idle, guard, patrol, wait are unreadable.

### Genuinely not portable (grey out, never fake)
Cloak/Cloaked, Stealth, Resurrect, Guarding, **Waiting** (PA has no wait command →
`Ctrl+Y` is dead), Patrolling.

## Architecture

One reusable engine, registered like the other modules:

```
BarAnnihilation.select.run({ source, sourceArg, filters:[{name,invert,arg}],
                             conclusion, conclusionArg, append, cycleKey })
```

Pipeline **enumerate → filter → conclude**, returns a Promise (sync path resolves
immediately). Three data tiers mirroring the surface:

1. **SpecCache** (sync) — per-def traits from `model.unitSpecs`, lazily augmented +
   memoized-forever by spec GET for fields the push lacks (`unit_types`, ranges).
2. **getUnitState tier** (async) — batched, fired **only** when a filter declares
   `needsState` (health, action, position). A pure-def query never pays async cost.
3. **Shadow trackers** (opt-in) — `GroupTracker` wraps `captureGroup`/`forgetGroup`
   for `InHotkeyGroup`/`InGroup_n`. (No order-shadow — player orders bypass JS.)

Each BAR preset = one `select.run(...)` wired into `KEYMAP` exactly like `bar-binds`
(Mousetrap unbind+bind, re-applied on `active_dictionary`/`input_maps_reload`),
with labels published to `BarAnnihilation.binds` for the overlay.

## Per-feature feasibility (cost)

| BAR token | Tier | Cost | Mechanism |
|---|---|---|---|
| src PrevSelection | sync | trivial | flatten `model.selection().spec_ids` |
| src AllMap | async | med | `getArmyUnits(own,-1)` flatten |
| src Visible | projection | high | engine on-screen-select + snapshot/restore |
| src FromMouse_d | async | high | `raycastTerrain` + `getUnitState` positions + distance |
| filt Builder/Building/Mobile/Weapons/Transport/ManualFire/InPrevSel/IdMatches/Not_ | sync | low | SpecCache + selection set |
| filt RelativeHealth/AbsoluteHealth | async | med | `getUnitState().health` |
| filt Aircraft/Category/Radar/Jammer/AntiAir/WeaponRange | async | med–high | spec GET `unit_types[]` / ranges, cached |
| filt InHotkeyGroup/InGroup_n | shadow | med | GroupTracker wrapping capture |
| filt Idle (fab/factory) | native | low | `api.select.idleFabbers/idleFactories` |
| filt Idle (generic) / Cloak / Guard / Wait / Patrol / Stealth / Resurrect | hard-wall | — | not portable |
| concl SelectAll/Num/Part/One, ClearSelection_ | sync | trivial | slice + `unitsById` (+ union for append) |
| concl SelectClosestToCursor | async | med | `raycastTerrain` + positions |

## Build order

1. **SpecCache + sync core** — engine skeleton, `prevselection` source, def filters,
   conclusions. *(this increment)*
2. **Probe module** — read-only in-game dump confirming the live checklist. *(this increment)* — **gates every async tier.**
3. getUnitState async tier — health filters, `Alt+Q` damaged-mobiles, FromMouse/closest.
4. Category/radius via spec GET — Aircraft/Category/Radar/AntiAir.
5. GroupTracker shadow — InHotkeyGroup/InGroup_n.
6. `Visible` snapshot-hack (highest risk) — `Q` narrow-to-on-screen.

## Live-probe checklist (run `Ctrl+Shift+P` in a loaded match)

1. `getUnitState([id])` returns the **full** entity (health/shield/ammo/location/
   tool_details), not just `{planet}`.
2. World-position field name + frame (`location` vs `position`; world vs per-planet).
3. `raycastTerrain` hit shape (position/entity field names; DPI scaling needed?).
4. `model.unitSpecs[id]` includes `unit_types[]`? (else category filters need spec GET).
5. `$.get('/'+spec)` / `spec:/path` works mid-match and returns merged blueprint
   (recon radii, tool damage/target-layers).
6. Any idle / current-command / stance field on `getUnitState`? (make-or-break for
   generic idle / patrol).
7. watch_list `alert.id` == unit entity id (feeds idle/death shadow).
8. Own army index for `getArmyUnits` (don't assume 0); `planetIdx=-1` = all planets.
9. `captureGroup` replace-vs-merge; does `selection_group_counts` re-emit on load.
10. `Visible` hack: engine on-screen-select updates `model.selection()` synchronously
    enough to snapshot + restore without flicker.
11. `api.select.unitsById` REPLACES (no additive flag) → append = JS union.
12. Positively confirm cloak / idle / order fields are truly ABSENT.
