// BAR Annihilation — live_game scene entry point
// ---------------------------------------------------------------------------
// Injected into Planetary Annihilation: TITANS' `live_game` UI scene as a
// CLIENT mod (local-only; no server sync, safe in any online game).
//
// PA's UI runs on Coherent UI (an embedded browser). Client mods are loaded
// into the scene's JS context (after the scene's own JS — see live_game.js:4916
// `loadMods(scene_mod_list['live_game'])`), so the scene globals `model`, `api`,
// `handlers`, `ko`, `engine` and jQuery `$` are all available here.
//
// Feature modules are loaded as additional entries in modinfo.json's
// scenes.live_game array and register themselves on window.BarAnnihilation.
//
// Spec  : docs/BAR-Control-Scheme-Catalog.md   (features to port)
// API   : docs/API-MAP.md                       (catalog → PA call mapping)
// Plan  : docs/ROADMAP.md                       (build order)
// ---------------------------------------------------------------------------

(function () {
  'use strict';

  var VERSION = '0.0.1';
  var TAG = '[bar-annihilation]';

  // Idempotent, self-scheduling module registry. Module files load as separate
  // scene entries (order/timing not guaranteed), so each register() bumps a
  // microtask-deferred start(); start() only inits modules it hasn't yet.
  if (window.BarAnnihilation) {
    console.log(TAG, 'already initialized; skipping duplicate entry load');
    return;
  }

  var modules = [];
  var startTimer = null;

  function start() {
    startTimer = null;
    var ready = 0, total = 0;
    for (var i = 0; i < modules.length; i++) {
      var mod = modules[i];
      if (mod.enabled === false || mod._inited) continue;
      total++;
      try {
        mod.init({ tag: TAG, version: VERSION });
        mod._inited = true;
        ready++;
        console.log(TAG, 'module ready:', mod.name);
      } catch (e) {
        console.error(TAG, 'module failed:', mod.name, e);
      }
    }
    if (total > 0)
      console.log(TAG, 'started ' + ready + '/' + total + ' new module(s)');
  }

  var BarAnnihilation = {
    version: VERSION,
    register: function (mod) {
      modules.push(mod);
      if (startTimer) clearTimeout(startTimer);
      startTimer = setTimeout(start, 0);
    }
  };
  window.BarAnnihilation = BarAnnihilation;
  console.log(TAG, 'loaded v' + VERSION + ' into live_game');

  // -------------------------------------------------------------------------
  // M0 read-only probe — verifies the foundation on first launch. Confirms the
  // API surface we depend on is present, and lets you log the live selection
  // with a key. Remove once M1 is verified.
  // -------------------------------------------------------------------------
  BarAnnihilation.register({
    name: 'm0-probe',
    init: function (ctx) {
      var t = ctx.tag;
      var has = function (v) { return typeof v; };
      console.log(t, 'M0 globals —',
        'model=' + has(window.model),
        'api=' + has(window.api),
        'api.select=' + has(window.api && api.select),
        'api.unit=' + has(window.api && api.unit),
        'api.Holodeck=' + has(window.api && api.Holodeck),
        'model.selection=' + has(window.model && model.selection),
        '$=' + has(window.$));

      $(document).on('keydown.barAnnM0', function (e) {
        if (e.which !== 220) return; // backslash "\"
        if (typeof model === 'undefined' || !model.selection) {
          console.log(t, 'M0 probe: no model.selection');
          return;
        }
        var sel = (typeof model.selection === 'function') ? model.selection() : model.selection;
        var hasSel = (typeof model.hasSelection === 'function') ? model.hasSelection() : undefined;
        var types = 0, units = 0;
        if (sel && sel.spec_ids) {
          for (var k in sel.spec_ids) {
            if (!sel.spec_ids.hasOwnProperty(k)) continue;
            types++;
            if (sel.spec_ids[k] && sel.spec_ids[k].length) units += sel.spec_ids[k].length;
          }
        }
        console.log(t, 'M0 selection probe — hasSelection=' + hasSel +
          ' types=' + types + ' units=' + units, sel);
      });
      console.log(t, 'M0 probe armed — select units and press \\ (backslash) to log selection');
    }
  });
})();
