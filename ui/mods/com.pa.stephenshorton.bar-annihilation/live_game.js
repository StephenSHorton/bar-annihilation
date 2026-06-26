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

      function selectAllCombat() {
        api.select.allCombatUnits();
        log('BAR: select all combat units');
      }

      // BAR sc_q: select all on-screen units matching the type(s) currently selected.
      function selectSameTypeOnScreen() {
        var sel = (typeof model !== 'undefined' && model.selection)
          ? ((typeof model.selection === 'function') ? model.selection() : model.selection) : null;
        var types = (sel && sel.spec_ids) ? Object.keys(sel.spec_ids) : [];
        if (!types.length) { log('BAR: select same type -- nothing selected'); return; }
        var hd = (typeof api !== 'undefined' && api.Holodeck) ? api.Holodeck.focused : null;
        if (!hd || !hd.selectMatchingTypes) { warn('BAR: no focused holodeck for selectMatchingTypes'); return; }
        hd.selectMatchingTypes('default', types);
        log('BAR: select same type on screen (' + types.length + ' type(s))');
      }

      // BAR 'focus': center (and track) the camera on the current selection.
      function focusSelection() {
        try { if (api.camera && api.camera.track) api.camera.track(true); } catch (e) {}
      }
      function selectThenFocus(promise) {
        if (promise && promise.then) promise.then(focusSelection); else setTimeout(focusSelection, 30);
      }

      // BAR Ctrl+sc_w: select all units on the current planet matching selected type(s).
      function selectSameTypeOnPlanet() {
        var sel = (typeof model !== 'undefined' && model.selection)
          ? ((typeof model.selection === 'function') ? model.selection() : model.selection) : null;
        var types = (sel && sel.spec_ids) ? Object.keys(sel.spec_ids) : [];
        if (!types.length) { log('BAR: select same type (planet) -- nothing selected'); return; }
        var hd = (typeof api !== 'undefined' && api.Holodeck) ? api.Holodeck.focused : null;
        if (!hd) { warn('BAR: no focused holodeck'); return; }
        var planet = -1;
        try { planet = api.camera.getFocus(hd.id).planet(); } catch (e) {}
        api.select.onPlanetWithTypeFilter(planet, types, []);
        log('BAR: select same type on planet ' + planet + ' (' + types.length + ' type(s))');
      }

      // Mousetrap key string (BAR Grid default) -> { label, run }.
      var KEYMAP = {
        'tab':      { label: 'Select commander',    run: function () { selectThenFocus(api.select.commander()); log('BAR: select commander (focus)'); } },
        'ctrl+tab': { label: 'Select idle builder', run: function () { selectThenFocus(api.select.idleFabber()); log('BAR: select idle builder (focus)'); } },
        'ctrl+q':   { label: 'Split selection 50%', run: split50 },
        'ctrl+e':   { label: 'Select all combat',   run: selectAllCombat },
        'q':        { label: 'Select same type (on screen)', run: selectSameTypeOnScreen },
        'ctrl+w':   { label: 'Select same type (whole planet)', run: selectSameTypeOnPlanet },
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
        log('BAR binds applied (' + n + ' keys, PA blocked): ' + keys.join(' '));
      }
      applyBinds();

      try { if (typeof active_dictionary !== 'undefined' && active_dictionary && active_dictionary.subscribe) active_dictionary.subscribe(function () { applyBinds(); }); }
      catch (e) { warn('could not hook active_dictionary: ' + (e && e.message)); }
      try { if (typeof input_maps_reload !== 'undefined' && input_maps_reload && input_maps_reload.progress) input_maps_reload.progress(function () { setTimeout(applyBinds, 0); }); }
      catch (e) {}
    }
  });

  // -------------------------------------------------------------------------
  // Keyboard overlay — a BAR-style visual keyboard, rendered as a Coherent child
  // VIEW (<panel>) because the live_game host document is composited BELOW the 3D
  // world and never paints body DOM. The panel loads kb_overlay.html (a dumb
  // renderer); THIS module builds the keyboard HTML from PA's keybind defs +
  // BarAnnihilation.binds and pushes it via panel.message('bar.render', {html}).
  // Toggle with the backslash key; hold Ctrl/Shift/Alt for modifier layers. See API-MAP.md.
  // -------------------------------------------------------------------------
  BarAnnihilation.register({
    name: 'keyboard-overlay',
    init: function () {
      var PANEL_ID = 'barann-overlay-panel';
      var SRC = 'coui://ui/mods/com.pa.stephenshorton.bar-annihilation/kb_overlay.html';
      var TOGGLE_WHICH = 220; // backslash
      var visible = false, el = null, idx = null, pushTimer = null, layersCache = null;
      var mods = { ctrl: false, alt: false, shift: false };

      var MOD = 'modk';
      var BT = String.fromCharCode(96); // backtick / tilde key
      var BS = String.fromCharCode(92); // backslash key
      var AP = String.fromCharCode(39); // apostrophe / quote key
      var ROWS = [
        [['esc','Esc'],['f1','F1'],['f2','F2'],['f3','F3'],['f4','F4'],['f5','F5'],['f6','F6'],['f7','F7'],['f8','F8'],['f9','F9'],['f10','F10'],['f11','F11'],['f12','F12']],
        [[BT,BT],['1','1'],['2','2'],['3','3'],['4','4'],['5','5'],['6','6'],['7','7'],['8','8'],['9','9'],['0','0'],['-','-'],['=','='],['backspace','Bksp','wide']],
        [['tab','Tab','wide'],['q','Q'],['w','W'],['e','E'],['r','R'],['t','T'],['y','Y'],['u','U'],['i','I'],['o','O'],['p','P'],['[','['],[']',']'],[BS,BS]],
        [['capslock','Caps','wide',MOD],['a','A'],['s','S'],['d','D'],['f','F'],['g','G'],['h','H'],['j','J'],['k','K'],['l','L'],[';',';'],[AP,AP],['enter','Enter','wide']],
        [['shift','Shift','wide',MOD],['z','Z'],['x','X'],['c','C'],['v','V'],['b','B'],['n','N'],['m','M'],[',',','],['.','.'],['/','/'],['shift','Shift','wide',MOD]],
        [['ctrl','Ctrl','wide',MOD],['alt','Alt','wide',MOD],['space','Space','wide'],['alt','Alt','wide',MOD],['ctrl','Ctrl','wide',MOD]]
      ];
      var ALIAS = { 'return':'enter','escape':'esc','del':'delete','spacebar':'space','control':'ctrl','option':'alt' };

      function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
      function locStrip(s) { return s ? String(s).replace(/^!LOC:/, '') : ''; }
      function currentCombo() { var a=[]; if(mods.ctrl)a.push('ctrl'); if(mods.alt)a.push('alt'); if(mods.shift)a.push('shift'); return a.join('+'); }

      function parseKeyStr(str) {
        if (!str || typeof str !== 'string') return null;
        var parts = str.toLowerCase().split('+'), m = { ctrl:false, alt:false, shift:false }, base = null;
        for (var i = 0; i < parts.length; i++) {
          var p = parts[i].trim();
          if (p === 'ctrl' || p === 'control') m.ctrl = true;
          else if (p === 'alt' || p === 'option') m.alt = true;
          else if (p === 'shift') m.shift = true;
          else if (p === 'mod' || p === 'meta' || p === 'cmd' || p === 'command') { /* ignore */ }
          else if (p) base = ALIAS[p] || p;
        }
        if (!base) return null;
        var a = []; if (m.ctrl) a.push('ctrl'); if (m.alt) a.push('alt'); if (m.shift) a.push('shift');
        return { mod: a.join('+'), base: base };
      }

      function buildIndex() {
        var ix = {};
        function add(mod, base, label, ours) { if (!base) return; (ix[mod] = ix[mod] || {}); if (!ix[mod][base] || ours) ix[mod][base] = { label: label, ours: !!ours }; }
        try {
          var defs = api.settings && api.settings.definitions && api.settings.definitions.keyboard && api.settings.definitions.keyboard.settings;
          if (defs) {
            for (var k in defs) {
              if (!defs.hasOwnProperty(k)) continue;
              var d = defs[k]; if (!d || d.type !== 'keybind') continue;
              if (typeof k !== 'string' || k.charAt(0) === '_') continue;     // skip synthetic keys
              var title = (typeof d.title === 'string') ? locStrip(d.title) : '';
              if (!title) continue;                                           // skip entries without a clean string label
              var val = null;
              try { if (api.settings.value) val = api.settings.value('keyboard', k); } catch (e) {}
              if (!val) val = d.default;
              if (typeof val !== 'string' && !(val instanceof Array)) continue;
              var vals = (val instanceof Array) ? val : [val];
              for (var vi = 0; vi < vals.length; vi++) { var pk = parseKeyStr(vals[vi]); if (pk) add(pk.mod, pk.base, title, false); }
            }
          }
        } catch (e) { warn('overlay: PA keybind read failed: ' + (e && e.message)); }
        var ours = (window.BarAnnihilation && BarAnnihilation.binds) || {};
        for (var key in ours) { if (!ours.hasOwnProperty(key)) continue; var pk2 = parseKeyStr(key); if (pk2) add(pk2.mod, pk2.base, ours[key], true); }
        return ix;
      }

      function buildLayerRows(combo) {
        if (!idx) idx = buildIndex();
        var layer = idx[combo] || {};
        var hasC = combo.indexOf('ctrl') >= 0, hasA = combo.indexOf('alt') >= 0, hasS = combo.indexOf('shift') >= 0;
        var h = '';
        for (var r = 0; r < ROWS.length; r++) {
          h += '<div class="kb-row">';
          for (var c = 0; c < ROWS[r].length; c++) {
            var cell = ROWS[r][c], token = cell[0], cap = cell[1], cls = 'kb-key', act = '';
            for (var x = 2; x < cell.length; x++) cls += ' ' + cell[x];
            var isMod = (token === 'ctrl' || token === 'alt' || token === 'shift');
            if (isMod) {
              if ((token === 'ctrl' && hasC) || (token === 'alt' && hasA) || (token === 'shift' && hasS)) cls += ' held';
            } else {
              var b = layer[token];
              if (b) { cls += ' bound' + (b.ours ? ' ours' : ''); act = '<div class="kb-act">' + esc(b.label) + '</div>'; }
            }
            h += '<div class="' + cls + '"><div class="kb-cap">' + esc(cap) + '</div>' + act + '</div>';
          }
          h += '</div>';
        }
        return h;
      }

      var TABS = [
        { combo: '',      label: 'No modifier' },
        { combo: 'ctrl',  label: 'Ctrl' },
        { combo: 'alt',   label: 'Alt' },
        { combo: 'shift', label: 'Shift' }
      ];

      function buildLayers() {
        if (!idx) idx = buildIndex();
        var out = {};
        for (var i = 0; i < TABS.length; i++) out[TABS[i].combo] = buildLayerRows(TABS[i].combo);
        return out;
      }

      function heldCombo() {
        var n = (mods.ctrl ? 1 : 0) + (mods.alt ? 1 : 0) + (mods.shift ? 1 : 0);
        if (n !== 1) return '';
        return mods.ctrl ? 'ctrl' : (mods.alt ? 'alt' : 'shift');
      }

      function ensurePanel() {
        if (el && document.getElementById(PANEL_ID)) return el;
        var stale = document.getElementById(PANEL_ID);
        if (stale) { try { $(stale).remove(); } catch (e) {} }
        el = document.createElement('panel');                // MUST be <panel>, not <div>
        el.id = PANEL_ID;
        el.setAttribute('src', SRC);
        el.setAttribute('fit', 'dock');
        el.setAttribute('no-keyboard', '');                  // keep keyboard on host (our capture handler drives it)
        el.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:1500;';
        document.body.appendChild(el);
        try { api.Panel.bindElement(el); log('overlay panel bound: ' + PANEL_ID); }
        catch (e) { err('overlay panel bind failed', e); }
        return el;
      }

      function pushState() {
        var p = api.panels[PANEL_ID];
        if (!p || p.id === undefined || p.id < 0) return;    // wait until panel.create resolved
        if (!layersCache) layersCache = buildLayers();
        try { p.message('bar.render', { tabs: TABS, layers: layersCache, held: heldCombo() }); } catch (e) { warn('overlay push failed: ' + (e && e.message)); }
      }

      function show() {
        ensurePanel();
        idx = null; layersCache = null;                       // recompute (binds may have changed)
        if (el) el.style.display = '';
        visible = true;
        pushState();
        if (pushTimer) clearInterval(pushTimer);
        pushTimer = setInterval(function () { if (visible) pushState(); else { clearInterval(pushTimer); pushTimer = null; } }, 350);
        log('overlay -> shown (panel view)');
      }
      function hide() {
        visible = false; mods.ctrl = mods.alt = mods.shift = false;
        if (el) el.style.display = 'none';
        if (pushTimer) { clearInterval(pushTimer); pushTimer = null; }
        log('overlay -> hidden');
      }

      var toggleLock = false;
      function toggle() {
        if (toggleLock) return;                              // collapse Mousetrap + raw double-dispatch
        toggleLock = true; setTimeout(function () { toggleLock = false; }, 0);
        if (visible) hide(); else show();
      }
      BarAnnihilation.overlayToggle = toggle;                // bound to backslash via bar-binds (Mousetrap)

      function updMods(e, down) {
        var nc = e.ctrlKey, na = e.altKey, ns = e.shiftKey, ch = false;
        if (e.which === 17) nc = down; if (e.which === 18) na = down; if (e.which === 16) ns = down;
        if (nc !== mods.ctrl) { mods.ctrl = nc; ch = true; } if (na !== mods.alt) { mods.alt = na; ch = true; } if (ns !== mods.shift) { mods.shift = ns; ch = true; }
        return ch;
      }

      // Capture phase: runs BEFORE PA's Mousetrap/handlers. While the overlay is
      // open we swallow EVERY key (so no game action fires) and act only on our
      // controls; while closed we only grab the open key.
      function onKeyDownCap(e) {
        if (visible) {
          if (e.which === 27 || (e.which === TOGGLE_WHICH && !e.ctrlKey && !e.altKey && !e.shiftKey)) { hide(); }
          else if (updMods(e, true)) pushState();
          e.preventDefault(); e.stopImmediatePropagation(); return false;
        }
        if (e.which === TOGGLE_WHICH && !e.ctrlKey && !e.altKey && !e.shiftKey) {
          e.preventDefault(); e.stopImmediatePropagation(); toggle(); return false;
        }
      }
      function onKeyUpCap(e) {
        if (visible) { if (updMods(e, false)) pushState(); e.preventDefault(); e.stopImmediatePropagation(); return false; }
      }
      document.addEventListener('keydown', onKeyDownCap, true);
      document.addEventListener('keyup', onKeyUpCap, true);

      log('keyboard overlay ready (panel view) — press the backslash key to toggle; hold Ctrl/Shift/Alt for layers');
    }
  });
})();
