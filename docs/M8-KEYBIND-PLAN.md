# M8 — Keybind / Control-Scheme Layer (rebinding) — Plan

Designed 2026-06-30 via a 2-agent design workflow (registry+refactor / panel+capture),
grounded in the mod's current binding layer + PA/Coherent constraints. Architecture
chosen by the user: **Option B — an in-game Coherent rebind panel + a localStorage bind
registry.** No PA-API mutation; client-only; safe in any online game.

## Goal + scope

Make the mod's keybinds **rebindable in-game**, with BAR-like defaults out of the box,
persisted locally, with live conflict detection and reset/import/export.

**Scope (M8):** simple **1:1 Mousetrap binds** are rebindable (all of `selection-binds.js`:
selection, command modes, order-states). **Capture-phase gestures** (build-grid slots,
shift/alt build drags, spacing Alt+Z/X, formation right-drag) are **listed display-only**
(greyed, not editable). **Deferred to a later milestone:** BAR key-chaining (`sc_l,sc_l`
multi-tap combos — not Mousetrap-native), cloud sync (export/import covers portability).

## New / changed files

| File | Change |
|---|---|
| `modules/rebind-config.js` | **NEW** — the `BA.rebind` registry (top-level IIFE, like `BA.util`/`BA.drag`). |
| `modules/rebind.js` | **NEW** — host controller for the panel (`BA.register` module): create/toggle panel, host-side key-capture, host↔panel handlers. |
| `rebind-panel.html` | **NEW** — the Coherent child view (dumb renderer). |
| `modules/selection-binds.js` | **REFACTOR** — register actions into `BA.rebind`; `applyBinds()` + `pushBarKeybinds()` become registry-driven; subscribe `onChange`. |
| `modules/gridmenu.js`, `modules/buildplace.js`, `modules/formations.js` | **+few lines** — register their capture-phase gestures as `rebindable:false` display-only rows. |
| `kb_overlay.html` + `modules/overlay.js` | **+button** — a "Rebind Keys" footer button that opens the rebind panel. |
| `modinfo.json` | add `modules/rebind-config.js` (index 1, after core.js) and `modules/rebind.js` (after selection-binds.js) to `scenes.live_game`. |

⚠️ New files (2 new `.js` scenes + the new panel `.html` src) require a **FULL PA RESTART
once** to register `coui://` before it serves them; after that, edits hot-reload via Ctrl+Shift+R.

---

## 1. `BA.rebind` registry (`modules/rebind-config.js`)

Plain IIFE, builds `window.BarAnnihilation.rebind` at file top level and loads persisted
overrides from localStorage synchronously (so overrides exist before any module `init()`).
It NEVER touches Mousetrap — it's pure state + notification; `selection-binds` owns binding
via `onChange`.

**Private state:** `SCHEMA_V=1`, `LS_KEY='barann.binds'`, `_records{id→record}`,
`_order[]` (registration order), `_overrides{id→key}` (deltas only; `''`=intentionally
unbound), `_rawStore` (unknown ids retained for forward-compat), `_listeners[]`.

**API:**
- `register(id, spec)` — idempotent (last wins; hot-reload safe). Stores record, appends id to `_order`, normalizes `defaultKey`. Does not bind.
- `get(id) → record|null`, `getAll() → [record]` (in `_order`) — **live resolved** records (see below).
- `keyOf(id) → string` — `_overrides[id] ?? defaultKey` (`''` = unbound).
- `set(id, key, opts) → {ok, conflict?, stole?, reason?}` — see algorithm below.
- `resetOne(id)`, `resetAll()`.
- `findConflict(key, exceptId) → id|null` — among **rebindable** actions only (capture-phase display-only excluded).
- `export() → json`, `import(json, opts) → {ok, applied, skipped[]}`.
- `onChange(fn) → unsubscribe`.
- `normalizeKey(str) → string|null`, `isReserved(key) → bool` — exposed for the panel's capture.

**`register(id, spec)` spec:** `{ defaultKey, label, category, run, rebindable=true, event='keydown', displayKey?, order? }`. For display-only rows, pass `{rebindable:false, label, category, displayKey}` (omit `run`/`defaultKey`).

**Live resolved record** (returned by get/getAll): `{ id, label, category, rebindable, displayKey, event, run, defaultKey, key: keyOf(id), isOverridden }`. ⚠️ Records hold the `run` fn — the panel host MUST project to a JSON-safe subset (drop `run`) before any `p.message`/`query` payload.

**`set(id, key, opts)`:**
1. missing record or `rebindable===false` → `{ok:false, reason:'not-rebindable'}`.
2. `key = normalizeKey(key)`; invalid → `{ok:false, reason:'invalid'}`. (`''` is allowed = UNBIND.)
3. `key!=='' && isReserved(key)` → `{ok:false, reason:'reserved'}` (**never-bind digits 1-0**).
4. `other = findConflict(key, id)`; if `other && !opts.allowConflict` → `{ok:false, conflict:other}` (panel prompts).
5. `other && allowConflict` → **steal**: `_overrides[other]=''` (other keeps its record, loses its key); record `stole:other`.
6. apply: `key===defaultKey` → delete `_overrides[id]` (no delta stored); else `_overrides[id]=key`. persist. `_emit()`. `{ok:true, stole?}`.

**`normalizeKey`** — lowercase; split `+`; canonical modifier order `ctrl, alt, shift` (aliases control→ctrl, option→alt; drop cmd/meta/mod); one non-modifier base (Mousetrap names tab/esc/space/… and symbols `; \ [ ]` kept). Mirrors `overlay.js parseKeyStr` so overlay + panel agree. **`isReserved`** — base matches `/^[0-9]$/` (bare or any-modifier digit refused → protects PA's doubleTap control-group recall/center).

## 2. Data model + localStorage

`localStorage['barann.binds']` (matches `barann.pos.*`, `barann.buildspacing`), **deltas only**:
```json
{ "v": 1, "overrides": { "select.commander": "capslock", "cmd.attack": "z" } }
```
- Only ids whose live key ≠ default appear (unbound stored as `""`); back-to-default deletes the entry.
- `v` = schema version; load ignores `v > SCHEMA_V` (keep defaults, log). Load in `try/catch` → fall back to defaults on corruption.
- Merge is **lazy**: `_overrides` loaded at file top; `keyOf()` computes `override ?? default` at read time, so registration order is irrelevant.
- Unknown ids (renamed/removed/another-version) retained in `_rawStore`, re-serialized on save, never applied/shown.

## 3. `applyBinds()` refactor (`selection-binds.js`)

**Before:** a `KEYMAP` keyed by key-string; `applyBinds()` re-binds the same fixed keys each call; `pushBarKeybinds()` uses hardcoded label tables.

**After:** in `init()`, register every action into `BA.rebind` by a stable **actionId** (decoupled from key), defaults unchanged from today. IDs + defaults (verbatim from current KEYMAP):

- Selection: `select.commander`=tab, `select.idleBuilder`=ctrl+tab, `select.split50`=ctrl+q, `select.allUnits`=ctrl+e, `select.sameTypeScreen`=q, `select.sameTypeMap`=ctrl+w
- Order-states: `order.move`=`;`, `order.fire`=l, `order.energy`=y, `order.repeat`=t
- Commands: `cmd.attack`=a, `cmd.reclaim`=e, `cmd.repair`=r, `cmd.fight`=f, `cmd.stop`=g, `cmd.patrol`=h, `cmd.load`=j, `cmd.unload`=u, `cmd.guard`=o, `cmd.dgun`=d, `cmd.factoryGuard`=ctrl+g, `unit.selfDestruct`=ctrl+b
- UI: `ui.overlay`=`\`, `ui.reloadScene`=ctrl+shift+r, `ui.openRebind`=**(unbound default)**

`applyBinds()` becomes registry-driven and **tracks `_boundKeys` to unbind stale keys** (critical — keys now change on rebind):
```js
var _boundKeys = [];
function applyBinds() {
  _boundKeys.forEach(function(k){ try{Mousetrap.unbind(k);}catch(e){} }); _boundKeys = [];
  BA.rebind.getAll().forEach(function(r){
    if (!r.rebindable || !r.run || !r.key) return;      // skip display-only + unbound
    try { Mousetrap.unbind(r.key); Mousetrap.bind(r.key, wrap(r.run), r.event||'keydown'); _boundKeys.push(r.key); }
    catch(e){ BA.err('bind failed '+r.key, e); }
  });
  syncBABinds();   // rebuild BA.binds (key→label) for the overlay, rebindable+bound only
}
```
`wrap(fn)` unchanged (uiBusy gate; returns false → blocks PA). **`pushBarKeybinds()`** replaces hardcoded tables with an id→slot table (`cmd.attack`→commands[1], … `order.repeat`→orders[3]) + a `keyBadge(key)` helper; at default keys it reproduces today's exact badges (`A D O R E H U J G` / `L ; Y T`) byte-for-byte. **Live re-apply:** `BA.rebind.onChange(function(){ applyBinds(); pushBarKeybinds(); })`.

### Invariants applyBinds MUST preserve (do not regress)
- **Never bind digits 1-0** (enforced in `set`/`import` via `isReserved`; no default uses a digit).
- **Total-override**: `Mousetrap.unbind+bind` per action; `wrap` returns false → PA fully blocked.
- **Chords** (`ctrl+`, `shift+`, `ctrl+shift+`) preserved verbatim as defaults.
- **Re-apply hooks** unchanged: `active_dictionary.subscribe(applyBinds)` + `input_maps_reload.progress(→setTimeout(applyBinds,0))`.
- **action_bar push** unchanged behavior; badges identical at defaults.
- **M7 tap-count** (`;`/`l` multiTapOrder) + **cmdMode indices** unchanged — rebinding only changes the trigger key.
- **BA.binds** contract for the overlay maintained (`syncBABinds`).

## 4. Display-only registrations (other modules)

In each module's `init()` (BA.rebind guaranteed present by load order), register capture-phase gestures as `rebindable:false`:
- `gridmenu.js`: `grid.slots` (Q W E R / A S D F / Z X C V), `grid.page` (B), `grid.back` (Esc / release Shift), `grid.queueFront` (Space).
- `buildplace.js`: `build.line` (Shift + Drag), `build.grid` (Shift + Alt + Drag), `build.spacingInc` (Alt + Z), `build.spacingDec` (Alt + X).
- `formations.js`: `formation.move` (Right-Drag).

No behavioral change — these only make the panel able to LIST them (read-only) grouped by category.

## 5. The panel (`modules/rebind.js` + `rebind-panel.html`)

Paired like `overlay.js`↔`kb_overlay.html`. **Host owns all state + keys**; panel is a dumb renderer created **`no-keyboard`** (keys stay on host) but **not `no-input`** (needs clicks). z-index ~1600 (above overlay 1500). Pre-create hidden at init; `.update()` after display toggle to beat the 1000ms hidden-panel poll.

**Layout:** title; category tabs (panel-local switching); scrollable list of rows `[label | key badge | Rebind | Reset]` (row `.changed` orange when overridden; `.readonly` greyed "(fixed)" for display-only); footer `[Reset All | Import | Export | Close]`; three hidden sub-panels — `#rb-capture` ("Press a key… / Esc to cancel" + live preview), `#rb-conflict` ("<combo> already bound to <other>" + Overwrite/Cancel; also invalid-key toast), `#rb-io` (textarea for export/import, the robust path in this old Coherent).

**Host→panel** (`p.message`): `rebind.list {tabs, actions, activeTab}` (actions JSON-safe, with precomputed `comboDisplay`); `rebind.state {mode:'idle'|'capturing'|'conflict'|'invalid'|'io', …}`.
**Panel→host** (`api.Panel.query(parentId, …)` — never `api.Panel.message`): `rebind.start {id}`, `rebind.reset {id}`, `rebind.resetAll`, `rebind.confirm {id, key}`, `rebind.cancelConflict`, `rebind.cancelCapture`, `rebind.export`, `rebind.import {json}`, `rebind.close`.

**Key-capture (host-captured — the crux):** one capture-phase `keydown` at init, gated on state:
- panel hidden → do nothing (don't stop propagation).
- panel open, not capturing → **modal**: swallow every key (preventDefault + stopImmediatePropagation); Esc closes panel.
- capturing (after `rebind.start`) → Esc cancels; pure modifier updates preview; else resolve base via a keyCode→Mousetrap-token map + canonical modifiers → combo; **hard-reject digit base** (`rebind.state{mode:'invalid'}`); `findConflict` → conflict prompt (on `rebind.confirm` steal+set) or直接 `BA.rebind.set` → `{mode:'idle'}` + refresh list. Always swallow the key while capturing.

Host-captures (not panel) because the host owns Mousetrap + `BA.rebind`, and only a host capture-phase handler can reliably suppress PA that frame (proven by `overlay.js`). Panel is `no-keyboard` to avoid Coherent focus flakiness.

**Toggle/integration:** a **"Rebind Keys" button in the kb_overlay footer** → `api.Panel.query(parentId,'overlay:rebind')` → host handler hides the overlay, then shows rebind (each capture handler gated on its own visibility flag, so exactly one is ever active). Plus the unbound `ui.openRebind` action (user can assign it from within the panel — no invented default bind).

---

## 6. BUILD DECOMPOSITION (phases, parallelism, merge order)

**Phase 1 — Foundation (sequential; freezes the API).**
- Create `modules/rebind-config.js` (the full `BA.rebind`).
- Add it to `modinfo.json` `scenes.live_game` at index 1 (after core.js).
- Syntax-check; commit to `main`. *(New file → full PA restart later.)*
- This locks the registry API contract that Phase 2 codes against.

**Phase 2 — Parallel build (two worktrees off the updated `main`; no file overlap).**
- **P2-A — Bind refactor** (`selection-binds.js` register+applyBinds+pushBarKeybinds+onChange; display-only registrations in `gridmenu.js`/`buildplace.js`/`formations.js`). Touches: those 4 files. No modinfo change.
- **P2-B — Panel** (`modules/rebind.js` + `rebind-panel.html` new; "Rebind Keys" button in `kb_overlay.html` + handler in `overlay.js`; add `modules/rebind.js` to modinfo). Touches: 2 new files + kb_overlay.html + overlay.js + modinfo (rebind.js entry only).
- A and B share **no files** (A never touches modinfo; B adds only its own rebind.js scene entry) → clean parallel, either merge order.

**Phase 3 — Integration + review (sequential).**
- Merge P2-A and P2-B to `main`. They integrate purely via the `BA.rebind` API (B's panel calls `set` → fires `onChange` → A's `applyBinds`+`pushBarKeybinds`).
- Syntax-check all shipped `ui/**.js`; adversarial review (bind-regression + Coherent-panel + key-capture lenses); fix confirmed findings.
- Land on `main`.

**Then:** ONE end-to-end playtest (needs the one-time full PA restart): rebind a key, conflict warn + overwrite, reset one / reset all, export/import round-trip, live re-apply (rebound key works immediately, action-bar badge updates), and confirm all existing binds still fire.

## 7. Risks + deferred
- **Stale-key leak** — `applyBinds` MUST unbind old keys via `_boundKeys` (handled).
- **JSON-safe payloads** — host must drop `run` before messaging the panel (handled).
- **Capture-phase shadowing** — a Mousetrap rebind to a letter a capture handler eats (e.g. `q`, `b`, `z` while the grid is open) won't fire in that context; `findConflict` is Mousetrap-only. Panel may soft-warn by cross-checking display-only `displayKey`; enforcement deferred.
- **Two capture handlers** (overlay + rebind) — handoff must hide the overlay first; each gated on its own visibility flag.
- **Layout-dependent keyCode→token** — map the tokens Mousetrap itself uses.
- **New files → full restart** — document clearly; a bare Ctrl+Shift+R will 404 the panel.
- **Deferred:** BAR key-chaining (multi-tap combos), cloud sync (export/import covers it), schema-versioned migration beyond v1.
