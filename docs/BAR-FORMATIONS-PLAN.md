# BAR Formations / "Move Spline" — port plan

Scoped 2026-06-27 (5-agent research + adversarial verify; verifier confidence **HIGH** —
every named PA primitive and BAR function confirmed at the cited lines, only precision
fixes). This is the faithful target + the build path. Governed by the project fidelity
policy (build from primitives, no cheap lookalikes).

## TL;DR — the reframe

- **"Move splines" don't exist in BAR.** There is no curve/Catmull-Rom/Bezier smoothing of
  unit paths anywhere — not in BAR, not in PA. What BAR actually has is **freehand custom
  formations** (right-drag draws any shape; units fill it) plus a **single-unit path-follow**
  (drag a stroke; one unit follows *discrete* MOVE waypoints). Faithful = discrete points.
  **Do not implement smoothed paths thinking it's faithful — it isn't.**
- BAR's entire formation "feel" is **one Lua widget**: `cmd_customformations2.lua`
  (`bar-src/luaui/Widgets/`). It's NOT engine-native → **fully portable client-side.**
- **The soul** is the *optimal, non-crossing unit→slot assignment* (Hungarian for ≤~20 units,
  a line-crossing-elimination heuristic above). Naive index-order assignment feels wrong.

## The decisive primitive (and the gate)

`api.getWorldView(0).sendOrder({units:[id], command:'move', location:{planet, pos:[x,y,z]}, queue})`
— `worldview.js:140-186`. Takes an **explicit unit-id list + a world position**, so we can give
**each selected unit its own destination** by looping once per unit. This is impossible on the
holodeck path (every holodeck verb is whole-selection, two anchors).

⚠️ **GATE:** `sendOrder` has **zero call sites** in PA's shipped UI (only its read-siblings
`getArmyUnits`/`getUnitState` are called live). Whether it round-trips and moves units **from a
client mod** is unproven from static source — it's a **runtime/permission question**. Phase 0
exists solely to prove it before we build anything else.

## PA baseline (what we're replacing)

PA ships a weaker native "Custom Formations" (`allowCustomFormations`, default **ON**,
`live_game.js:783`; options-bar toggle): right-drag distributes the selection along the
**straight** anchor→release line, **move/unload only**, two anchors, whole-selection,
distribution computed server-side. No freehand, no per-unit control, no facing param.

## BAR target spec (`cmd_customformations2.lua`)

- **Right-mouse + drag** traces a **freehand polyline** (a node per mousemove). Line/arc/V/S —
  a straight drag is just the degenerate case.
- On release: resample the polyline to exactly **N points spaced evenly by arc length**
  (`GetInterpNodes`), one slot per unit.
- **Optimal assignment** units→slots: true **Hungarian** ≤~20 units; **GetOrdersNoX**
  (sort-along-axis + swap crossing pairs) above. Units never cross; travel minimized.
- Eligible verbs: MOVE / FIGHT / ATTACK / PATROL / UNLOAD / SET_TARGET / MANUAL_LAUNCH
  (colored green / red / yellow / orange / blue). Short drag → single-point click.
- **Orders are position-only — no facing is ever set** (final heading is emergent). This is
  faithful; PA also has no facing param.
- **Single unit selected** → drag emits a throttled stream of **discrete MOVE waypoints**
  (`minPathSpacingSq=50²`, de-duped). The closest thing BAR has to a "move spline."
- Shift = append; Meta/space = insert at front of queue. A fading colored line + dots render.

## Phased plan

| Phase | Goal | Risk |
|---|---|---|
| **0 — Prove `sendOrder` (the gate)** | A temporary probe: read selection, get unit pos via `getUnitState`, raycast cursor→world, `sendOrder({units:[oneId],command:'move',location,queue:false})`. Confirm **one** unit (not the whole selection) walks there; test queue-append; test a 3-unit loop to **distinct** points. | **HIGH-value / LOW-effort.** If it doesn't round-trip from a client mod, the whole approach changes. Sibling of `getArmyUnits`/`getUnitState` which DO work live → likely bound. |
| **1 — Core loop (straight line)** | New `modules/formations.js`. Claim the right-drag (capture-phase listener beating PA's bubble-phase `mousedown.stock` at `live_game.js:3619`). Sample N points along A→B, one batch `holodeck.raycast([[x,y]…])`, sort-along-axis pairing, per-unit `sendOrder` loop. | **Crux:** can a capture-phase listener `stopImmediatePropagation` before PA's handler? Fallbacks: fullscreen input `<panel>` swallow (drag_layer pattern) or force `allowCustomFormations(false)`. |
| **2 — Freehand + arc-length + overlay** | Accumulate **screen** polyline during drag (cheap, sync); resample by arc length (`GetInterpNodes` port); batch-raycast the N slots at release. Drag-vs-click threshold. Screen-space preview panel (`Panel.bindElement`, drag_layer pattern) with fade. | Must draw in screen space (per-move raycast is async/racy). Elmo→PA-unit rescale needs a feel pass. |
| **3 — Optimal assignment (the soul)** | Port Hungarian (`findHungarian`/`stepPrimeZeroes`/`stepFiveStar`) + `GetOrdersNoX` verbatim to JS; **fixed** cutoff (~20–30) instead of BAR's time-adaptive. | Pure client math, low integration risk. |
| **4 — Smart-verb + per-command rules** | Infer verb at press (raycast-classify, or read `unitBeginGo` then cancel). Map MOVE/ATTACK/PATROL/UNLOAD/MANUAL_LAUNCH→`sendOrder` verbs; color per verb; `overrideCmds` (guard/attack/set_target over same target → original cmd, no formation); UNLOAD ≥64/unit; MANUAL_LAUNCH >1 unit. | FIGHT (attack-move) + SET_TARGET have no clean PA verb — probe, likely partial (see Walls). |
| **5 — Queue/shift + single-unit path + walls** | Shift→`queue:true` per unit. Single-unit drag → throttled discrete MOVE waypoints. Gracefully degrade the walls (below). | Shift-from-final-pos & meta-insert-front are genuine walls — fall back, never fake. |
| **6 — Native-suppression hardening + polish** | Robustly prevent native double-fire across selection/modifier combos (internally force `allowCustomFormations(false)`); Esc cancels; overlay polish; register into the keyboard overlay; optional external `StartFormation/AddFormationNode/EndFormation` API. | Brittle only to a future PA patch of the drag state machine; all client-side. |

## Walls (degrade faithfully — never fake)

- **Shift-assign-from-FINAL-queued-position** — PA's per-unit queue is unreadable from JS (C++
  sim). Fallback: assign from **current** position. *(Note: BAR uses final-or-current pos
  **unconditionally**, not only on shift — the practical fallback is unaffected.)*
- **Meta/space insert-at-front** — PA has no queue-insert; only append/replace. → shift-append only.
- **Explicit facing** — no PA movement-order facing param. **Faithful** — BAR sets none either.
- **Smooth spline paths** — don't exist in BAR or PA. Faithful = discrete waypoints.
- **FIGHT (attack-move) & SET_TARGET verbs** — no direct `sendOrder` analog. *But PA exposes
  `attack_ground`, `patrol`, `assist`, `movement_stance` — an attack-move-ish analog may be
  reachable; probe before declaring impossible (per fidelity policy), don't assume.*

## Open questions → live probes (M0 / Phase 0)

1. Does `sendOrder` round-trip + move units from a client mod in a live match? **(the gate)**
2. With `units:[oneId]` + distinct `location.pos` per call, does each unit get its own destination?
3. Is the raycast/`getUnitState` `.planet` usable directly as `location.planet`, or derive via
   `camera.getFocus(hd.id).planetId`? *(`getUnitState.planet` is NOT yet confirmed — `probe.js:126`
   is still probing for it; keep the fallback ready.)*
4. Performance ceiling firing N rapid per-unit `sendOrder` calls (100–200 units)? Chunk if so.
5. Can a capture-phase drag listener reliably pre-empt PA's bubble-phase `mousedown.stock` (3619)?
6. Does `move` honor `location.multi_pos` (curve), or is it patrol-only? (single-unit path impl.)
7. Elmo→PA-world-unit constants for `minFormationLength=20`, `minPathSpacingSq=50²`, UNLOAD 64/unit.

## Verifier corrections folded in
- Native right-drag listener is `live_game.js:**3619**` (`$holodeck.on('mousedown.stock')`), not 3313.
- `GetUnitFinalPosition` is the assignment source **always**, not only on shift (current-pos fallback still correct).
- `getUnitState.planet` unconfirmed — Phase 0 must not assume it.
- Batch `holodeck.raycast` attaches **one** `.planet` to all hits (fine single-planet; note for edge cases).
- The `allThen` helper is local to `select-engine.js` — hoist onto `BA.util` or re-declare in `formations.js`.
