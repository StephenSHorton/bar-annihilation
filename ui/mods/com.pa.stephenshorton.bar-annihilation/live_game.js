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
        'ctrl+q':   { label: 'Split selection 50%', run: split50 }
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
  // Keyboard overlay — a BAR-style visual keyboard showing every bound key.
  // Reads PA's keybind definitions (api.settings.definitions.keyboard) for
  // labels + our BarAnnihilation.binds (highlighted). Toggle with `\`; hold
  // Ctrl/Shift/Alt to see those modifier layers.
  // -------------------------------------------------------------------------
  BarAnnihilation.register({
    name: 'keyboard-overlay',
    init: function () {
      var TOGGLE_WHICH = 220; // backslash "\"
      var visible = false, $root = null, idxCache = null;
      var mods = { ctrl: false, alt: false, shift: false };

      if (!document.getElementById('barann-overlay-style')) {
        var css =
          '#barann-overlay{position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;' +
          'background:rgba(8,12,18,0.8);font-family:Exo,"Segoe UI",sans-serif;color:#cfe3f2;}' +
          '#barann-overlay.show{display:flex;}' +
          '#barann-kb{padding:18px 22px;background:rgba(14,20,28,0.97);border:1px solid #2b6c9c;border-radius:10px;box-shadow:0 8px 44px rgba(0,0,0,.6);}' +
          '#barann-kb .kb-title{font-size:16px;color:#7fd1ff;letter-spacing:.04em;}' +
          '#barann-kb .kb-sub{font-size:11px;margin:3px 0 12px;color:#8aa3b8;}' +
          '#barann-kb .kb-row{display:flex;gap:5px;margin-bottom:5px;}' +
          '#barann-kb .kb-key{position:relative;width:56px;height:56px;border:1px solid #33485c;border-radius:6px;background:#162230;' +
          'display:flex;flex-direction:column;padding:4px 5px;box-sizing:border-box;overflow:hidden;}' +
          '#barann-kb .kb-key .kb-cap{font-size:11px;color:#9fb3c6;font-weight:600;}' +
          '#barann-kb .kb-key .kb-act{font-size:8.5px;line-height:1.05;margin-top:auto;color:#bcd;white-space:normal;}' +
          '#barann-kb .kb-key.bound{background:#1c3145;border-color:#3f7fb0;}' +
          '#barann-kb .kb-key.bound .kb-act{color:#d4e6f5;}' +
          '#barann-kb .kb-key.ours{background:#2a2410;border-color:#d2a73a;}' +
          '#barann-kb .kb-key.ours .kb-act{color:#ffd877;}' +
          '#barann-kb .kb-key.modk{background:#22303f;}' +
          '#barann-kb .kb-key.modk.held{background:#2f5a3a;border-color:#5fbf7f;color:#bfffce;}' +
          '#barann-kb .kb-key.wide{width:auto;min-width:56px;flex:1;}' +
          '#barann-kb .legend{margin-top:10px;font-size:10px;color:#8aa3b8;display:flex;gap:18px;}' +
          '#barann-kb .swatch{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:middle;}';
        var style = document.createElement('style');
        style.id = 'barann-overlay-style'; style.textContent = css; document.head.appendChild(style);
      }

      var MOD = 'modk';
      var ROWS = [
        [['esc','Esc'],['f1','F1'],['f2','F2'],['f3','F3'],['f4','F4'],['f5','F5'],['f6','F6'],['f7','F7'],['f8','F8'],['f9','F9'],['f10','F10'],['f11','F11'],['f12','F12']],
        [['`','`'],['1','1'],['2','2'],['3','3'],['4','4'],['5','5'],['6','6'],['7','7'],['8','8'],['9','9'],['0','0'],['-','-'],['=','='],['backspace','Bksp','wide']],
        [['tab','Tab','wide'],['q','Q'],['w','W'],['e','E'],['r','R'],['t','T'],['y','Y'],['u','U'],['i','I'],['o','O'],['p','P'],['[','['],[']',']'],['\\','\\']],
        [['capslock','Caps','wide',MOD],['a','A'],['s','S'],['d','D'],['f','F'],['g','G'],['h','H'],['j','J'],['k','K'],['l','L'],[';',';'],['\'','\''],['enter','Enter','wide']],
        [['shift','Shift','wide',MOD],['z','Z'],['x','X'],['c','C'],['v','V'],['b','B'],['n','N'],['m','M'],[',',','],['.','.'],['/','/'],['shift','Shift','wide',MOD]],
        [['ctrl','Ctrl','wide',MOD],['alt','Alt','wide',MOD],['space','Space','wide'],['alt','Alt','wide',MOD],['ctrl','Ctrl','wide',MOD]]
      ];

      var ALIAS = { 'return':'enter','escape':'esc','del':'delete','spacebar':'space','control':'ctrl','option':'alt' };
      function locStrip(s) { return s ? String(s).replace(/^!LOC:/, '') : ''; }
      function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
      function currentCombo() { var a=[]; if(mods.ctrl)a.push('ctrl'); if(mods.alt)a.push('alt'); if(mods.shift)a.push('shift'); return a.join('+'); }

      function parseKeyStr(str) {
        if (!str || typeof str !== 'string') return null;
        var parts = str.toLowerCase().split('+'), m = { ctrl:false, alt:false, shift:false }, base = null;
        for (var i = 0; i < parts.length; i++) {
          var p = parts[i].trim();
          if (p === 'ctrl' || p === 'control') m.ctrl = true;
          else if (p === 'alt' || p === 'option') m.alt = true;
          else if (p === 'shift') m.shift = true;
          else if (p === 'mod' || p === 'meta' || p === 'cmd' || p === 'command') { /* ignore meta */ }
          else if (p) base = ALIAS[p] || p;
        }
        if (!base) return null;
        var a = []; if (m.ctrl) a.push('ctrl'); if (m.alt) a.push('alt'); if (m.shift) a.push('shift');
        return { mod: a.join('+'), base: base };
      }

      function buildIndex() {
        var idx = {};
        function add(mod, base, label, ours) { if (!base) return; (idx[mod] = idx[mod] || {}); if (!idx[mod][base] || ours) idx[mod][base] = { label: label, ours: !!ours }; }
        try {
          var defs = api.settings && api.settings.definitions && api.settings.definitions.keyboard && api.settings.definitions.keyboard.settings;
          if (defs) {
            for (var k in defs) {
              if (!defs.hasOwnProperty(k)) continue;
              var d = defs[k]; if (!d || d.type !== 'keybind') continue;
              var val = null;
              try { if (api.settings.value) val = api.settings.value('keyboard', k); } catch (e) {}
              if (!val) val = d.default;
              if (!val) continue;
              var vals = (val instanceof Array) ? val : [val];
              for (var vi = 0; vi < vals.length; vi++) { var pk = parseKeyStr(vals[vi]); if (pk) add(pk.mod, pk.base, locStrip(d.title || k), false); }
            }
          }
        } catch (e) { warn('overlay: PA keybind read failed: ' + (e && e.message)); }
        var ours = (window.BarAnnihilation && BarAnnihilation.binds) || {};
        for (var key in ours) { if (!ours.hasOwnProperty(key)) continue; var pk2 = parseKeyStr(key); if (pk2) add(pk2.mod, pk2.base, ours[key], true); }
        return idx;
      }

      function ensureRoot() {
        if ($root) return;
        $root = $('<div id="barann-overlay"><div id="barann-kb">' +
          '<div class="kb-title">BAR Annihilation — Key Bindings</div>' +
          '<div class="kb-sub" id="barann-kb-sub"></div>' +
          '<div id="barann-kb-rows"></div>' +
          '<div class="legend">' +
          '<span><span class="swatch" style="background:#1c3145;border:1px solid #3f7fb0;"></span>PA action</span>' +
          '<span><span class="swatch" style="background:#2a2410;border:1px solid #d2a73a;"></span>BAR Annihilation (overrides PA)</span>' +
          '<span><span class="swatch" style="background:#2f5a3a;border:1px solid #5fbf7f;"></span>modifier held</span>' +
          '<span>Esc to close</span></div>' +
          '</div></div>');
        $('body').append($root);
      }

      function render() {
        if (!$root) return;
        if (!idxCache) idxCache = buildIndex();
        var combo = currentCombo(), layer = idxCache[combo] || {};
        var $rows = $root.find('#barann-kb-rows').empty();
        for (var r = 0; r < ROWS.length; r++) {
          var $row = $('<div class="kb-row"></div>');
          for (var c = 0; c < ROWS[r].length; c++) {
            var cell = ROWS[r][c], token = cell[0], cap = cell[1], classes = 'kb-key';
            for (var x = 2; x < cell.length; x++) classes += ' ' + cell[x];
            var $k = $('<div class="' + classes + '"></div>').append('<div class="kb-cap">' + cap + '</div>');
            var isMod = (token === 'ctrl' || token === 'alt' || token === 'shift');
            if (isMod) {
              if ((token === 'ctrl' && mods.ctrl) || (token === 'alt' && mods.alt) || (token === 'shift' && mods.shift)) $k.addClass('held');
            } else {
              var b = layer[token];
              if (b) { $k.addClass('bound'); if (b.ours) $k.addClass('ours'); $k.append('<div class="kb-act">' + escapeHtml(b.label) + '</div>'); }
            }
            $row.append($k);
          }
          $rows.append($row);
        }
        $root.find('#barann-kb-sub').text(combo ? ('Layer: ' + combo.toUpperCase().replace(/\+/g, ' + ')) : 'Base layer — hold Ctrl / Shift / Alt to see those layers');
      }

      function show() { ensureRoot(); idxCache = null; visible = true; $root.addClass('show'); render(); }
      function hide() { visible = false; mods.ctrl = mods.alt = mods.shift = false; if ($root) $root.removeClass('show'); }
      function toggle() { if (visible) hide(); else show(); }

      function updMods(e, down) {
        var nc = e.ctrlKey, na = e.altKey, ns = e.shiftKey, ch = false;
        if (e.which === 17) nc = down; if (e.which === 18) na = down; if (e.which === 16) ns = down;
        if (nc !== mods.ctrl) { mods.ctrl = nc; ch = true; } if (na !== mods.alt) { mods.alt = na; ch = true; } if (ns !== mods.shift) { mods.shift = ns; ch = true; }
        return ch;
      }

      $(document).on('keydown.barAnnOverlay', function (e) {
        if (e.which === TOGGLE_WHICH && !e.ctrlKey && !e.altKey && !e.shiftKey) { e.preventDefault(); toggle(); return false; }
        if (!visible) return;
        if (e.which === 27) { hide(); return false; } // Esc closes
        if (updMods(e, true)) render();
      });
      $(document).on('keyup.barAnnOverlay', function (e) { if (visible && updMods(e, false)) render(); });

      log('keyboard overlay ready — press \\ (backslash) to toggle; hold Ctrl/Shift/Alt for layers');
    }
  });
})();
