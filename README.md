# BAR Annihilation

A **client-side mod for Planetary Annihilation: TITANS** that brings
[Beyond All Reason](https://www.beyondallreason.info/)'s unit-control scheme to
PA — command-queue editing, a grid build menu, area commands, formations, and
smart selection.

It's a **client mod**: local-only, no server sync, no balance impact, and safe
to run in any online match regardless of what other players use. Think of it as
a PA port of BAR's LuaUI control widgets, rewritten in JavaScript against PA's
Coherent UI layer.

> Status: **scaffolding (v0.0.1)** — project set up; control features not yet
> implemented. The full feature spec is researched and locked (see below).

## What's here

| Path | What it is |
|---|---|
| `modinfo.json` | PA client-mod manifest (injects into the `live_game` scene) |
| `ui/mods/com.pa.stephenshorton.bar-annihilation/live_game.js` | Entry point / module bootstrap |
| `ui/mods/com.pa.stephenshorton.bar-annihilation/modules/` | One file per control feature (added per roadmap) |
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

1. Locate the PA data dir (Windows: `%LOCALAPPDATA%\Uber Entertainment\Planetary Annihilation`).
2. Symlink or copy this repo's mod payload into `client_mods/` so a top-level
   `modinfo.json` sits directly inside the mod folder.
3. Launch PA with `--devmode`; the mod shows up under Community Mods → Installed.
4. Debug the JS with the Coherent UI Debugger (`--coherent_port=9999`).

## Open items before real coding

- **`build` number** in `modinfo.json` is a placeholder (`94684`). Update it to
  the build actually tested against once we run it on the installed game.
- **M0 — verify the `live_game` API**: confirm how PA exposes selection, order
  issuing, queue insert/remove, and input hooks. This de-risks the whole
  roadmap and is the next task. Reference mod: Hotbuild2 (proves grid-build is
  feasible).

## Reference source

BAR is open source (GPL, Recoil engine). A sparse Lua-only checkout used to build
the catalog lives at `C:\Users\4step\bar-src` (repo
[`beyond-all-reason/Beyond-All-Reason`](https://github.com/beyond-all-reason/Beyond-All-Reason)
@ `7403bb8`). The catalog cites exact widget files there.
