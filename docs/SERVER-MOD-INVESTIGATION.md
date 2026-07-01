# Server-Mod Investigation — can a PA server mod reclaim the walls?

Investigated 2026-07-01 (3-agent research over PA's shipped `server-script/` + `stockmods/server/`,
a direct grep of the server unit API, and web/community research). **Question:** several BAR
features are ⛔ walls for our *client* mod because the command queue + unit runtime state live in
PA's C++ sim. Could a **server mod** reach them?

## TL;DR — No. The walls are a PA-engine limit, not a client-mod limit. Close this path.

Two independent dead-ends, either one fatal:

1. **PA's sim is a closed C++ box.** The JS `server-script` layer is a *match-orchestration* layer
   (spawn units, diplomacy, vision, pause/speed, win conditions) — it is **not** a sim-scripting /
   gadget layer. The server-side `unit` object is thin metadata; there is **no** per-unit HP,
   command queue, target, idle, or build-quota accessor, and **no** per-unit mutator. This is the
   fundamental difference from BAR: Recoil/Spring runs Lua **gadgets inside the sim** with full
   `CMD.*` + `UnitID` access; PA exposes nothing equivalent to mods.
2. **Even if it could, server mods don't run where it matters.** Server mods load only in
   player-hosted **custom/local** lobbies (auto-downloaded on join), **never** in official
   matchmaking / ranked. That breaks our "client-side, safe in any online game" premise for the
   sake of features that still wouldn't work.

## What the PA server-script layer actually is

`media/server-script/` is JS that runs on the game server and drives *match setup and rules*, not
unit micro. Verified capabilities (`states/playing.js`, `playing_shared.js`):

- **Enumerate:** `sim.units[]` (+`.length`), `sim.armies` / `sim.armies.getArmy(id)`, `sim.planets[]`.
- **Read a unit — the ENTIRE surface** (grep of the whole server-script; these are the only unit
  members referenced anywhere): `unit.army` / `unit.army_index`, `unit.isUnitType(type)`,
  `unit.pos`, `unit.orient`, `unit.spec` / `unit.unit_spec`, `unit.planet_index`, `unit.dead`.
- **Mutate the sim (not units):** `sim.units.push({army,spec,planet,position,orientation})` (spawn),
  `sim.setDiplomaticState(a,b,state)`, `army.defeated=`, `army.createAIBrain()`,
  `sim.armies.setControlBits()/setVisionBits()`, `sim.paused=`, `sim.speed=`.
- **Hooks:** `sim.onReady`, `sim.onShutdown` only. **No** per-tick / unit-created / unit-damaged /
  command-issued callbacks.

What is **not** present anywhere in the server-script (verified by grep — zero hits):
`unit.health`/`hp`/`max_health`, `command_queue`/`orders`/`insertCommand`/`popCommand`,
`setTarget`/`.target`, `isIdle`/`idle`, `build_quota`/`priority`. The runtime state and the command
queue live in the C++ sim and are simply not projected into the JS layer.

## The client↔server bridge exists — but has nothing useful to call

There **is** a general message pipe (so this wasn't a "can they even talk" question):

- Client → server: `model.send_message(type, payload, cb)` → `engine.call('conn_send_message', …)`
  (`ui/main/shared/js/helpers.js:719`).
- Server handler: `server.setHandlers({ type: fn })`, reply via `server.respond(msg).succeed/fail`
  or `client.message({message_type, payload})` / `server.broadcast(…)` (`server_utils.js:176`).
- Server → client receive: `engine.on('process_message', …)` → `handlers[type](payload)`
  (`helpers.js:690`).

So a client-mod ⇄ server-mod round-trip is *mechanically* possible. It's moot: the server handler
has no API to read HP / rewrite a queue / set a target, so there's nothing for it to do for any wall.

## Deployment reality (the second dead-end)

| Game mode | Server mod runs? |
|---|---|
| Official ranked 1v1 / matchmaking | ❌ No — vanilla + client UI mods only (server mods are the anti-cheat boundary) |
| Custom lobby (server browser) | ✅ Yes — host enables + uploads; joiners auto-download |
| Local skirmish vs AI | ✅ Yes |

Sources: PA modding wiki (palobby), planetaryannihilation.wiki.gg "Online Game", Community Update
94684. A server-mod companion would only ever help in custom/local games — a small slice of play —
and would abandon the "works in any online match" property that makes the client mod valuable.

## Community precedent (corroboration)

The most powerful known community server mod, **Puppetmaster** (JustinLove) — a sandbox spectator
tool — can *create units* and *issue standard orders* (even self-destruct), but **cannot** touch
command queues or persistent targeting. **Legion Expansion**, **Statera**, etc. only edit static
**unit specs** (JSON: `max_health`, `command_caps`, `guard_radius`, roster). Nobody, in a decade of
PA modding, has done per-unit-HP-based selection or queue insert/remove from a mod — because the
engine doesn't expose it. Unit-spec edits are static, game-wide, and apply only to newly-spawned
units, so they reclaim none of our per-unit runtime walls.

## Wall-by-wall verdict

| Wall | Server-reachable? | Why |
|---|---|---|
| Insert-at-front / remove-pop queue item (CMD.INSERT/REMOVE) | ❌ | Queue is C++-internal; no server accessor or mutator |
| Per-unit HP → "select damaged units" | ❌ | Server `unit` has no `.health`/`.max_health`; runtime HP is C++-internal |
| Add-to-group / toggle-group-in-selection | ❌ | Selection/control-groups are a client concept; no server verb |
| Generic per-unit idle | ❌ | No `unit.idle`/queue length server-side; no per-tick hook |
| Set-target (persistent priority target) | ❌ | No `setTarget`/target state exposed; `guard_radius` (spec) ≠ per-unit target |
| Build-quota / builder-priority | ❌ | No runtime build-management API; specs are static/global |

## Recommendation

**Close the server-mod path — treat these six as permanent PA-engine limits, not TODOs.** They are
BAR features that depend on Recoil's in-sim Lua gadget layer, which PA fundamentally lacks. Keep the
mod **client-only** (its strength: works in any online match, zero server dependency). Redirect
effort to features that ARE reachable from the client — polish and depth on selection / build /
formations / command-mode UX — rather than chasing sim state that no PA mod can touch.

This supersedes the ROADMAP's "server-mod investigation to reclaim the HP/idle/queue walls" note:
investigated, negative, closed.
