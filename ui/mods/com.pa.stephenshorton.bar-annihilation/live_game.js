// BAR Annihilation — live_game scene entry point
// ---------------------------------------------------------------------------
// Injected into Planetary Annihilation: TITANS' `live_game` UI scene as a
// CLIENT mod (local-only; no server sync, safe in any online game).
//
// Loaded after the scene's own JS (live_game.js:4916), so the scene globals
// `model`, `api`, `handlers`, `ko`, `engine` and jQuery `$` are available.
//
// NOTE: PA's log captures only the FIRST console.log argument, so every message
// here is a single concatenated string (see log()/warn()/err()).
//
// Spec : docs/BAR-Control-Scheme-Catalog.md   API : docs/API-MAP.md   Plan : docs/ROADMAP.md
// ---------------------------------------------------------------------------

(function () {
  'use strict';

  var VERSION = '0.0.1';
  var TAG = '[bar-annihilation]';

  function log(msg)  { console.log(TAG + ' ' + msg); }
  function warn(msg) { console.warn(TAG + ' ' + msg); }
  function err(msg, e) { console.error(TAG + ' ' + msg + ' :: ' + (e && e.message ? e.message : e)); }

  if (window.BarAnnihilation) { log('already initialized; skipping duplicate entry'); return; }

  // Idempotent, self-scheduling module registry.
  var modules = [], startTimer = null;
  function start() {
    startTimer = null;
    var ready = 0, total = 0;
    for (var i = 0; i < modules.length; i++) {
      var mod = modules[i];
      if (mod.enabled === false || mod._inited) continue;
      total++;
      try { mod.init({ tag: TAG, log: log, warn: warn, err: err }); mod._inited = true; ready++; log('module ready: ' + mod.name); }
      catch (e) { err('module failed: ' + mod.name, e); }
    }
    if (total > 0) log('started ' + ready + '/' + total + ' new module(s)');
  }
  var BarAnnihilation = {
    version: VERSION, log: log, warn: warn, err: err,
    register: function (mod) { modules.push(mod); if (startTimer) clearTimeout(startTimer); startTimer = setTimeout(start, 0); }
  };
  window.BarAnnihilation = BarAnnihilation;
  log('loaded v' + VERSION + ' into live_game');

  // -------------------------------------------------------------------------
  // Shared helpers
  // -------------------------------------------------------------------------
  function uiBusy() {
    try {
      if (typeof model === 'undefined') return true;
      if (model.chatSelected && model.chatSelected()) return true;
      if (model.showLanding && model.showLanding()) return true;
    } catch (e) {}
    return false;
  }

  // Returns {raw, types, units, ids[]} for the current selection, or null.
  function readSelection() {
    if (typeof model === 'undefined' || !model.selection) return null;
    var sel = (typeof model.selection === 'function') ? model.selection() : model.selection;
    if (!sel || !sel.spec_ids) return { raw: sel, types: 0, units: 0, ids: [] };
    var ids = [], types = 0;
    for (var k in sel.spec_ids) {
      if (!sel.spec_ids.hasOwnProperty(k)) continue;
      types++;
      var arr = sel.spec_ids[k];
      if (arr && arr.length) ids = ids.concat(arr);
    }
    return { raw: sel, types: types, units: ids.length, ids: ids };
  }

  // -------------------------------------------------------------------------
  // M0 read-only probe — `\` logs the current selection.
  // -------------------------------------------------------------------------
  BarAnnihilation.register({
    name: 'm0-probe',
    init: function () {
      log('M0 globals — model=' + (typeof window.model) + ' api=' + (typeof window.api) +
        ' api.select=' + (typeof (window.api && api.select)) + ' api.unit=' + (typeof (window.api && api.unit)) +
        ' api.Holodeck=' + (typeof (window.api && api.Holodeck)) +
        ' model.selection=' + (typeof (window.model && model.selection)) + ' $=' + (typeof window.$));
      $(document).on('keydown.barAnnM0', function (e) {
        if (e.which !== 220 || e.altKey || e.ctrlKey || e.shiftKey) return; // bare backslash
        var s = readSelection();
        if (!s) { log('M0 probe: model.selection unavailable'); return; }
        log('M0 selection probe — hasSelection=' + (model.hasSelection ? model.hasSelection() : '?') +
          ' types=' + s.types + ' units=' + s.units);
      });
      log('M0 probe armed — press \\ (backslash) with units selected');
    }
  });

  // -------------------------------------------------------------------------
  // M1 — Selection power tools. Provisional Alt+<key> binds (avoid clobbering
  // PA defaults); we'll move these onto PA's keybind system with BAR-style
  // defaults once the set is settled.
  // -------------------------------------------------------------------------
  BarAnnihilation.register({
    name: 'selection',
    init: function () {
      function safe(label, fn) { return function () { try { fn(); } catch (e) { err('action failed: ' + label, e); } }; }

      // A simple zero-arg api.select.* action.
      function sel(method, desc) {
        return safe(method, function () {
          if (!api.select || typeof api.select[method] !== 'function') { warn('api.select.' + method + ' missing'); return; }
          api.select[method]();
          log('select: ' + desc);
        });
      }

      function split50() {
        var s = readSelection();
        if (!s || s.units < 2) { log('split: need >=2 selected (have ' + (s ? s.units : 0) + ')'); return; }
        var half = s.ids.slice(0, Math.ceil(s.ids.length / 2));
        api.select.unitsById(half);
        log('split 50%: kept ' + half.length + ' of ' + s.units);
      }

      // e.which -> { name, run }. All fire on Alt only (no Ctrl/Shift).
      var BINDS = {
        67: { name: 'all combat (map)',    run: sel('allCombatUnits', 'all combat (map)') },            // Alt+C
        86: { name: 'all combat (screen)', run: sel('allCombatUnitsOnScreen', 'all combat (screen)') }, // Alt+V
        65: { name: 'air (screen)',        run: sel('allAirCombatUnitsOnScreen', 'air (screen)') },     // Alt+A
        71: { name: 'land (screen)',       run: sel('allLandCombatUnitsOnScreen', 'land (screen)') },   // Alt+G
        78: { name: 'naval (screen)',      run: sel('allNavalCombatUnitsOnScreen', 'naval (screen)') }, // Alt+N
        70: { name: 'all factories',       run: sel('allFactories', 'all factories') },                 // Alt+F
        69: { name: 'idle factories',      run: sel('allIdleFactories', 'idle factories') },            // Alt+E
        68: { name: 'idle builder',        run: sel('idleFabber', 'idle builder') },                    // Alt+D
        81: { name: 'commander',           run: sel('commander', 'commander') },                        // Alt+Q
        88: { name: 'split ~50%',          run: safe('split50', split50) }                              // Alt+X
      };

      $(document).on('keydown.barAnnSelection', function (e) {
        if (!e.altKey || e.ctrlKey || e.shiftKey) return;
        if (uiBusy()) return;
        var bind = BINDS[e.which];
        if (!bind) return;
        e.preventDefault();
        e.stopPropagation();
        bind.run();
      });

      log('selection module bound — Alt: C/V combat(map/screen) · A/G/N air/land/naval(screen) · ' +
        'F factories · E idle-factories · D idle-builder · Q commander · X split-50%');
    }
  });
})();
