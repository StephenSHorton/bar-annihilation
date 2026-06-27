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

      // BAR Ctrl+E (grid) = `select AllMap++_ClearSelection_SelectAll+` — ALL own units
      // map-wide (not just combat). Routes through the select-engine's allmap source.
      function selectAllUnits() {
        if (BarAnnihilation.select && BarAnnihilation.select.run) BarAnnihilation.select.run({ source: 'allmap', conclusion: 'selectall' });
        else { warn('select-engine not ready; falling back to all-combat'); api.select.allCombatUnits(); }
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

      // Same-type MAP-WIDE (off-screen included) — the keyboard counterpart of BAR's
      // Ctrl+double-click. Enumerate all own units via the engine's allmap source and
      // keep those whose spec is in the current selection. (Needs client enumeration:
      // there is no engine verb for specific-type map-wide — that's why the old Ctrl+W
      // was dropped before we had getArmyUnits.)
      function selectSameTypeMapWide() {
        var sel = readSelection(), specs = (sel && sel.raw && sel.raw.spec_ids) ? Object.keys(sel.raw.spec_ids) : [];
        if (!specs.length) { log('BAR: same-type map-wide -- nothing selected'); return; }
        if (!BarAnnihilation.select || !BarAnnihilation.select.run) { warn('select-engine not ready for same-type map-wide'); return; }
        var set = {}; for (var i = 0; i < specs.length; i++) set[specs[i]] = true;
        BarAnnihilation.select.run({ source: 'allmap', filters: [{ name: 'specin', arg: set }], conclusion: 'selectall' });
        log('BAR: select same type map-wide (' + specs.length + ' type(s))');
      }

      // BAR 'focus': center (and track) the camera on the current selection.
      function focusSelection() {
        try { if (api.camera && api.camera.track) api.camera.track(true); } catch (e) {}
      }
      function selectThenFocus(promise) {
        if (promise && promise.then) promise.then(focusSelection); else setTimeout(focusSelection, 30);
      }
      // Stable signature (sorted unit ids) of the current selection.
      function selSig() { var s = readSelection(); return s.ids.slice().sort().join(','); }
      // Run a selector that changes selection; center the camera ONLY if the
      // selection ends up UNCHANGED (BAR "press again, while already selected, to
      // go there"). Selection updates arrive async, so we watch one selection event.
      function selectThenFocusOnRepeat(selectorFn, label) {
        var before = selSig(), done = false, sub = null;
        function finish(changed) {
          if (done) return; done = true;
          try { if (sub) sub.dispose(); } catch (e) {}
          if (!changed) focusSelection();
          log('BAR: ' + label + (changed ? '' : ' (focus)'));
        }
        if (model.selection && model.selection.subscribe) {
          sub = model.selection.subscribe(function () { finish(selSig() !== before); });
          setTimeout(function () { finish(false); }, 250);   // no event => unchanged => center
        } else { setTimeout(function () { finish(selSig() !== before); }, 60); }
        try { selectorFn(); } catch (e) { err('BAR select failed', e); }
      }

      // BAR Ctrl+Tab: cycle ONE idle builder at a time (BAR's "SelectOne"). PA's
      // legacy api.select.idleFabber() is unreliable (doesn't select/cycle), so we
      // drive the native, reliable api.select.idleFabbers(planet) (selects ALL idle
      // fabbers), read the resulting set via a one-shot selection subscription, then
      // narrow to a single builder and advance a cycle pointer on each press.
      var idleCycle = { last: null };
      function currentPlanet() {
        // focus_planet_id (camera.js:379) is what idleFabbers/onPlanet expect; NOT .planet().
        // The camera api defaults it to -1 and only updates on a planet switch, but PA's
        // own idle button defaults to 0 (control_group_bar.js:47) — so coerce -1 -> 0.
        try { var pid = api.camera.getFocus(api.Holodeck.focused.id).planetId(); return (typeof pid === 'number' && pid >= 0) ? pid : 0; } catch (e) { return 0; }
      }
      function selectIdleBuilderCycle() {
        var pid = currentPlanet();
        if (!model.selection || !model.selection.subscribe) { api.select.idleFabbers(pid); return; }
        var done = false, sub = null;
        function finish(ids) {
          if (done) return; done = true;
          try { if (sub) sub.dispose(); } catch (e) {}
          if (!ids || !ids.length) { log('BAR: no idle builders (planet ' + pid + ')'); return; }
          ids = ids.slice().sort();
          var nextIx = (ids.indexOf(idleCycle.last) + 1) % ids.length;   // not-found(-1) -> 0
          idleCycle.last = ids[nextIx];
          api.select.unitsById([ids[nextIx]]);
          setTimeout(focusSelection, 30);
          log('BAR: idle builder ' + (nextIx + 1) + '/' + ids.length);
        }
        sub = model.selection.subscribe(function () { finish(readSelection().ids); });
        setTimeout(function () { finish(null); }, 250);   // fallback if nothing idle / no change
        api.select.idleFabbers(pid);
      }

      // Mousetrap key string (BAR Grid default) -> { label, run }.
      var KEYMAP = {
        'tab':      { label: 'Select commander',    run: function () { selectThenFocusOnRepeat(function () { api.select.commander(); }, 'select commander'); } },
        'ctrl+tab': { label: 'Select idle builder', run: selectIdleBuilderCycle },
        'ctrl+q':   { label: 'Split selection 50%', run: split50 },
        'ctrl+e':   { label: 'Select all units',    run: selectAllUnits },
        'q':        { label: 'Select same type (on screen)', run: selectSameTypeOnScreen },
        'ctrl+w':   { label: 'Select same type (map-wide)',  run: selectSameTypeMapWide },
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

  // -------------------------------------------------------------------------
  // Selection engine — reusable enumerate -> filter -> conclude pipeline that
  // reimplements BAR's `select Source+Filter+Conclusion` DSL on PA's API.
  // Exposed as BarAnnihilation.select.run(spec). Design: docs/SELECT-ENGINE.md.
  // Tiers: SpecCache (sync def traits) | getUnitState (async runtime) | shadow
  // trackers (groups, later). Each filter declares needsState so a pure-def
  // query never pays the async cost. Nothing here is bound to a key yet — the
  // faithful BAR presets get wired in after the live probe confirms the async
  // surface (see docs/SELECT-ENGINE.md build order).
  // -------------------------------------------------------------------------
  BarAnnihilation.register({
    name: 'select-engine',
    init: function () {
      function inArr(a, v) { if (!a) return false; for (var i = 0; i < a.length; i++) if (a[i] === v) return true; return false; }
      function whenThen(v, cb) { return (v && typeof v.then === 'function') ? v.then(cb) : cb(v); }
      function worldView() { try { return api.getWorldView ? api.getWorldView(0) : null; } catch (e) { return null; } }
      // Planet indices to enumerate (getArmyUnits(idx,-1) returns EMPTY — probe 2026-06-26 — so loop).
      function planetIndices() { try { var pl = model.planetListState ? model.planetListState() : null; if (pl && pl.planets && pl.planets.length) { var a = []; for (var i = 0; i < pl.planets.length; i++) a.push(i); return a; } } catch (e) {} return [0]; }
      // Promise.all shim for Coherent thenables (no native Promise.all in old Coherent).
      function allThen(arr, cb) { var n = arr.length, res = new Array(n), done = 0; if (!n) { cb([]); return; } for (var i = 0; i < n; i++) { (function (ix) { var v = arr[ix]; if (v && typeof v.then === 'function') v.then(function (r) { res[ix] = r; if (++done === n) cb(res); }, function () { res[ix] = null; if (++done === n) cb(res); }); else { res[ix] = v; if (++done === n) cb(res); } })(i); } }

      // ---- SpecCache: per-def blueprint traits from model.unitSpecs (sync).
      // Cache only KNOWN specs so a too-early call can't poison the cache.
      var specCache = {};
      function specOf(spec) {
        if (specCache[spec]) return specCache[spec];
        var raw = (typeof model !== 'undefined' && model.unitSpecs) ? model.unitSpecs[spec] : null;
        var t = { spec: spec, known: !!raw };
        if (raw) {
          var cmds = raw.commands || [];
          t.structure = !!raw.structure;
          t.mobile = !raw.structure;
          t.canBuild = !!raw.canBuild || !!(raw.build && raw.build.length);
          t.hasWeapons = (raw.dps > 0) || (raw.damage > 0) || (raw.max_range > 0) || !!(raw.projectiles && raw.projectiles.length);
          t.transport = inArr(cmds, 'Load') || inArr(cmds, 'Unload');
          t.manualFire = inArr(cmds, 'FireSecondaryWeapon');
          t.maxRange = raw.max_range || 0;
          t.commands = cmds;
          specCache[spec] = t;
        }
        return t;
      }

      // ---- current selection helpers --------------------------------------
      function curSpecIds() { var s = readSelection(); return (s && s.raw && s.raw.spec_ids) ? s.raw.spec_ids : {}; }
      function curIdSet() { var set = {}, s = readSelection(), ids = s ? s.ids : []; for (var i = 0; i < ids.length; i++) set[ids[i]] = true; return set; }
      function pairsFrom(map) { var out = []; for (var spec in map) { if (!map.hasOwnProperty(spec)) continue; var arr = map[spec] || []; for (var i = 0; i < arr.length; i++) out.push({ id: arr[i], spec: spec }); } return out; }

      // ---- SOURCES: () -> (array | Promise<array>) of {id, spec} -----------
      var SOURCES = {
        prevselection: function () { return pairsFrom(curSpecIds()); },
        allmap: function () {                 // async; planetIdx=-1 returns EMPTY, so fan out per planet and merge.
          var wv = worldView(); if (!wv || !wv.getArmyUnits) { warn('select: getArmyUnits unavailable'); return []; }
          var ai = (model.armyIndex ? model.armyIndex() : 0), idxs = planetIndices(), calls = [];
          for (var i = 0; i < idxs.length; i++) calls.push(wv.getArmyUnits(ai, idxs[i]));
          return { then: function (cb) {
            allThen(calls, function (maps) {
              var merged = {};
              for (var m = 0; m < maps.length; m++) { var mp = maps[m]; if (!mp) continue; for (var spec in mp) { if (mp.hasOwnProperty(spec)) merged[spec] = (merged[spec] || []).concat(mp[spec] || []); } }
              cb(pairsFrom(merged));
            });
          } };
        }
      };

      // ---- FILTERS: name -> (invert, arg) -> { needsState, test(u) } -------
      // u = { id, spec, t:specTraits, state }. invert flips the predicate.
      function defPred(inv, fn) { return { needsState: false, test: function (u) { var r = !!fn(u); return inv ? !r : r; } }; }
      function statePred(inv, fn) { return { needsState: true, test: function (u) { var r = !!fn(u); return inv ? !r : r; } }; }
      function specSeg(spec, name) { return !!spec && (spec.indexOf('/' + name + '.') >= 0 || spec.indexOf('/' + name + '/') >= 0); }
      var FILTERS = {
        builder:    function (inv) { return defPred(inv, function (u) { return u.t.canBuild; }); },
        building:   function (inv) { return defPred(inv, function (u) { return u.t.structure; }); },
        mobile:     function (inv) { return defPred(inv, function (u) { return u.t.mobile; }); },
        weapons:    function (inv) { return defPred(inv, function (u) { return u.t.hasWeapons; }); },
        transport:  function (inv) { return defPred(inv, function (u) { return u.t.transport; }); },
        manualfire: function (inv) { return defPred(inv, function (u) { return u.t.manualFire; }); },
        inprevsel:  function (inv) { return defPred(inv, function (u) { return !!_prevSet[u.id]; }); },
        idmatches:  function (inv, a) { return defPred(inv, function (u) { return u.spec === a || specSeg(u.spec, a); }); },
        specin:     function (inv, set) { return defPred(inv, function (u) { return !!(set && set[u.spec]); }); }
        // NO health filters: probe 2026-06-26 confirmed getUnitState carries no HP
        // (only {planet,unit_spec,pos,army,orient}) and no other client path exposes
        // per-unit health, so BAR's damaged-select is a HARD WALL. statePred is kept
        // for future POSITION-based filters (getUnitState.pos: FromMouse/closest).
        // category/aircraft/radar/jammer -> async spec GET ('spec:'+id has unit_types[]) — next increment.
      };
      var _prevSet = {};   // snapshot of the selection at run() start (for inprevsel)

      // ---- CONCLUSIONS ----------------------------------------------------
      var cycleState = {};
      function keysOf(o) { var a = []; for (var k in o) if (o.hasOwnProperty(k)) a.push(isNaN(+k) ? k : +k); return a; }
      function selectIds(ids, append) {
        if (append) { var set = curIdSet(); for (var i = 0; i < ids.length; i++) set[ids[i]] = true; ids = keysOf(set); }
        if (!ids.length) { if (!append) try { api.select.empty(); } catch (e) {} return ids; }
        try { api.select.unitsById(ids); } catch (e) { err('select: unitsById failed', e); }
        return ids;
      }
      function conclude(name, arg, ids, append, cycleKey) {
        ids = ids.slice().sort();
        if (name === 'selectnum')  return selectIds(ids.slice(0, Number(arg) || 0), append);
        if (name === 'selectpart') return selectIds(ids.slice(0, Math.ceil(ids.length * (Number(arg) || 0) / 100)), append);
        if (name === 'selectone') {
          if (!ids.length) return ids;
          var k = cycleKey || 'default', ix = (ids.indexOf(cycleState[k]) + 1) % ids.length;
          cycleState[k] = ids[ix];
          try { api.select.unitsById([ids[ix]]); if (api.camera && api.camera.track) api.camera.track(true); } catch (e) {}
          return [ids[ix]];
        }
        return selectIds(ids, append);   // selectall (default)
      }

      // ---- run(spec) ------------------------------------------------------
      function run(spec) {
        spec = spec || {};
        var srcFn = SOURCES[(spec.source || 'prevselection').toLowerCase()];
        if (!srcFn) { warn('select: unknown source ' + spec.source); return; }
        _prevSet = curIdSet();
        var preds = [], needState = false, defs = spec.filters || [];
        for (var i = 0; i < defs.length; i++) {
          var fn = FILTERS[(defs[i].name || '').toLowerCase()];
          if (!fn) { warn('select: unportable/unknown filter "' + defs[i].name + '" (skipped)'); continue; }
          var p = fn(!!defs[i].invert, defs[i].arg); preds.push(p); if (p.needsState) needState = true;
        }
        function finish(list) {
          var ids = []; for (var i = 0; i < list.length; i++) ids.push(list[i].id);
          var picked = conclude((spec.conclusion || 'selectall').toLowerCase(), spec.conclusionArg, ids, !!spec.append, spec.cycleKey);
          log('select: source=' + (spec.source || 'prevselection') + ' kept=' + ids.length + ' picked=' + (picked ? picked.length : 0));
          return picked;
        }
        return whenThen(srcFn(spec.sourceArg), function (pairs) {
          pairs = pairs || [];
          var stage = [];
          for (var i = 0; i < pairs.length; i++) {
            var u = pairs[i]; u.t = specOf(u.spec); var ok = true;
            for (var j = 0; j < preds.length; j++) { if (!preds[j].needsState && !preds[j].test(u)) { ok = false; break; } }
            if (ok) stage.push(u);
          }
          if (!needState) return finish(stage);
          var ids = []; for (var i = 0; i < stage.length; i++) ids.push(stage[i].id);
          var wv = worldView();
          if (!wv || !wv.getUnitState || !ids.length) { warn('select: runtime state needed but unavailable'); return finish([]); }
          return wv.getUnitState(ids).then(function (sm) {
            var out = [];
            for (var i = 0; i < stage.length; i++) {
              var u = stage[i]; u.state = sm ? (sm[u.id] || sm[i] || null) : null; var ok = true;
              for (var j = 0; j < preds.length; j++) { if (preds[j].needsState && !preds[j].test(u)) { ok = false; break; } }
              if (ok) out.push(u);
            }
            return finish(out);
          });
        });
      }

      BarAnnihilation.select = { run: run, _specOf: specOf, _sources: SOURCES, _filters: FILTERS };
      log('select-engine ready (sync def tier live; async state/category/group tiers pending live probe)');
    }
  });

  // -------------------------------------------------------------------------
  // Capability probe (read-only) — dumps PA's live runtime surface to the log so
  // we can confirm the SELECT-ENGINE assumptions before committing async tiers.
  // Trigger Ctrl+Shift+P in a loaded match with some units selected (ideally a
  // mix incl. a builder + a damaged unit). Answers the checklist in
  // docs/SELECT-ENGINE.md. PA keeps only the FIRST console.log arg, so each line
  // is a single concatenated string.
  // -------------------------------------------------------------------------
  BarAnnihilation.register({
    name: 'probe',
    init: function () {
      function out(label, obj) {
        var s; try { s = (typeof obj === 'string') ? obj : JSON.stringify(obj); } catch (e) { s = '[unstringifiable: ' + (e && e.message) + ']'; }
        log('PROBE ' + label + ': ' + s);
      }
      function safe(label, fn) { try { fn(); } catch (e) { log('PROBE ' + label + ' ERROR: ' + (e && e.message ? e.message : e)); } }
      function wv() { try { return api.getWorldView ? api.getWorldView(0) : null; } catch (e) { return null; } }
      function hd() { try { return api.Holodeck.focused; } catch (e) { return null; } }
      function firstSpec(sel) { return (sel && sel.raw && sel.raw.spec_ids) ? (Object.keys(sel.raw.spec_ids)[0] || null) : null; }
      function countMap(m) { var n = 0; for (var k in m) { if (m.hasOwnProperty(k) && m[k] && m[k].length) n += m[k].length; } return n; }

      function run() {
        log('PROBE ===== begin (mod v' + VERSION + ') =====');
        var sel = readSelection();
        out('selection.summary', { types: sel ? sel.types : -1, units: sel ? sel.units : -1 });
        safe('selection.raw', function () { out('selection.raw', sel ? sel.raw : null); });
        safe('army', function () { out('army', { armyIndex: (model.armyIndex ? model.armyIndex() : 'n/a'), armyId: (model.armyId ? model.armyId() : 'n/a') }); });

        safe('unitSpecs', function () {
          var spec = firstSpec(sel); if (!spec) { log('PROBE unitSpecs: no selection'); return; }
          var us = (model.unitSpecs && model.unitSpecs[spec]) ? model.unitSpecs[spec] : null;
          out('unitSpecs[' + spec + '].keys', us ? Object.keys(us) : null);
          if (us) out('unitSpecs.traits', { structure: us.structure, canBuild: us.canBuild, build_len: (us.build || []).length, commands: us.commands, dps: us.dps, damage: us.damage, max_range: us.max_range, unit_types: us.unit_types });
        });

        safe('getUnitState', function () {
          var w = wv(); if (!w || !w.getUnitState) { log('PROBE getUnitState: no worldview'); return; }
          var ids = sel ? sel.ids : []; if (!ids.length) { log('PROBE getUnitState: nothing selected'); return; }
          var one = ids[0];
          w.getUnitState([one]).then(function (res) {
            out('getUnitState.raw', res);
            var u = (res && res[one]) ? res[one] : ((res && res.length) ? res[0] : res);
            out('getUnitState.unitKeys', u ? Object.keys(u) : null);
            out('getUnitState.probeFields', u ? { hasHealth: !!u.health, hasLocation: !!u.location, hasPosition: !!u.position, hasToolDetails: !!u.tool_details, hasIdle: (u.idle !== undefined), hasCommandCount: (u.command_count !== undefined), hasCloak: (u.cloaked !== undefined || u.cloak !== undefined) } : null);
          }, function (e) { log('PROBE getUnitState rejected: ' + e); });
        });

        safe('getArmyUnits', function () {
          var w = wv(); if (!w || !w.getArmyUnits) { log('PROBE getArmyUnits: no worldview'); return; }
          var ai = (model.armyIndex ? model.armyIndex() : 0);
          w.getArmyUnits(ai, -1).then(function (m) { out('getArmyUnits(idx=' + ai + ',planet=-1)', { specs: m ? Object.keys(m).length : 0, units: countMap(m), firstSpec: m ? Object.keys(m)[0] : null }); }, function (e) { log('PROBE getArmyUnits(-1) rejected: ' + e); });
          w.getArmyUnits(ai, 0).then(function (m) { out('getArmyUnits(idx=' + ai + ',planet=0)', { units: countMap(m) }); }, function () {});
        });

        safe('specGET', function () {
          var spec = firstSpec(sel); if (!spec || typeof $ === 'undefined' || !$.get) { log('PROBE specGET: skip'); return; }
          function report(tag, data) { var d = data; try { if (typeof data === 'string') d = JSON.parse(data); } catch (e) {} out('specGET' + tag + '.keys', d ? Object.keys(d) : null); if (d) out('specGET' + tag + '.unit_types', d.unit_types); }
          $.get(spec).done(function (d) { report('[/' + spec + ']', d); }).fail(function () {
            $.get('spec:' + spec).done(function (d) { report('[spec:]', d); }).fail(function () { log('PROBE specGET: both /spec and spec: failed'); });
          });
        });

        safe('raycast', function () {
          var h = hd(); if (!h || !h.raycastTerrain) { log('PROBE raycast: no holodeck.raycastTerrain'); return; }
          var cx = Math.floor((window.innerWidth || 1920) / 2), cy = Math.floor((window.innerHeight || 1080) / 2);
          var r = h.raycastTerrain(cx, cy);
          if (r && r.then) r.then(function (hit) { out('raycastTerrain.hit', hit); }, function (e) { log('PROBE raycast rejected: ' + e); });
          else out('raycastTerrain.sync', r);
        });

        safe('groups', function () {
          out('selectionGroupCounts', (model.selectionGroupCounts ? model.selectionGroupCounts() : 'n/a'));
          out('hasCaptureGroup', !!(api.select && api.select.captureGroup));
        });

        safe('engineSelfTest', function () {
          if (!BarAnnihilation.select || !BarAnnihilation.select._specOf) { log('PROBE engineSelfTest: engine not ready'); return; }
          var specIds = (sel && sel.raw) ? sel.raw.spec_ids : {}, total = 0, builders = 0, mobile = 0, weapons = 0;
          for (var spec in specIds) { if (!specIds.hasOwnProperty(spec)) continue; var t = BarAnnihilation.select._specOf(spec), arr = specIds[spec] || []; total += arr.length; if (t.canBuild) builders += arr.length; if (t.mobile) mobile += arr.length; if (t.hasWeapons) weapons += arr.length; }
          out('engineSelfTest', { total: total, builders: builders, mobile: mobile, weapons: weapons });
        });

        log('PROBE ===== end (async results print on the lines above as they resolve) =====');
      }

      BarAnnihilation.probe = run;
      // Capture-phase listener (like the overlay's) — survives PA's repeated
      // Mousetrap.reset() on keymap rebuilds, which a Mousetrap bind would not.
      // Ctrl+Shift+P, P = keyCode 80.
      function onProbeKey(e) {
        if (e.ctrlKey && e.shiftKey && !e.altKey && (e.which === 80 || e.keyCode === 80)) {
          e.preventDefault(); e.stopImmediatePropagation();
          if (!uiBusy()) run();
          return false;
        }
      }
      document.addEventListener('keydown', onProbeKey, true);
      log('probe ready — select units, press Ctrl+Shift+P to dump the capability surface to the log');
    }
  });
})();
