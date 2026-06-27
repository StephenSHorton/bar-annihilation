(function () {
  'use strict';
  var BA = window.BarAnnihilation; if (!BA) { return; }

  // ---------------------------------------------------------------------------
  // M3 — Grid Build Menu (MVP: FACTORY path).
  // Faithful port of BAR's gui_gridmenu: a 3x4 spatial keyboard build grid.
  //   row 3 (top)    Q W E R   = cells  9..12
  //   row 2 (mid)    A S D F   = cells  5..8
  //   row 1 (bottom) Z X C V   = cells  1..4
  // This MVP covers the FRICTIONLESS half (design verdict): a FACTORY is selected
  // (model.selectedMobile() === false) → grid shows the factory's buildables →
  // a grid key enqueues via api.unit.build(spec, count, urgent) with no map coords.
  // Mobile-builder categories + fabber placement (sendOrder/fixupBuildLocations)
  // come next; see docs/M3-GRID-BUILD.md.
  //
  // Enumerate: model.unitSpecs[selSpec].build (buildable spec objects/ids) +
  //            model.selection() {spec_ids, build_orders, selected_mobile}.
  // Build:     api.unit.build / api.unit.cancelBuild  (factory branch — no clicks).
  //
  // Rendering: a Coherent child <panel> (gridmenu.html) — the host DOM never
  // paints (see overlay.js). The parent computes the cell model and pushes it via
  // panel.message('grid:update', ...); the child only paints. All order logic
  // stays here where model / api.unit live.
  // ---------------------------------------------------------------------------
  BA.register({
    name: 'gridmenu',
    init: function () {
      var PANEL_ID = 'barann-gridmenu-panel';
      var SRC = 'coui://ui/mods/com.pa.stephenshorton.bar-annihilation/gridmenu.html';

      // grid keys in VISUAL reading order (top-left -> bottom-right); index = cell slot.
      // NOTE: by virtual keyCode (US layout) for now — matches the rest of the mod;
      // physical-scancode binding is a later refinement (see doc).
      var CAPS = ['Q','W','E','R','A','S','D','F','Z','X','C','V'];
      var KEYCODE_TO_SLOT = { 81:0, 87:1, 69:2, 82:3, 65:4, 83:5, 68:6, 70:7, 90:8, 88:9, 67:10, 86:11 };

      var el = null, pushTimer = null, lastPush = null;
      var grid = { open: false, cells: null, title: '' };
      var diagged = {};   // spec -> logged its shape once

      // --- helpers -----------------------------------------------------------
      function baseSpec(id) { var m = String(id).match(/^(.*\.json)/); return m ? m[1] : String(id); }
      function nameOf(id) { return baseSpec(id).split('/').pop().replace(/\.json.*$/, ''); }
      function costOf(spec, which) {
        if (!spec) return null;
        if (spec.cost && typeof spec.cost === 'object' && spec.cost[which] != null) return spec.cost[which];
        if (spec[which + 'Cost'] != null) return spec[which + 'Cost'];
        if (spec['build_' + which + '_cost'] != null) return spec['build_' + which + '_cost'];
        return null;
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
            seen[id] = 1; items.push(id);
          }
        }
        if (!items.length) return null;                   // selection can't build anything → not our menu

        var orders = sel.build_orders || {};
        var cells = [];
        for (var c = 0; c < 12; c++) {
          var id2 = items[c];
          if (!id2) { cells.push(null); continue; }
          var b = baseSpec(id2);
          var bs = model.unitSpecs[b] || model.unitSpecs[id2];
          cells.push({
            specId: id2,
            label: nameOf(id2),
            metal: costOf(bs, 'metal'),
            energy: costOf(bs, 'energy'),
            queue: orders[id2] || orders[b] || 0
          });
        }
        return { cells: cells, title: nameOf(specs[0]), count: items.length };
      }

      // --- panel -------------------------------------------------------------
      function ensurePanel() {
        if (el && document.getElementById(PANEL_ID)) return el;
        var stale = document.getElementById(PANEL_ID);
        if (stale) { try { $(stale).remove(); } catch (e) {} }
        el = document.createElement('panel');            // MUST be <panel>, not <div>
        el.id = PANEL_ID;
        el.setAttribute('src', SRC);
        el.setAttribute('fit', 'dock');
        el.setAttribute('no-input', '');                 // mouse passes through (keyboard-driven for now)
        el.setAttribute('no-keyboard', '');              // keys stay on host (our capture handler drives them)
        el.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:1400;';
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
        try {
          if (qty >= 0) {
            if (api.unit && api.unit.build) api.unit.build(specId, qty, false);
            else BA.warn('gridmenu: api.unit.build missing');
          } else {
            if (api.unit && api.unit.cancelBuild) api.unit.cancelBuild(specId, -qty, false);
            else BA.warn('gridmenu: api.unit.cancelBuild missing');
          }
          BA.log('gridmenu build ' + specId + ' x' + qty);
        } catch (e) { BA.err('gridmenu build failed ' + specId, e); }
        // optimistic: next tick reconciles the badge from build_orders
        lastPush = null;
      }

      // --- keyboard (capture phase, before PA's Mousetrap) -------------------
      // Only act while the grid is OPEN; otherwise let keys fall through to PA
      // and to our select binds. When open, the 12 grid keys are OURS (faithful:
      // BAR rebinds Q/W/E/R... contextually for a selected builder).
      function onGridKey(e) {
        if (!grid.open) return;
        if (BA.util.uiBusy()) return;                      // chat / landing open → hands off
        var slot = KEYCODE_TO_SLOT[e.which];
        if (slot === undefined) return;                    // not a grid key → pass through (camera etc.)
        e.preventDefault(); e.stopImmediatePropagation();  // own it: block PA + our Mousetrap Q/etc.
        var cell = grid.cells && grid.cells[slot];
        if (!cell) return false;                           // empty slot → swallow, do nothing
        var qty = e.shiftKey ? (e.ctrlKey ? -5 : 5) : (e.ctrlKey ? -1 : 1);  // BAR factory batching
        doBuild(cell.specId, qty);
        return false;
      }
      document.addEventListener('keydown', onGridKey, true);

      // --- boot --------------------------------------------------------------
      ensurePanel();
      if (pushTimer) clearInterval(pushTimer);
      pushTimer = setInterval(tick, 300);
      tick();
      BA.log('gridmenu ready (M3 MVP, factory path) — select a factory; Q W E R / A S D F / Z X C V build; Shift x5, Ctrl cancels');
    }
  });
})();
