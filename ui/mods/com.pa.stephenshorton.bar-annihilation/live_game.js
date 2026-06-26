// BAR Annihilation — live_game scene entry point
// ---------------------------------------------------------------------------
// Injected into Planetary Annihilation: TITANS' `live_game` UI scene as a
// CLIENT mod (local-only; no server sync, safe in any online game).
//
// Loaded after the scene's own JS (live_game.js:4916), so scene globals
// `model`, `api`, `handlers`, `ko`, `engine`, `Mousetrap`, `active_dictionary`
// and jQuery `$` are available.
//
// NOTE: PA's log captures only the FIRST console.log argument, so all messages
// here are single concatenated strings (see log()/warn()/err()).
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
    binds: {}, // key-string -> human label, published by feature modules (read by the overlay)
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
  // M1 — Selection on real BAR (Grid) keys, with TOTAL override of PA.
  // We Mousetrap.unbind(key)+bind(key, ourFn) after PA binds, and re-apply when
  // PA rebuilds its keymap, so only our action fires (PA's is fully blocked).
  // -------------------------------------------------------------------------
  BarAnnihilation.register({
    name: 'bar-binds',
    init: function () {
      if (typeof Mousetrap === 'undefined' || !Mousetrap.bind) { warn('Mousetrap unavailable — BAR key binds disabled'); return; }

      function split50() {
        var s = readSelection();
        if (!s || s.units < 2) { log('BAR split: need >=2 selected (have ' + (s ? s.units : 0) + ')'); return; }
        var half = s.ids.slice(0, Math.ceil(s.ids.length / 2));
        api.select.unitsById(half);
        log('BAR split 50%: kept ' + half.length + ' of ' + s.units);
      }

      // Mousetrap key string (BAR Grid default) -> { label, run }.
      var KEYMAP = {
        'tab':      { label: 'Select commander',    run: function () { api.select.commander(); log('BAR: select commander'); } },
        'ctrl+tab': { label: 'Select idle builder', run: function () { api.select.idleFabber(); log('BAR: select idle builder'); } },
        'ctrl+q':   { label: 'Split selection 50%', run: split50 },
        '\\':       { label: 'Toggle key overlay',  run: function () { if (BarAnnihilation.overlayToggle) BarAnnihilation.overlayToggle(); else warn('overlay toggle not ready yet'); } },
        'ctrl+shift+r': { label: 'Reload UI scene (dev)', run: function () { try { log('reloading live_game scene...'); api.game.debug.reloadScene(api.Panel.pageId); } catch (e) { err('scene reload failed', e); } } }
      };

      // Publish our binds for the keyboard overlay.
      for (var bk in KEYMAP) { if (KEYMAP.hasOwnProperty(bk)) BarAnnihilation.binds[bk] = KEYMAP[bk].label; }

      function wrap(fn) {
        return function () {
          if (uiBusy()) return;          // defer to PA while typing / on landing
          try { fn(); } catch (e) { err('BAR bind action failed', e); }
          return false;                  // Mousetrap: preventDefault + stop (blocks PA)
        };
      }

      function applyBinds() {
        var keys = Object.keys(KEYMAP), n = 0;
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          try { Mousetrap.unbind(k); Mousetrap.bind(k, wrap(KEYMAP[k].run), 'keydown'); n++; }
          catch (e) { err('failed to bind ' + k, e); }
        }
        log('BAR binds applied (' + n + ') — Tab=commander, Ctrl+Tab=idle-builder, Ctrl+Q=split-50% (PA blocked on these)');
      }
      applyBinds();

      try { if (typeof active_dictionary !== 'undefined' && active_dictionary && active_dictionary.subscribe) active_dictionary.subscribe(function () { applyBinds(); }); }
      catch (e) { warn('could not hook active_dictionary: ' + (e && e.message)); }
      try { if (typeof input_maps_reload !== 'undefined' && input_maps_reload && input_maps_reload.progress) input_maps_reload.progress(function () { setTimeout(applyBinds, 0); }); }
      catch (e) {}
    }
  });

  // -------------------------------------------------------------------------
  // Keyboard overlay — rendered as a Coherent child VIEW (<panel>), NOT a <div>.
  // PA's live_game host document is composited BELOW the 3D world, so a plain
  // <div> appended to body never paints (it only captures input). The visible HUD
  // is built from <panel src="coui://..."> child views; engine.call('panel.create')
  // draws them on top. So our overlay is its own <panel> pointing at kb_overlay.html
  // (same mod dir, served live via the junction). See docs/API-MAP.md.
  // -------------------------------------------------------------------------
  BarAnnihilation.register({
    name: 'keyboard-overlay',
    init: function () {
      var PANEL_ID = 'barann-overlay-panel';
      var SRC = 'coui://ui/mods/com.pa.stephenshorton.bar-annihilation/kb_overlay.html';
      var visible = false, el = null;

      function ensurePanel() {
        if (el && document.getElementById(PANEL_ID)) return el;
        var stale = document.getElementById(PANEL_ID);
        if (stale) { try { $(stale).remove(); } catch (e) {} }
        el = document.createElement('panel');                // MUST be <panel>, not <div>
        el.id = PANEL_ID;
        el.setAttribute('src', SRC);
        el.setAttribute('fit', 'dock');                      // full viewport (like PA #popup / #settings)
        el.setAttribute('no-input', '');                     // passive: mouse passes through to the world
        el.setAttribute('no-keyboard', '');                  // keep keys on the host so our toggle / Esc still fire
        el.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:1500;';
        document.body.appendChild(el);
        try { api.Panel.bindElement(el); log('overlay panel bound: ' + PANEL_ID + ' -> ' + SRC); }
        catch (e) { err('overlay panel bind failed', e); }
        return el;
      }

      function show() { ensurePanel(); if (el) el.style.display = ''; visible = true; log('overlay -> shown (panel view)'); }
      function hide() { if (el) el.style.display = 'none'; visible = false; log('overlay -> hidden'); }

      var toggleLock = false;
      function toggle() {
        if (toggleLock) return;                              // collapse Mousetrap + raw double-dispatch for one press
        toggleLock = true; setTimeout(function () { toggleLock = false; }, 0);
        if (visible) hide(); else show();
      }
      BarAnnihilation.overlayToggle = toggle;                // bound to the backslash key via bar-binds (Mousetrap)

      var TOGGLE_WHICH = 220; // backslash key code (raw-keydown fallback; Mousetrap path is primary)
      $(document).on('keydown.barAnnOverlay', function (e) {
        if (e.which === TOGGLE_WHICH && !e.ctrlKey && !e.altKey && !e.shiftKey) { e.preventDefault(); toggle(); return false; }
        if (visible && e.which === 27) { hide(); return false; } // Esc closes
      });

      log('keyboard overlay ready (panel view)');
    }
  });

})();
