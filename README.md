# BAR Annihilation

A **client-side mod for Planetary Annihilation: TITANS** that brings
[Beyond All Reason](https://www.beyondallreason.info/)'s unit-control scheme to
PA — command-queue editing, a grid build menu, area commands, formations, and
smart selection.

It's a **client mod**: local-only, no server sync, no balance impact, and safe
to run in any online match regardless of what other players use. Think of it as
a PA port of BAR's LuaUI control widgets, rewritten in JavaScript against PA's
Coherent UI layer.

> Status: **early release (v0.0.1)** — a first cut of the control scheme is
> playable; more BAR features are landing per the roadmap. The full feature spec
> is researched and locked (see below).

## What's here

| Path | What it is |
|---|---|
| `modinfo.json` | PA client-mod manifest (injects into the `live_game` scene) |
| `ui/mods/com.pa.stephenshorton.bar-annihilation/core.js` | Entry point / module bootstrap (defines `window.BarAnnihilation`, loaded first) |
| `ui/mods/com.pa.stephenshorton.bar-annihilation/modules/` | One file per control feature (added per roadmap) |
| `dev/` | Developer-only tools (e.g. a PA API probe) — not loaded or shipped with the mod |
| `docs/BAR-Control-Scheme-Catalog.md` | **The spec** — ~225 BAR control features from source, each with default bind, engine `CMD.*` vs widget, source file, and a PA-porting triage |
| `docs/ROADMAP.md` | Build order, grouped by porting difficulty |
| `docs/research/` | Raw research artifacts (source pass, web cross-check, reconciliation appendix) |

## How PA client mods work (the short version)

- PA's UI is a Coherent UI (embedded-browser) web app. The game is divided into
  named **scenes**; `modinfo.json`'s `scenes` map injects our JS into one of
  them (`live_game` — where unit commanding happens).
- Files live under `ui/mods/<identifier>/` and are referenced via `coui://` URLs.
- The mod talks to the simulation through PA's global `api` / `model` objects.
- Distribution is via PA's in-game **Community Mods** browser (point it at a
  GitHub zip); for development we just drop the folder into the local
  `client_mods/` directory under the PA data dir.

## Local dev install

1. PA data dir: `%LOCALAPPDATA%\Uber Entertainment\Planetary Annihilation`.
2. Install by junctioning this repo into the data dir's **`mods\`** folder — the engine
   mounts on-disk `mods\` as the virtual `/client_mods/` (a PA naming gotcha; it is **not**
   a folder literally named `client_mods`):
   ```powershell
   New-Item -ItemType Junction `
     -Path "$env:LOCALAPPDATA\Uber Entertainment\Planetary Annihilation\mods\com.pa.stephenshorton.bar-annihilation" `
     -Target "C:\Users\<you>\projects\bar-annihilation"
   ```
   A junction keeps edits live (no copy step).
3. Launch PA → **Community Mods → Installed** → enable "BAR Annihilation" (writes
   `mods\mods.json` mount order). Reload/restart so the mod's `ui/` mounts.
4. UI `console.log` lands in `log\PA-<timestamp>.txt` as `[JS/game]` lines; or attach the
   Coherent UI Debugger with launch option `--coherent_port=9999`.

## Implemented so far (v0.0.1)

- **Smart selection** (real BAR Grid keys, full PA override): select commander
  (Tab), cycle idle builders (Ctrl+Tab), split selection in half (Ctrl+Q), select
  all combat units (Ctrl+E), select same type on screen (Q). Control groups keep
  PA's native double-tap-to-center behavior.
- **Grid build menu** for factories and mobile builders — real build icons, BAR
  build categories (Economy / Combat / Utility / Production on Z X C V), a top row
  of quick-access buildings, click + hotkey batching (Shift ×5, Ctrl to cancel,
  hold Space = front of queue), and ghost placement for fabbers via PA's native
  build mode.
- **Keyboard overlay** — a BAR-style visual keyboard of the current binds, toggled
  by the backslash key or a movable on-screen **Keys** button.

## Next

See `docs/ROADMAP.md`. Upcoming: deeper command-queue editing, area commands,
formations, and BAR's richer `select` filter DSL. A few features (per-unit-health
selection, idle/queue state) may need an optional companion server mod — see the docs.

## Reference source

BAR is open source (GPL, Recoil engine). A sparse Lua-only checkout used to build
the catalog lives at `C:\Users\4step\bar-src` (repo
[`beyond-all-reason/Beyond-All-Reason`](https://github.com/beyond-all-reason/Beyond-All-Reason)
@ `7403bb8`). The catalog cites exact widget files there.
