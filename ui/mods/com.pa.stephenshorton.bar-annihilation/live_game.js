// BAR Annihilation — live_game scene entry point
// ---------------------------------------------------------------------------
// Injected into Planetary Annihilation: TITANS' `live_game` UI scene as a
// CLIENT mod (local-only; no server sync, safe in any online game).
//
// PA's UI runs on Coherent UI (an embedded browser). A client mod is loaded
// into a scene's JS context and drives the game through PA's global `api` /
// `model` objects and the scene's Knockout view-models. This file is just the
// bootstrap: individual control features register themselves as modules so we
// can enable/disable them independently — the same per-widget model BAR uses.
//
// Spec : docs/BAR-Control-Scheme-Catalog.md  (every feature we're porting)
// Plan : docs/ROADMAP.md                      (build order, by porting difficulty)
// ---------------------------------------------------------------------------

(function () {
  'use strict';

  var VERSION = '0.0.1';
  var TAG = '[bar-annihilation]';

  var modules = [];

  var BarAnnihilation = {
    version: VERSION,

    // mod: { name: string, init: function(ctx), enabled?: boolean }
    register: function (mod) {
      modules.push(mod);
    },

    start: function () {
      console.log(TAG, 'loading v' + VERSION + ' into live_game');
      var ready = 0;
      for (var i = 0; i < modules.length; i++) {
        var mod = modules[i];
        if (mod.enabled === false) continue;
        try {
          mod.init({ tag: TAG });
          ready++;
          console.log(TAG, 'module ready:', mod.name);
        } catch (e) {
          console.error(TAG, 'module failed:', mod.name, e);
        }
      }
      console.log(TAG, 'ready (' + ready + '/' + modules.length + ' modules active)');
    }
  };

  // Expose for feature modules and for poking from the Coherent debugger console.
  window.BarAnnihilation = BarAnnihilation;

  // ---------------------------------------------------------------------------
  // M0 — VERIFY THE live_game SCENE API before wiring any real behavior:
  //   * read current selection            (PA `model`/`api` selection surface)
  //   * issue orders                       (move / attack / build / queue ops)
  //   * queue insert + remove              (the BAR "insert at front / pop" family)
  //   * hook keyboard & mouse input        (for binds and world-space drags)
  //   * the keybind / config surface       (how PA registers hotkeys)
  // Cross-reference a known-good control mod (e.g. Hotbuild2) for the real calls.
  //
  // M1 — FIRST FEATURE: command-queue editing
  //   shift-append (confirm native) · insert-at-front · pop/remove-from-front.
  //   Once the API is mapped, drop the module in ./modules/ and register it, e.g.:
  //     // BarAnnihilation.register(QueueEditing);
  // ---------------------------------------------------------------------------

  BarAnnihilation.start();
})();
