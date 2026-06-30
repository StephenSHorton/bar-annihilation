# BAR Grid Keybinds — the canonical spec

**This file is the source of truth for what the mod must support.** It is a
line-item transcription of BAR's three official **Grid** keybind reference cards
(No-mod / Ctrl / Alt), as shown in-game by `gui_keybind_info.lua`. The user plays
**Grid layout**, and these cards are what they want ported.

## Read this first (hard-won rules)

1. **The CARDS are authoritative — not the raw `select` strings in
   `bar-src/.../grid_keys.txt`.** They disagree in places (notably Q and Ctrl+W,
   see below). Where they differ, **follow the cards.**
2. **Never invent a keybind.** Only bind a key if it appears on a card. The select
   engine (`BA.select.run`) can express far more of BAR's `select` DSL than the
   cards bind — that extra capability is foundation for *legacy/custom* binds, and
   must NOT be bound to made-up keys. (We got burned inventing `Alt+A/E/G` for
   aircraft/anti-air/FromMouse — those keys are **blank** on the Grid ALT card.)
3. **A blank cell on a card means the key is unbound in BAR.** Leave it to PA.
4. **`Esc` deselects** (no-mod). `1`–`0` are control groups (native PA — never bind
   digits; PA's native double-tap recall must stay intact).

## Status legend
- ✅ **done** — implemented faithfully in the mod
- 🟢 **native** — PA already does this; don't touch
- ⛔ **wall** — genuine PA client limitation; cannot port faithfully (don't fake)
- 🔲 **todo** — planned; not yet built
- ➖ **blank** — no BAR bind on this key
- *(cmd)* — a unit order (issued to the current selection), vs a selection/UI action

> Status accuracy: the **selection** rows (M1) are verified. Non-selection rows
> (commands/build/camera/toggles) are a best-effort first pass — verify against the
> catalog + live API before building each milestone.

---

## Card 1 — GRID KEYS (no modifier)

### Function row
| Key | BAR action | Status / notes |
|---|---|---|
| Esc | Deselect | 🟢 native |
| F1–F4 | Goto Camera 1–4 | 🟢 native camera |
| F5 | Goto Ping | 🟢 / 🔲 |
| F6 | Unit Pathing (overlay) | 🟢 native |
| F7 | Metal View | 🟢 native |
| F8 | Map Elevation | 🟢 native |
| F9 | Hide HP Bars | 🟢 native |
| F10 | Options Menu | 🟢 native |
| F11 | ➖ | — |
| F12 | Screenshot | 🟢 native |

### Number row — *Select Unit Groups*
| Key | BAR action | Status |
|---|---|---|
| \` | Draw + Labels | 🟢 / 🔲 |
| 1–0 | Select Unit Group 1–0 | 🟢 native (do NOT bind) |
| - | Decrease Volume | 🟢 native |
| = | Increase Volume | 🟢 native |
| Backspace | Mute Sound | 🟢 native |

### QWERTY row
| Key | BAR action | Status |
|---|---|---|
| Tab | **Select Commander** | ✅ M1 |
| Q | **Select Similar Units** | ✅ M1 (same-type, on-screen) |
| W | Resurrect / Capture *(cmd)* | ⛔ WALL — PA has no resurrect AND no unit capture (both confirmed) |
| E | Reclaim *(cmd)* | ✅ arms cmd 4 (`model.setCommandIndex(4)`) |
| R | Repair *(cmd)* | ✅ arms cmd 3 (`model.setCommandIndex(3)`) |
| T | Repeat *(toggle)* | ✅ `T` → toggles factory continuous build-stance (`toggle_order BuildStance`, values `normal`/`continuous`, gated `canBuild && !mobile`); faithful repeat for factories, no-ops on mobile (PA has no mobile queue-repeat). Badge = orders[3]. |
| Y | Wait / Pause *(toggle)* | ✅ M7 — `action_bar.message('toggle_order','Energy')` → cycles consume↔conserve(hold) |
| U | Unload Units *(cmd)* | ✅ arms cmd 9 (`model.setCommandIndex(9)`) |
| I | Unit Info | 🟢 / 🔲 |
| O | Guard *(cmd)* | ✅ *nuance* — PA Assist, arms cmd 2 (`model.setCommandIndex(2)`); PA folds guard+assist |
| P | Gather and Wait *(cmd)* | ⛔ WALL — no PA gather/wait verb |
| [ | Rotate Left (build) | ✅ M4 Phase 6 — `[` = facing **inc** (`buildplace.js` `onFace`); facing 0..3 = S/E/N/W, cycled, applied as the begin→end fab vector to single/line/grid alike. Screen/camera-relative (PA has no world→screen projection). Replaces PA's native continuous left-drag-rotate (faithful: BAR has only discrete facing). *(Old "⛔ WALL" predated the M4 fab-primitive proof — same overturn as build spacing.)* |
| ] | Rotate Right (build) | ✅ M4 Phase 6 — `]` = facing **dec**; same |

### ASDF row
| Key | BAR action | Status |
|---|---|---|
| Caps Lock | ➖ | — |
| A | Attack *(cmd)* | ✅ arms cmd 1 (`model.setCommandIndex(1)`); click ground = attack-move/area |
| S | Target Ground / Set-Target *(cmd)* | ⛔ WALL — no persistent set-target/target-ground verb |
| D | D-Gun / manual fire *(cmd)* | ✅ arms cmd 12 (`model.setCommandIndex(12)`); auto-gated to alt-fire units (commander) |
| F | Fight (attack-move) *(cmd)* | ✅ *nuance* — arms cmd 1 (PA folds attack-move into attack; click ground) |
| G | Stop / Clear Queue *(cmd)* | ✅ cmd -1 (`model.setCommandIndex(-1)`, issues immediately) |
| H | Patrol *(cmd)* | ✅ arms cmd 5 (`model.setCommandIndex(5)`) |
| J | Load Units *(cmd)* | ✅ arms cmd 10 (`model.setCommandIndex(10)`) |
| K | Toggle Cloak *(toggle)* | ⛔ WALL — no cloak in PA |
| L | Toggle Firestate *(multi-tap)* | ✅ M7 — 1/2/3 taps → FireAtWill / HoldFire / ReturnFire (`action_bar selection_order`) |
| ; | Toggle Movestate *(multi-tap)* | ✅ M7 — 1/2/3 taps → Roam / HoldPosition / Maneuver (`action_bar selection_order`) |
| ' | Switch LOS Mode | 🟢 native |
| Enter | Open/Send Chat (Shift = spec) | 🟢 native |

### ZXCV row
| Key | BAR action | Status |
|---|---|---|
| Shift | Queue (hold) "Queue All The Things" | 🟢 native shift-queue |
| Z | **Build Eco** (category) | ✅ M3 grid build menu |
| X | **Build Defense** (category) | ✅ M3 |
| C | **Build Utility** (category) | ✅ M3 |
| V | **Build Factory** (category) | ✅ M3 |
| B | On/Off Toggle Trajectory *(toggle)* | ⛔ WALL — no on/off or firing-arc toggle (only fire-stance) |
| N | Skip to Next in Queue | ⛔ WALL — no queue-edit verb |
| M | Restore Ground (terraform) | ⛔ no terraform in PA |
| , . / | ➖ | — |

### Bottom row
| Key | BAR action | Status |
|---|---|---|
| Ctrl | Insert to Factory Queue (Ctrl+click) | 🔲 M3/M7 |
| Ctrl (combo) | Remove from Factory Queue | 🔲 |
| Space (hold) | Insert at top of constructor queue | ✅ M3 (hold-Space = front-of-queue) |
| Shift+Space | Show factory build queues | 🔲 |
| (toggles) | 2 taps OFF · 3 taps · 1 tap ON | (modifier convention) |

---

## Card 2 — GRID CTRL KEYS

### Function row
| Key | BAR action | Status |
|---|---|---|
| F1–F4 | **Set** Camera 1–4 | 🟢 native |
| F5 | Overhead Cam | 🟢 native |
| F6 | Spring Cam | 🟢 native |
| F7 | Hide UI | 🟢 native |
| F12 | Screenshot | 🟢 native |
| Esc, F8–F11 | ➖ | — |

### Number row — *Make Unit Groups*
| Key | BAR action | Status |
|---|---|---|
| \` | Remove Unit from Group | 🟢 native |
| 1–0 | Make Unit Group 1–0 | 🟢 native (do NOT bind) |

### QWERTY row  ← **the selection cluster (M1)**
| Key | BAR action | Status |
|---|---|---|
| Tab | **Select Idle Builder** | ✅ M1 (native idle-fabber cycle) |
| Q | **Split Army** | ✅ M1 (SelectPart_50, faithful cursor) |
| W | **Select All Similar Units** | ✅ M1 (same-type, map-wide) |
| E | **Select All Units** | ✅ M1 (AllMap → SelectAll) |
| R | **Select Idle Transports** | ⛔ needs generic per-unit idle (client wall) |
| T | Map Overview | 🟢 native |
| Y | **Select Waiting Units** | 🔲 Waiting IS a PA concept (energy `conserve`); map-wide per-unit energy-state read needs verify (`selection.energy0` only covers current selection) |
| U | ➖ | — |
| I | Map Details | 🟢 native |
| O P [ ] \\ | ➖ | — |

### ASDF row
| Key | BAR action | Status |
|---|---|---|
| A | Area Attack *(cmd)* | 🔲 M5 (area command) |
| S | Cancel Target *(cmd)* | 🔲 M7 |
| G | Factory Guard *(cmd)* | ✅ `Ctrl+G` → assist-on-factory; arms cmd 2 (`model.setCommandIndex(2)`) |
| K | Toggle Cloak | ⛔ no cloak |
| ' | Switch LOS Mode | 🟢 native |
| Enter | Open/Send Chat | 🟢 native |
| Caps D F H J L ; | ➖ | — |

### ZXCV row
| Key | BAR action | Status |
|---|---|---|
| Shift | Queue All The Things | 🟢 native |
| B | Self Destruct *(cmd)* | ✅ `Ctrl+B` → `api.unit.selfDestruct()`, **INSTANT, no confirm** (PA's Delete pops a modal; skipped per user) |
| N | Skip Last in Queue | 🔲/⛔ queue editing |
| Z X C V M | ➖ | — |

### Bottom row
| Key | BAR action | Status |
|---|---|---|
| Space | Insert at top of constructor queue | ✅ M3 |
| Shift+Space | Show factory build queues | 🔲 |

---

## Card 3 — GRID ALT KEYS

### Function row
| Key | BAR action | Status |
|---|---|---|
| F4 | Fun ! | ➖ (joke bind) |
| F12 | Screenshot | 🟢 native |
| Esc, F1–F3, F5–F11 | ➖ | — |

### Number row — *Set Unit Auto Groups*
| Key | BAR action | Status |
|---|---|---|
| \` | Remove from Auto Group | 🔲/⛔ (BAR auto-group system; verify PA analog) |
| 1–0 | Set Auto Group 1–0 | 🔲/⛔ (auto-groups — likely no PA analog) |
| - | Decrease Gamespeed | 🟢 native (host) |
| = | Increase Gamespeed | 🟢 native (host) |

### QWERTY row
| Key | BAR action | Status |
|---|---|---|
| Tab | Switch Application | 🟢 OS-level |
| O | Flip Camera | 🟢 native |
| Q W E R T Y U I P [ ] \\ | ➖ | — |

### ASDF row
| Key | BAR action | Status |
|---|---|---|
| Enter | Switch Ally Chat | 🟢 native |
| (all letters) | ➖ | — |

### ZXCV row
| Key | BAR action | Status |
|---|---|---|
| Shift | Queue All The Things | 🟢 native |
| Z | Increase Build Spacing | ✅ M4 Phase 5 — Alt+Z = per-building spacing **inc** (`buildplace.js`); widens the line/grid fab step (`SPACING_UNIT` world-units/level), persisted per building in localStorage. *(Old "⛔ WALL" was PA's lack of a NATIVE spacing action — the mod builds spacing from the fab primitive.)* |
| X | Decrease Build Spacing | ✅ M4 Phase 5 — Alt+X = spacing **dec**; same |
| C V B N M | ➖ | — |

### Bottom row
| Key | BAR action | Status |
|---|---|---|
| Space | Insert at top of constructor queue | ✅ M3 |

---

## The Q / Ctrl+W discrepancy (documented so it's never re-litigated)

The cards label **Q = "Select Similar Units"** and **Ctrl+W = "Select All Similar
Units."** But `bar-src/luaui/configs/hotkeys/grid_keys.txt` binds:
- `sc_q  → select Visible+_InPrevSel+_ClearSelection_SelectAll+` (narrow-to-on-screen)
- `Ctrl+sc_w → select AllMap+_InPrevSel+_ClearSelection_SelectAll+` (≈ no-op)

These **config strings disagree with the cards.** The cards are hand-authored PNGs
(`gui_keybind_info.lua` → `luaui/images/keybinds/grid_keys*.png`). **We follow the
cards.** The mod's shipped behavior — **Q = same-type on-screen, Ctrl+W = same-type
map-wide** — matches the cards and is CORRECT. (An earlier note calling these
"non-faithful bugs" was wrong; it was derived from the config strings.)

## PA order-states — the M7 mechanism ⚠️ VIEW-LOCAL
PA per-unit order stances are set C++-side via `engine.call('set_order_state',
<category>, <value>)` — but that engine call is **only registered in the action_bar
panel's view**. Calling it from another scene (our `live_game` mod) logs success yet
is a **SILENT NO-OP** (this cost a debug cycle 2026-06-27). From outside the action_bar,
drive it the way PA's own keybinds do (`live_game.js:1477-1519`): **message the panel** —
- `api.panels.action_bar.message('selection_order', <Name>)` → absolute set (`model.selection<Name>()`)
- `api.panels.action_bar.message('toggle_order', <Name>)` → cycle (`model.toggle<Name>OrderIndex()`)

(handlers at `live_game_action_bar.js:516-523`). Categories / `<Name>` values
(`live_game_action_bar.js:289-407`), read back via `selection.<cat>0`:
- **movement**: `Maneuver` / `Roam` / `HoldPosition` → BAR move-state (`;`)
- **weapon** (fire): `FireAtWill` / `ReturnFire` / `HoldFire` → BAR fire-state (`L`)
- **energy**: `Consume` / `Conserve` (icon `_hold`) → **BAR Wait/Hold (`Y`)**

`Conserve` is an *energy* hold (stops energy consumption — for builders/factories it
reads as pause/wait; combat units keep moving/firing). It's PA's closest faithful
analog to BAR's Wait, and the user's intended mapping for `Y`.

## M1 (selection) — net status against the cards
Faithful and **done**: Select Commander (Tab), Select Similar (Q), Select All
Similar (Ctrl+W), Split Army (Ctrl+Q), Select All Units (Ctrl+E), Select Idle
Builder (Ctrl+Tab). Genuine **wall**: Select Idle Transports (Ctrl+R — generic
per-unit idle). **Not a wall** (corrected): Select Waiting Units (Ctrl+Y) — PA's
energy `conserve` IS "waiting/hold"; map-wide select pending a per-unit energy-state
read. Groups (1–0) are **native PA**. So the grid selection layer is essentially
complete.
