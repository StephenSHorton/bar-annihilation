(function () {
  'use strict';
  var BA = window.BarAnnihilation; if (!BA) { return; }

  // ---------------------------------------------------------------------------
  // M3 — Grid Build Menu (MVP: FACTORY path).
  // Faithful port of BAR's gui_gridmenu: a 3x4 spatial keyboard build grid.
  //   row 3 (top)    Q W E R   = slots 0..3
  //   row 2 (mid)    A S D F   = slots 4..7
  //   row 1 (bottom) Z X C V   = slots 8..11
  // FACTORY is selected (model.selectedMobile() === false) → grid shows its
  // buildables → key OR click enqueues via api.unit.build (no map coords).
  //
  // Features: real build icons; key + click batching (BAR factory semantics);
  // hover tooltip panel to the right (unit name/description/stats); and while
  // our grid is open we suppress PA's native bottom-center build bar.
  //
  // Rendering: a Coherent child <panel> (gridmenu.html) sized to the grid box,
  // input-enabled for clicks. Clicks/hovers route up via api.Panel.query
  // ('grid:click' / 'grid:hover') because panel.query is always whitelisted in
  // the parent's panel.ready filter (custom panel.message types are dropped).
  // A second no-input <panel> (tooltip.html) shows unit info on hover.
  // ---------------------------------------------------------------------------
  BA.register({
    name: 'gridmenu',
    init: function () {
      var PANEL_ID = 'barann-gridmenu-panel';
      var SRC = 'coui://ui/mods/com.pa.stephenshorton.bar-annihilation/gridmenu.html';
      var TIP_ID = 'barann-gridtip-panel';
      var TIP_SRC = 'coui://ui/mods/com.pa.stephenshorton.bar-annihilation/tooltip.html';

      // layout geometry (px)
      var GX = 12, GY = 300, GW = 336, GH = 252;          // grid panel
      var TIPX = GX + GW + 8, TIPW = 300, TIPH = 260;     // tooltip panel (to the right)

      // grid keys in VISUAL reading order (top-left -> bottom-right); index = slot.
      var CAPS = ['Q','W','E','R','A','S','D','F','Z','X','C','V'];
      var KEYCODE_TO_SLOT = { 81:0, 87:1, 69:2, 82:3, 65:4, 83:5, 68:6, 70:7, 90:8, 88:9, 67:10, 86:11 };

      var el = null, tipEl = null, pushTimer = null, lastPush = null, lastOpen = null;
      var grid = { open: false, cells: null, entries: null, title: '' };
      var diagged = {};

      // --- helpers -----------------------------------------------------------
      function baseSpec(id) { var m = String(id).match(/^(.*\.json)/); return m ? m[1] : String(id); }
      function nameOf(id) { return baseSpec(id).split('/').pop().replace(/\.json.*$/, ''); }
      function locStrip(s) { return (s == null) ? s : String(s).replace(/^!LOC:/, ''); }
      function entryField(entry, id, field) {
        if (entry && typeof entry === 'object' && entry[field] != null) return entry[field];
        var us = model.unitSpecs && (model.unitSpecs[id] || model.unitSpecs[baseSpec(id)]);
        return us ? us[field] : null;
      }
      function buildIdOf(entry) {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object') return entry.id || entry.spec || entry.key || null;
        return null;
      }
      function diagOnce(spec, us) {
        if (diagged[spec]) return; diagged[spec] = true;
        try {
          var keys = us ? Object.keys(us) : null;
          var sample = (us && us.build && us.build.length) ? us.build[0] : null;
          BA.log('gridmenu DIAG spec=' + spec + ' keys=' + JSON.stringify(keys)
            + ' build.len=' + ((us && us.build && us.build.length) || 0) + ' build[0]=' + JSON.stringify(sample));
        } catch (e) {}
      }

      // --- compute the cell model from the live selection (factory only) ------
      function computeCells() {
        if (typeof model === 'undefined' || !model.selection || !model.unitSpecs) return null;
        var sel; try { sel = model.selection(); } catch (e) { return null; }
        if (!sel || !sel.spec_ids) return null;
        var mobile;
        try { mobile = model.selectedMobile ? model.selectedMobile() : sel.selected_mobile; } catch (e) { mobile = sel.selected_mobile; }
        if (mobile) return null;                          // MVP: factories only (fabbers need placement)

        var specs = [];
        for (var k in sel.spec_ids) { if (sel.spec_ids.hasOwnProperty(k)) specs.push(k); }
        if (!specs.length) return null;

        var seen = {}, items = [];
        for (var i = 0; i < specs.length; i++) {
          var us = model.unitSpecs[specs[i]] || model.unitSpecs[baseSpec(specs[i])];
          diagOnce(specs[i], us);
          var bl = us && us.build;
          if (!bl || !bl.length) continue;
          for (var j = 0; j < bl.length; j++) {
            var id = buildIdOf(bl[j]);
            if (!id || seen[id]) continue;
            seen[id] = 1; items.push(bl[j]);
          }
        }
        if (!items.length) return null;

        var orders = sel.build_orders || {};
        var cells = [], entries = [];
        for (var c = 0; c < 12; c++) {
          var entry = items[c];
          if (!entry) { cells.push(null); entries.push(null); continue; }
          var id2 = buildIdOf(entry), b = baseSpec(id2);
          entries.push(entry);
          cells.push({
            specId: id2,
            label: locStrip(entryField(entry, id2, 'name')) || nameOf(id2),
            icon: entryField(entry, id2, 'buildIcon') || null,
            metal: entryField(entry, id2, 'cost'),
            queue: orders[id2] || orders[b] || 0
          });
        }
        var facUs = model.unitSpecs[specs[0]] || model.unitSpecs[baseSpec(specs[0])];
        var title = locStrip((facUs && facUs.name)) || nameOf(specs[0]);
        return { cells: cells, entries: entries, title: title };
      }

      // --- panels ------------------------------------------------------------
      function makePanel(id, src, css, noInput) {
        var stale = document.getElementById(id);
        if (stale) { try { $(stale).remove(); } catch (e) {} }
        var p = document.createElement('panel');
        p.id = id;
        p.setAttribute('src', src);
        p.setAttribute('no-keyboard', '');
        if (noInput) p.setAttribute('no-input', '');
        p.style.cssText = css;
        p.style.display = 'none';
        document.body.appendChild(p);
        try { api.Panel.bindElement(p); BA.log('gridmenu panel bound: ' + id); }
        catch (e) { BA.err('gridmenu panel bind failed ' + id, e); }
        return p;
      }
      function ensurePanels() {
        if (!el || !document.getElementById(PANEL_ID))
          el = makePanel(PANEL_ID, SRC, 'position:absolute;left:' + GX + 'px;bottom:' + GY + 'px;width:' + GW + 'px;height:' + GH + 'px;z-index:1400;', false);
        if (!tipEl || !document.getElementById(TIP_ID))
          tipEl = makePanel(TIP_ID, TIP_SRC, 'position:absolute;left:' + TIPX + 'px;bottom:' + GY + 'px;width:' + TIPW + 'px;height:' + TIPH + 'px;z-index:1400;', true);
      }
      function forceUpdate(id) { var p = api.panels[id]; if (p && p.update) { try { p.update(); } catch (e) {} } }
      function showPanel(id, on) {
        var node = document.getElementById(id);
        if (node) node.style.display = on ? '' : 'none';
        forceUpdate(id);   // a hidden panel only polls visibility every 1s; push it now
      }

      function pushGrid() {
        var p = api.panels[PANEL_ID];
        if (!p || p.id === undefined || p.id < 0) return;
        var payload = { open: grid.open, cells: grid.cells, caps: CAPS, title: grid.title };
        var s = JSON.stringify(payload);
        if (s === lastPush) return;
        lastPush = s;
        try { p.message('grid:update', payload); } catch (e) { BA.warn('gridmenu push failed: ' + (e && e.message)); }
      }

      // --- suppress PA's native build bar while our grid is open -------------
      function injectStyle() {
        if (document.getElementById('barann-grid-style')) return;
        try {
          var st = document.createElement('style');
          st.id = 'barann-grid-style'; st.type = 'text/css';
          // CSS !important beats Knockout's inline display set by `visible: showBuildList`.
          st.appendChild(document.createTextNode('body.barann-grid-open .div_build_bar_cont{display:none !important;}'));
          (document.head || document.documentElement).appendChild(st);
        } catch (e) { BA.warn('gridmenu style inject failed: ' + (e && e.message)); }
      }
      function setBodyFlag(on) {
        try {
          var b = document.body; if (!b) return;
          var c = ' ' + b.className + ' ', has = c.indexOf(' barann-grid-open ') >= 0;
          if (on && !has) b.className = (b.className + ' barann-grid-open').replace(/^\s+/, '');
          else if (!on && has) b.className = c.replace(' barann-grid-open ', ' ').replace(/^\s+|\s+$/g, '');
        } catch (e) {}
      }

      // --- per-tick: recompute, open/close, push -----------------------------
      function tick() {
        var g = null;
        try { g = computeCells(); } catch (e) { BA.warn('gridmenu compute failed: ' + (e && e.message)); }
        if (g) { grid.open = true; grid.cells = g.cells; grid.entries = g.entries; grid.title = g.title; }
        else { grid.open = false; grid.cells = null; grid.entries = null; grid.title = ''; }
        if (grid.open !== lastOpen) {
          lastOpen = grid.open;
          showPanel(PANEL_ID, grid.open);
          setBodyFlag(grid.open);                          // hide/show PA's native build bar
          if (!grid.open) showPanel(TIP_ID, false);        // drop the tooltip when the menu closes
        }
        pushGrid();
      }

      // --- build action ------------------------------------------------------
      function doBuild(specId, qty) {
        if (!qty) return;
        try {
          if (qty > 0) { if (api.unit && api.unit.build) api.unit.build(specId, qty, false); else BA.warn('gridmenu: api.unit.build missing'); }
          else { if (api.unit && api.unit.cancelBuild) api.unit.cancelBuild(specId, -qty, false); else BA.warn('gridmenu: api.unit.cancelBuild missing'); }
          BA.log('gridmenu build ' + specId + ' x' + qty);
        } catch (e) { BA.err('gridmenu build failed ' + specId, e); }
        lastPush = null;
      }
      function qtyFromKeyboard(e) { return e.shiftKey ? (e.ctrlKey ? -5 : 5) : (e.ctrlKey ? -1 : 1); }
      function qtyFromMouse(button, shift, ctrl) {
        var base = shift ? (ctrl ? 100 : 5) : (ctrl ? 20 : 1);
        return (button === 2) ? -base : base;
      }

      // --- keyboard (capture phase, consume both keydown + keyup while open) --
      function isGridKey(e) { return KEYCODE_TO_SLOT[e.which] !== undefined; }
      function onKeyDown(e) {
        if (!grid.open || BA.util.uiBusy()) return;
        if (!isGridKey(e)) return;
        e.preventDefault(); e.stopImmediatePropagation();
        var cell = grid.cells && grid.cells[KEYCODE_TO_SLOT[e.which]];
        if (cell) doBuild(cell.specId, qtyFromKeyboard(e));
        return false;
      }
      function onKeyUp(e) {
        if (!grid.open || !isGridKey(e)) return;
        e.preventDefault(); e.stopImmediatePropagation(); return false;
      }
      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('keyup', onKeyUp, true);

      // --- mouse: click + hover routed up from the child panel ---------------
      function onCellClick(payload) {
        if (!grid.open || !payload) return;
        var cell = grid.cells && grid.cells[payload.slot];
        if (cell) doBuild(cell.specId, qtyFromMouse(payload.button || 0, !!payload.shift, !!payload.ctrl));
      }
      function tipFor(entry) {
        if (!entry) return null;
        var stats = [];
        function add(k, v) { if (v != null && v !== '' && !(typeof v === 'number' && isNaN(v))) stats.push({ k: k, v: (typeof v === 'number' ? Math.round(v) : v) }); }
        add('Metal', entry.cost);
        add('Health', entry.max_health);
        if (entry.dps) add('DPS', entry.dps);
        if (entry.max_range) add('Range', entry.max_range);
        if (entry.navigation && entry.navigation.moveSpeed) add('Speed', entry.navigation.moveSpeed);
        return { name: locStrip(entry.name) || '', desc: locStrip(entry.description) || '', stats: stats };
      }
      function onHover(payload) {
        if (!grid.open || !payload) { showPanel(TIP_ID, false); return; }
        var slot = payload.slot;
        var entry = (slot != null && slot >= 0 && grid.entries) ? grid.entries[slot] : null;
        var info = tipFor(entry);
        BA.log('gridmenu onHover slot=' + slot + ' name=' + (info && info.name));
        if (!info) { showPanel(TIP_ID, false); return; }
        var p = api.panels[TIP_ID];
        if (p && p.id >= 0) { try { p.message('tip:show', info); } catch (e) {} }
        showPanel(TIP_ID, true);
      }
      var H = (typeof handlers !== 'undefined' && handlers) ? handlers : (window.handlers || null);
      if (H) { H['grid:click'] = onCellClick; H['grid:hover'] = onHover; }
      else BA.warn('gridmenu: no handlers map — clicks/hover will not route');

      // --- boot --------------------------------------------------------------
      injectStyle();
      ensurePanels();
      if (pushTimer) clearInterval(pushTimer);
      pushTimer = setInterval(tick, 150);
      tick();
      BA.log('gridmenu ready (M3 MVP, factory path) — select a factory; key or click to build; hover for info; native build bar hidden while open');
    }
  });
})();
