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
  // M1 — Selection on real BAR (Grid) keys, with TOTAL override of PA.
  //
  // PA dispatches its hotkeys through Mousetrap (window.Mousetrap) from a global
  // `active_dictionary` ko.computed. To make our action the ONLY thing that fires
  // on a key (fully blocking PA's), we Mousetrap.unbind(key) then
  // Mousetrap.bind(key, ourFn) AFTER PA binds — and re-apply whenever PA rebuilds
  // its keymap (it does `Mousetrap.reset(); Mousetrap.bind(active_dictionary())`
  // on settings/scene reload, which wipes ours).
  //
  // BAR-pure (Grid) selection set. Only actions with a clean PA api.select
  // mapping are included. Notably PA has NO "select all units" API, so BAR's
  // Ctrl+E (select all) is intentionally omitted.
  // -------------------------------------------------------------------------
  BarAnnihilation.register({
    name: 'bar-binds',
    init: function () {
      if (typeof Mousetrap === 'undefined' || !Mousetrap.bind) {
        warn('Mousetrap unavailable — BAR key binds disabled');
        return;
      }

      function split50() {
        var s = readSelection();
        if (!s || s.units < 2) { log('BAR split: need >=2 selected (have ' + (s ? s.units : 0) + ')'); return; }
        var half = s.ids.slice(0, Math.ceil(s.ids.length / 2));
        api.select.unitsById(half);
        log('BAR split 50%: kept ' + half.length + ' of ' + s.units);
      }

      // Mousetrap key string (BAR Grid default) -> action. These OVERRIDE and
      // fully block PA's action on the same physical key.
      var KEYMAP = {
        'tab':      function () { api.select.commander(); log('BAR: select commander'); },     // BAR Grid: commander
        'ctrl+tab': function () { api.select.idleFabber(); log('BAR: select idle builder'); }, // BAR Grid: idle builder
        'ctrl+q':   split50                                                                    // BAR Grid: split 50%
      };

      function wrap(fn) {
        return function () {
          if (uiBusy()) return;          // defer to PA while typing in chat / on landing
          try { fn(); } catch (e) { err('BAR bind action failed', e); }
          return false;                  // Mousetrap: preventDefault + stopPropagation (blocks PA)
        };
      }

      function applyBinds() {
        var keys = Object.keys(KEYMAP), n = 0;
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          try { Mousetrap.unbind(k); Mousetrap.bind(k, wrap(KEYMAP[k]), 'keydown'); n++; }
          catch (e) { err('failed to bind ' + k, e); }
        }
        log('BAR binds applied (' + n + ') — Tab=commander, Ctrl+Tab=idle-builder, Ctrl+Q=split-50% (PA actions on these keys blocked)');
      }

      applyBinds();

      // Re-apply after PA rebuilds its keymap (settings change / scene reload).
      // Our subscriber is added after PA's, so it runs right after PA's reset+bind.
      try {
        if (typeof active_dictionary !== 'undefined' && active_dictionary && active_dictionary.subscribe)
          active_dictionary.subscribe(function () { applyBinds(); });
      } catch (e) { warn('could not hook active_dictionary: ' + (e && e.message)); }
      try {
        if (typeof input_maps_reload !== 'undefined' && input_maps_reload && input_maps_reload.progress)
          input_maps_reload.progress(function () { setTimeout(applyBinds, 0); });
      } catch (e) {}
    }
  });
})();
