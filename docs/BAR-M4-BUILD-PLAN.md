# M4 — Build Placement (line / area / spacing) — Plan

Scoped 2026-06-28 via a research + adversarial-verify workflow (6 agents). Governed by
the fidelity policy: build from primitives, faithful to BAR, no cheap lookalikes.
Companion to `BAR-FORMATIONS-PLAN.md` — M4 reuses the formations architecture almost
verbatim.

## Verdict: FEASIBLE from a client mod — one empirical gate first

Same shape as the shipped M6 formations. The placement primitive is
**`worldview.sendOrder({ command:'build', spec, location:{planet,pos}, queue })`**
(worldview.js:140-186; `'build'` is in the command list at worldview.js:164, `spec` is
documented "For build commands" at worldview.js:151). It rides the exact
`engine.call('worldview.sendOrder', id, JSON.stringify(order))` bridge (worldview.js:183)
that `formations.js:238` already drives in production for move/attack_ground/patrol.
Looping N positioned orders is therefore established — nothing in `sendOrder` is
one-shot or stateful.

**Bonus:** `worldview.fixupBuildLocations(spec, planet, [{pos}])` (worldview.js:188-206)
validates + snaps positions to the build grid and metal spots **server-side**, and
returns an engine-computed `orient`. So we do **NOT** port BAR's elmo grid-snap math
(SQUARE_SIZE=8 / BUILD_SQUARE_SIZE=16, gui_pregame_build.lua:316-333) — let PA snap.

### The gate (medium confidence until proven)
`command:'build'` via `sendOrder` has **zero stock-UI callers** — PA's native build path
uses screen-coord `holodeck.unitEndFab` (live_game.js:3192), not world-coord `sendOrder`.
So the build verb is *documented but unexercised*. **Phase 0 must smoke-test one
positioned build before any loop is built on top of it.** (Correction from the adversarial
pass: `unitEndFab` is NOT engine-private — it's a normal mod-callable prototype method;
it's just the wrong fit because it takes screen coords. `sendOrder` is the right primitive.)

## Native (reuse — do NOT reinvent) vs Build (mod-side)

**Reuse:**
- Single click-to-place — keep M3's path (gridmenu.enterFab → model.executeStartBuild →
  beginFabMode gives the ghost, snap, validity, confirm sound). M4 only adds DRAG escalation.
- Screen→world+planet: `holodeck.raycast(pts)` — planet-0-safe (holodeck.js:263 uses
  `result.planet !== undefined`; `raycastTerrain` drops planet 0 at :293). This bug bit formations.
- `worldview.fixupBuildLocations` — terrain/slope/water validity, grid align, metal-spot
  snap, engine orient. Replaces BAR's snapPosition math.
- Affordability / queue — the sim handles it; `sendOrder queue:true` appends (worldview.js:152).

**Build:**
1. Left-drag capture on the holodeck while a build is armed (`model.mode()==='fab'`),
   adapting `formations.js` onDown/onMove/onUp from `button===2` to `button===0`.
2. Modifier→mode mapping (BAR determineBuildMode, gui_pregame_build.lua:504-525):
   Shift+drag = LINE, Shift+Alt+drag = GRID/area, (opt) Shift+Alt+Ctrl = BOX perimeter.
3. Position generation: line row (getBuildPositionsLine :383-403) + snake-fill rectangle
   (getBuildPositionsGrid :405-427, alternate row dir for travel-optimal build order),
   feeding RAW positions into `fixupBuildLocations` for the actual snap.
4. Persistent spacing modifier (int 0-16; gap = footprint + 2·step·spacing,
   gui_pregame_build.lua:357-371; clamp 16 per cmd_limit_build_spacing.lua).
5. No-input preview overlay panel (reuse the `formation_overlay.html` composited-panel
   pattern, formations.js:90-168).
6. The per-position `sendOrder('build')` loop with queue flags.

## Phase 0 — GATE (prove `command:'build'` via sendOrder)

Dev-only `modules/build-probe.js` (modeled on `formation-probe.js`, de-listed before
release). Select a fabber/commander, point at open ground:
- **Ctrl+Shift+B** — single positioned build at cursor (THE GATE). Success = a real ghost
  appears, the fabber walks over and starts it, promise resolves OK.
- **Ctrl+Shift+1** — `fixupBuildLocations` first, build at the snapped pos (confirms snap +
  that `orient` comes back).
- **Ctrl+Shift+2** — 3-call loop to distinct positions (queue:false, then true, true) —
  confirms queued positioned builds append.
- **Ctrl+Shift+3** — build a metal extractor with cursor *near* a metal spot — does
  `fixupBuildLocations` magnetize it onto the spot?

GO/NO-GO for everything below. Fallback if it fails: drive `unitBeginFab/unitEndFab` with
synthesized screen coords per position (messier, screen-space) — but prove `sendOrder` first.

## Phases (after the gate)

1. **Scaffold + left-drag capture** — `modules/buildplace.js`, capture-phase listeners
   guarded by `button===0` + onHolodeck + `model.mode()==='fab'`; pre-empt PA's native fab
   mousedown (live_game.js:3178-3183) via stopImmediatePropagation, or escalate only past a
   drag threshold and cancel native fab. Idempotent `window.__barBuildCleanup`. Click (no
   drag) → let PA's native single placement run untouched.
2. **Line build (Shift+drag)** — footprint from `model.unitSpecs[spec]` (field TBD),
   compute count/step, raycast endpoints, generate world positions, `fixupBuildLocations`,
   loop `sendOrder('build')` (first queue=shift?true:false, rest true). No Hungarian/decross
   — build order is positional, not unit-assignment.
3. **Preview overlay** — clone `formation_overlay.html` → `build_overlay.html`, ghost
   rect/dot per slot, rAF-coalesced. Preview approximate in screen space during drag;
   snapped truth at release (per-move fixup is async/racy).
4. **Area / grid build (Shift+Alt+drag)** — modifier mapping; snake-fill (getBuildPositionsGrid);
   cap ~200 (BAR MAX_DRAG_BUILD_COUNT); `fixupBuildLocations` the whole batch once.
5. **Spacing modifier (persistent)** — int 0-16, inc/dec keys (BAR: Alt+Z/Alt+X + mouse4/5),
   persist per-building-NAME in localStorage; live preview reflects it; publish to BA.binds.
6. **Facing + native-suppression + polish** — investigate whether `sendOrder` honors
   facing/orient (likely a wall → degrade to PA auto-orient, document it); suppress native
   fab ghost during our drag; Esc cancels; bump modinfo; ROADMAP M4 → DONE.

## Risks / walls (degrade faithfully, never fake)
- **Gate risk:** `command:'build'` unexercised via sendOrder — Phase 0 proves it.
- **Capture conflict:** PA's `holodeckModeMouseDown.fab` grabs input on button-0 mousedown
  (live_game.js:3183-3208); our left-drag must pre-empt or escalate-then-cancel.
- **Facing wall:** `sendOrder` location schema has no `orient` (worldview.js:145-150); BAR
  SetBuildFacing 0-3 may be unexpressible → degrade to auto-orient.
- **Footprint data:** exact `model.unitSpecs` footprint field unconfirmed (footprint_x/z? size?).
- **Perf:** 100-200 sendOrder calls unmeasured; may need chunking.
- **Double-place:** suppress native fab ghost during our drag.

## Open questions (resolve in Phase 0 / Phase 2)
- Does `sendOrder({command:'build'})` place a building from a client mod, planet=0 honored?
- Does `fixupBuildLocations` snap mex→metal spots and drop invalid cells; does `sendOrder`
  honor its returned `orient`?
- Queue semantics for positioned builds (first queue:false replaces, rest true appends)?
- Which `model.unitSpecs` field carries footprint dims in PA world units?
- Can capture-phase left-drag reliably pre-empt PA's native fab mousedown?
- PA world-unit analog of BAR's spacing step — or just trust `fixupBuildLocations` to snap?
