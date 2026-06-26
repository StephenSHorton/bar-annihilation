# PA: TITANS client-mod API map (M0)

Resolves the BAR control catalog onto PA's **actual** `live_game` client API, read from
the installed game's loose UI source (build **124662**) at
`C:\Program Files (x86)\Steam\steamapps\common\Planetary Annihilation Titans\media\ui\`.
Legend: ✅ supported · ⚠️ partial / conditions · ⛔ blocked for a client mod.

## How a client mod loads (build 124662)

- Community Mods manager scans `coui:/client_mods/<id>/modinfo.json`
  (`community_mods/community-mods-manager.js:2634`), reads each client mod's `scenes`,
  generates `ui/mods/ui_mod_list.js` (`:1573`), and each scene does
  `loadMods(scene_mod_list['<scene>'])`.
- The main scene loads mods at **`live_game.js:4916`** (near end of file) → `model`, `api`,
  `handlers`, `ko`, `engine` all exist when our JS runs. ✅
- Scene file must be at `coui://ui/mods/<id>/live_game.js` (`community-mods-manager.js:93`);
  an **enabled** mod's `ui/` is mounted into `coui://ui/`. Our repo layout + the
  `mods\<id>` junction satisfy this. **On-disk gotcha:** the engine mounts the data dir's
  `mods\` folder as the virtual `/client_mods/` (confirmed in `log\PA-*.txt`:
  `Mounting …\Planetary Annihilation\mods\ as /client_mods/`) — so filesystem client mods
  go in `mods\`, not a folder named `client_mods`. The mod must be enabled in-game (writes
  `mods\mods.json`) to mount.

## Globals available to injected `live_game` JS

`model` (Knockout view-model), `api`, `handlers`, `ko`, `engine`, plus jQuery `$`.
Reference mods also use `action_sets` and `Mousetrap`. Wrap mod code in an IIFE.

## Orders / commands

| Need | PA call | Status | Source |
|---|---|---|---|
| Issue targeted/area command | `holodeck.unitCommand(cmd, x, y, queue)` | ✅ | `api/holodeck.js:217` |
| Move | `holodeck.unitGo(x, y, queue)` | ✅ | `holodeck.js:213` |
| Area/drag command | `unitBeginCommand`/`unitEndCommand`/`unitChangeCommandState` | ✅ | `holodeck.js:193-203` |
| Build placement (snap, queue) | `unitBeginFab`/`unitEndFab(x,y,queue,snap)` | ✅ | `holodeck.js:181-187` |
| Target a unit by id | `api.unit.targetCommand(cmd, target, queue)` | ✅ | `api/unit.js:10` |
| Build / cancel build | `api.unit.build(spec,count,immediate)` / `cancelBuild` | ✅ | `unit.js:4-8` |
| World pos under cursor | `holodeck.raycast(x,y)` / `raycastTerrain` | ✅ | `holodeck.js:246-304` |
| **Command vocabulary** | `'move' 'attack' 'assist' 'repair' 'reclaim' 'patrol' 'stop'` | ✅ | `live_game.js:1361-1417` |
| `queue` semantics | boolean: `true`=append, `false`=replace | ✅ | all order calls |
| **Insert at front of queue** | — | ⛔ | no JS path; queue lives in C++ sim |
| **Remove/pop queue item by index** | — | ⛔ | `cancelBuild` removes build items by spec only |
| Factory "build next" | `api.unit.build(spec, count, immediate=true)` | ⚠️ verify | `unit.js:4` |

> **Headline limitation:** every order is one `engine.call('holodeck.*', …, queue)` bridge
> call; `queue` is the only queue lever. BAR's `CMD.INSERT`/`CMD.REMOVE` (insert-at-front,
> pop) are **not portable** to a client mod. Shift-append already works natively.

## Selection

| Need | PA call | Status | Source |
|---|---|---|---|
| Read current selection | `model.selection()` → `{spec_ids, spec_groups}` (type→unit-id arrays) | ✅ | `live_game.js:1968, 2146` |
| Has selection | `model.hasSelection()` | ✅ | `live_game.js:1969` |
| Select by ids | `api.select.unitsById(ids, tryRepeatedly)` | ✅ | `api/select.js:69` |
| Commander | `api.select.commander()` | ✅ | `select.js:47` |
| Idle fabber | `api.select.idleFabber()` / `idleFabbers(planet)` | ✅ | `select.js:49,104` |
| All combat (+ land/air/naval, +OnScreen) | `api.select.allCombatUnits()` etc. | ✅ | `select.js:51-67` |
| All / idle factories (+OnScreen) | `api.select.allFactories()` / `allIdleFactories()` | ✅ | `select.js:53-63` |
| Filter current selection by type | `api.select.fromSelectionWithTypeFilter(acc, rej, remove)` | ✅ | `select.js:92` |
| On-screen / on-planet by type | `api.select.onScreenWithTypeFilter` / `onPlanetWithTypeFilter` | ✅ | `select.js:96-101` |
| Select matching types | `holodeck.selectMatchingTypes('add', types)` | ✅ | `holodeck.js:161`, used `live_game.js:1980` |
| Drag-select | `holodeck.beginDragSelect`/`endDragSelect` (engine owns the box) | ⚠️ | `holodeck.js:165-171` |
| Append/subtract modifier | engine reads `Mousetrap.isShiftDown()`; `force_remove` arg | ✅ | `select.js:35-43` |
| Empty selection | `api.select.empty()` | ✅ | `select.js:147` |
| Unit type categories | Bot/Tank/Air/Naval/Orbital/Advanced/Fabber/Factory/Commander | ✅ | `live_game_selection.js:49-58,119-127` |
| **Per-unit HP (damaged-unit filter)** | not in selection payload | ⚠️ deferred | needs separate per-unit query |

> **`*WithTypeFilter` take a CATEGORY, not a spec id.** `onScreen/onPlanetWithTypeFilter`,
> `fromSelectionWithTypeFilter`, `idleFabbers/Factories` filter by unit-type **category**
> strings (`Bot/Tank/Air/Naval/Orbital/Advanced/Fabber/Factory`) — PA's native quick-select
> passes e.g. `'Bot'` with reject `'Fabber'` (`control_group_bar.js:194,210`). Passing specific
> spec-ids matches nothing and the engine falls back to selecting **everything**. For
> same-**specific**-type use `holodeck.selectMatchingTypes(option, Object.keys(spec_ids))`
> — on-screen only; there is **no** specific-type map-wide verb.
>
> **Idle / on-planet selects need `focus_planet_id`** = the `planetId` observable on
> `camera.getFocus(hd.id)` (`camera.js:379`), **not** `.planet()`. It defaults to `-1` until a
> planet switch fires `focus_planet_changed`; coerce `-1 → 0` (PA's native idle button
> defaults to `0`, `control_group_bar.js:47`) or planet-filtered selects return empty.
>
> **Control-group focus** = `input.doubleTap(recallGroup(n), () => api.camera.track(true))`
> (`control_group_bar.js:169-187`): single-tap recalls, double-tap centers via `camera.track(true)`.

## Control groups

| Need | PA call | Status | Source |
|---|---|---|---|
| Set group (capture) | `api.select.captureGroup(n)` (replaces) | ✅ | `select.js:128`; `control_group_bar.js:184` |
| Recall group | `api.select.recallGroup(n)` (shift = additive) | ✅ | `select.js:134-139` |
| Recall group w/ type filter | `api.select.recallGroupWithTypeFilter(n, filter)` | ✅ | `select.js:141` |
| Forget group | `api.select.forgetGroup(n)` | ✅ | `select.js:144` |
| **Add selection into existing group** | — | ⛔ | no engine verb (only capture replaces) |
| **Toggle group in/out of selection** | — | ⛔ | no engine verb |

## Unit states & stances (bonus — confirms a later milestone is portable)

`model.selectionFireAtWill/ReturnFire/HoldFire` (fire state), `…Maneuver/Roam/HoldPosition`
(move state), `…Consume/Conserve`, `…BuildStanceNormal/Continuous` — all present at
`live_game.js:1479-1518`. ✅ Set-target / cloak / D-gun / stockpile still to be mapped.

## Input & keybinds

| Need | Approach | Status | Source |
|---|---|---|---|
| Raw key events | `$(document).on('keydown', …)` (`e.which`, `shiftKey/ctrlKey/altKey`) | ✅ | reference mods (Hotbuild2) |
| Raw mouse on world | `$('holodeck').on('mousemove', …)`; scale `offsetX/Y` by `ui_scale` | ✅ | reference mods; `live_game.js:3546` |
| Guard against UI focus | check `model.hasSelection()/showLanding()/chatSelected()` | ✅ | reference mods |
| Native keybind groups | `apply_keybinds/modify_keybinds`, `model.actionKeybinds()` → action_bar | ⚠️ later | `live_game.js:2834-2896, 4830` |
| Registered rebindable keybind | `api.settings.definitions.keyboard.settings[...] = {type:'keybind'}` | ⚠️ later | reference mods |

**M1 approach:** dispatch our selection actions from a single `$(document).keydown` handler
with an editable keymap (Hotbuild2 pattern); integrate with PA's native keybind-group system
later.

## Portability verdict for M1 (Selection power tools)

✅ Bind existing `api.select.*` (all-combat/land/air/naval, factories, idle factories) ·
idle-builder cycle (`idleFabber` + camera) · select-all-of-type (`selectMatchingTypes` /
`fromSelectionWithTypeFilter`) · split-army-50% (`model.selection().spec_ids` → subset →
`unitsById`) · additive/subtractive via shift/force_remove.
⚠️ Deferred: per-unit-HP filters (damaged select), SmartSelect box-modifier interception
(engine owns the box). ⛔ Out: add-to-group / toggle-in-group (no engine verb).

## Overlay rendering (custom HUD) — MUST use a Coherent `<panel>`, not a `<div>`

PA's `live_game` document is a **transparent host view composited BELOW the 3D holodeck
surface**. Any DOM appended to `document.body` gets correct layout and **captures mouse
input** but is **occluded by the 3D world and never paints** (proven in-game: a full-screen
solid probe div logged visible/full-size yet showed nothing). The entire visible HUD is
built from separate Coherent child **Views** created from `<panel src="coui://...">` via
`engine.call('panel.create')` (`shared/js/api/panel.js`).

**To draw a visible overlay, create a `<panel>` (not a `<div>`):**

    var el = document.createElement('panel');            // MUST be <panel>
    el.id = 'my-overlay';
    el.setAttribute('src', 'coui://ui/mods/<id>/overlay.html');
    el.setAttribute('fit', 'dock');                      // full viewport
    el.setAttribute('no-input', '');                     // optional: mouse passes through
    el.setAttribute('no-keyboard', '');                  // optional: keep keys on the host
    el.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:1500;';
    document.body.appendChild(el);
    api.Panel.bindElement(el);                            // -> panel.create -> a view that PAINTS

Toggle by setting the element's CSS `display` (a 200ms poll pushes `panel.visible`). The
painted content lives in the child HTML; push data into it with
`api.panels['<id>'].message('msg', payload)`. The child boots `bundle://boot/boot.js`,
declares `var handlers = {}`, and calls `app.registerWithCoherent(model, handlers)` to
receive messages (`helpers.js` `read_message` -> `handlers[msg]`).

- New overlay `.html` files in the mod dir are served live via `coui://` (the junction dir
  is mounted); referenced by panel `src`, NOT modinfo `scenes`, so **no zip-regen / restart**
  — only a scene reload (Ctrl+Shift+R, our dev bind).
- z-index / position were red herrings; `<div>`-vs-`<panel>` is the only thing that decides
  whether it paints. Confirmed painting in-game 2026-06-25.
- Source: `api/panel.js` (constructor 55-141; `panel.create` 113; `bindElement` 281;
  `message`/`ready` 328-405); `helpers.js` (`registerWithCoherent` 572; dispatch 682-712).
