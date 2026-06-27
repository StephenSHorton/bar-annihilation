(function () {
  'use strict';
  var BA = window.BarAnnihilation; if (!BA) { return; }

  // ---------------------------------------------------------------------------
  // M3 — Grid Build Menu (MVP: FACTORY path).
  // Faithful port of BAR's gui_gridmenu: a 3x4 spatial keyboard build grid.
  //   row 3 (top)    Q W E R   = slots 0..3
  //   row 2 (mid)    A S D F   = slots 4..7
  //   row 1 (bottom) Z X C V   = slots 8..11
  // MVP = the FRICTIONLESS half (design verdict): a FACTORY is selected
  // (model.selectedMobile() === false) → grid shows the factory's buildables →
  // key OR click enqueues via api.unit.build(spec, count) — no map coords.
  // Mobile-builder categories + fabber placement come next; see docs/M3-GRID-BUILD.md.
  //
  // Enumerate: model.unitSpecs[selSpec].build — each entry is a FULL buildable
  //   spec object {id, name, cost(metal), buildIcon, structure, buildRow/Column...}
  //   (confirmed via live DIAG). Plus model.selection() {spec_ids, build_orders,
  //   selected_mobile}.
  // Build:     api.unit.build / api.unit.cancelBuild  (factory branch — no clicks).
  //
  // Batching (BAR factory semantics):
  //   keyboard: key=+1, Shift=+5, Ctrl=-1, Shift+Ctrl=-5
  //   mouse:    L=+1, Shift=+5, Ctrl=+20, Shift+Ctrl=+100; right-click negates
  //
  // Rendering: a Coherent child <panel> (gridmenu.html). The panel is sized to the
  // grid box (not fullscreen) and is input-enabled so cells are clickable, while
  // the rest of the screen stays interactive. The child paints icons and routes
  // clicks back via api.Panel.message(parentId, 'grid:click', ...); ALL order
  // logic stays here where model / api.unit live.
  // ---------------------------------------------------------------------------
  BA.register({
    name: 'gridmenu',
    init: function () {
      var PANEL_ID = 'barann-gridmenu-panel';
      var SRC = 'coui://ui/mods/com.pa.stephenshorton.bar-annihilation/gridmenu.html';

      // grid keys in VISUAL reading order (top-left -> bottom-right); index = slot.
      // by virtual keyCode (US layout) for now (physical-scancode is a later refinement).
      var CAPS = ['Q','W','E','R','A','S','D','F','Z','X','C','V'];
      var KEYCODE_TO_SLOT = { 81:0, 87:1, 69:2, 82:3, 65:4, 83:5, 68:6, 70:7, 90:8, 88:9, 67:10, 86:11 };

      var el = null, pushTimer = null, lastPush = null;
      var grid = { open: false, cells: null, title: '' };
      var diagged = {};   // spec -> logged its shape once

      // --- helpers -----------------------------------------------------------
      function baseSpec(id) { var m = String(id).match(/^(.*\.json)/); return m ? m[1] : String(id); }
      function nameOf(id) { return baseSpec(id).split('/').pop().replace(/\.json.*$/, ''); }
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
            + ' build.len=' + ((us && us.build && us.build.length) || 0)
            + ' build[0]=' + JSON.stringify(sample));
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
            seen[id] = 1; items.push(bl[j]);              // keep the full entry object
          }
        }
        if (!items.length) return null;                   // selection can't build anything → not our menu

        var orders = sel.build_orders || {};
        var cells = [];
        for (var c = 0; c < 12; c++) {
          var entry = items[c];
          if (!entry) { cells.push(null); continue; }
          var id2 = buildIdOf(entry), b = baseSpec(id2);
          cells.push({
            specId: id2,
            label: entryField(entry, id2, 'name') || nameOf(id2),
            icon: entryField(entry, id2, 'buildIcon') || null,
            metal: entryField(entry, id2, 'cost'),
            queue: orders[id2] || orders[b] || 0
          });
        }
        var facUs = model.unitSpecs[specs[0]] || model.unitSpecs[baseSpec(specs[0])];
        var title = (facUs && facUs.name) || nameOf(specs[0]);
        return { cells: cells, title: title, count: items.length };
      }

      // --- panel (sized to the grid box; input-enabled for clicks) ------------
      function ensurePanel() {
        if (el && document.getElementById(PANEL_ID)) return el;
        var stale = document.getElementById(PANEL_ID);
        if (stale) { try { $(stale).remove(); } catch (e) {} }
        el = document.createElement('panel');            // MUST be <panel>, not <div>
        el.id = PANEL_ID;
        el.setAttribute('src', SRC);
        el.setAttribute('no-keyboard', '');              // keys stay on host (our capture handler drives them)
        // sized box at bottom-left so clicks hit cells but the rest of the screen
        // stays interactive (NO no-input → cells are clickable; NO fit=dock).
        el.style.cssText = 'position:absolute;left:12px;bottom:140px;width:336px;height:252px;z-index:1400;';
        el.style.display = 'none';
        document.body.appendChild(el);
        try { api.Panel.bindElement(el); BA.log('gridmenu panel bound: ' + PANEL_ID); }
        catch (e) { BA.err('gridmenu panel bind failed', e); }
        return el;
      }

      function pushGrid() {
        var p = api.panels[PANEL_ID];
        if (!p || p.id === undefined || p.id < 0) return;  // wait for panel.create to resolve
        var payload = { open: grid.open, cells: grid.cells, caps: CAPS, title: grid.title };
        var s = JSON.stringify(payload);
        if (s === lastPush) return;                        // dedupe re-pushes (no flicker)
        lastPush = s;
        try { p.message('grid:update', payload); } catch (e) { BA.warn('gridmenu push failed: ' + (e && e.message)); }
      }

      // --- per-tick: recompute from selection, open/close, push --------------
      function tick() {
        var g = null;
        try { g = computeCells(); } catch (e) { BA.warn('gridmenu compute failed: ' + (e && e.message)); }
        if (g) { grid.open = true; grid.cells = g.cells; grid.title = g.title; }
        else { grid.open = false; grid.cells = null; grid.title = ''; }
        if (el) el.style.display = grid.open ? '' : 'none';
        pushGrid();
      }

      // --- build action ------------------------------------------------------
      function doBuild(specId, qty) {
        if (!qty) return;
        try {
          if (qty > 0) {
            if (api.unit && api.unit.build) api.unit.build(specId, qty, false);
            else BA.warn('gridmenu: api.unit.build missing');
          } else {
            if (api.unit && api.unit.cancelBuild) api.unit.cancelBuild(specId, -qty, false);
            else BA.warn('gridmenu: api.unit.cancelBuild missing');
          }
          BA.log('gridmenu build ' + specId + ' x' + qty);
        } catch (e) { BA.err('gridmenu build failed ' + specId, e); }
        lastPush = null;                                   // force next tick to refresh the queue badge
      }

      function qtyFromKeyboard(e) { return e.shiftKey ? (e.ctrlKey ? -5 : 5) : (e.ctrlKey ? -1 : 1); }
      function qtyFromMouse(button, shift, ctrl) {          // BAR factory mouse batching
        var base = shift ? (ctrl ? 100 : 5) : (ctrl ? 20 : 1);
        return (button === 2) ? -base : base;              // right-click negates
      }

      // --- keyboard (capture phase, before PA's Mousetrap) -------------------
      // While the grid is OPEN the 12 grid keys are OURS (faithful: BAR rebinds
      // Q/W/E/R... contextually for a selected builder). We FULLY consume them
      // (keydown + keyup) so nothing bubbles to PA or our own select binds.
      function isGridKey(e) { return KEYCODE_TO_SLOT[e.which] !== undefined; }
      function onKeyDown(e) {
        if (!grid.open || BA.util.uiBusy()) return;        // closed / chat open → pass through
        if (!isGridKey(e)) return;                          // not a grid key → let camera etc. work
        e.preventDefault(); e.stopImmediatePropagation();   // consume: block PA + our Mousetrap
        var cell = grid.cells && grid.cells[KEYCODE_TO_SLOT[e.which]];
        if (cell) doBuild(cell.specId, qtyFromKeyboard(e));
        return false;
      }
      function onKeyUp(e) {
        if (!grid.open) return;
        if (!isGridKey(e)) return;
        e.preventDefault(); e.stopImmediatePropagation();   // swallow the matching keyup too
        return false;
      }
      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('keyup', onKeyUp, true);

      // --- mouse: clicks routed up from the child panel ----------------------
      function onCellClick(payload) {
        if (!grid.open || !payload) return;
        var cell = grid.cells && grid.cells[payload.slot];
        if (!cell) return;
        doBuild(cell.specId, qtyFromMouse(payload.button || 0, !!payload.shift, !!payload.ctrl));
      }
      var H = (typeof handlers !== 'undefined' && handlers) ? handlers : (window.handlers || null);
      if (H) H['grid:click'] = onCellClick;
      else BA.warn('gridmenu: no handlers map — cell clicks will not route');

      // --- boot --------------------------------------------------------------
      ensurePanel();
      if (pushTimer) clearInterval(pushTimer);
      pushTimer = setInterval(tick, 300);
      tick();
      BA.log('gridmenu ready (M3 MVP, factory path) — select a factory; Q W E R / A S D F / Z X C V or click; Shift x5, Ctrl cancels (key) / x20 (click), right-click cancels');
    }
  });
})();
