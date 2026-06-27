(function () {
  'use strict';
  var BA = window.BarAnnihilation; if (!BA) { return; }

  // ---------------------------------------------------------------------------
  // M3 — Grid Build Menu. Faithful port of BAR's gui_gridmenu: a 3x4 spatial
  // keyboard build grid.
  //   row (top)    Q W E R   = slots 0..3
  //   row (mid)    A S D F   = slots 4..7
  //   row (bottom) Z X C V   = slots 8..11
  //
  // FACTORY (model.selectedMobile() === false): flat grid of buildables; key/click
  // ENQUEUES via api.unit.build (no map coords). Batching: key {+1, Shift+5, Ctrl
  // cancel-1, Shift+Ctrl-5}; mouse {+1, Shift+5, Ctrl+20, Shift+Ctrl+100, RMB
  // negates}; hold Space = front of queue. Paged with B if > 12.
  //
  // MOBILE BUILDER (fabber/commander): 4 categories on the bottom row —
  // Economy / Combat / Utility / Production (Z X C V). HOME shows one category per
  // column; press Z/X/C/V to open a category (3x4 page, B to page); a cell then
  // ENTERS PA's native placement mode (executeStartBuild -> beginFabMode: ghost,
  // click-to-place, wall-drag, metal-spot snapping). Esc / RMB / Shift-release
  // returns home; non-shift place returns home, Shift stays (queue).
  //
  // While our grid is open we suppress PA's native bottom-center build bar.
  // Rendering: a Coherent child <panel> (gridmenu.html); a second no-input <panel>
  // (tooltip.html) shows unit info on hover. Clicks/hover route up via
  // api.Panel.query (panel.query is always whitelisted; custom panel.message types
  // are dropped by the parent's panel.ready filter).
  // ---------------------------------------------------------------------------
  BA.register({
    name: 'gridmenu',
    init: function () {
      var PANEL_ID = 'barann-gridmenu-panel';
      var SRC = 'coui://ui/mods/com.pa.stephenshorton.bar-annihilation/gridmenu.html';
      var TIP_ID = 'barann-gridtip-panel';
      var TIP_SRC = 'coui://ui/mods/com.pa.stephenshorton.bar-annihilation/tooltip.html';

      // layout geometry (px). Panel is bottom-anchored; the child box hugs content
      // from the top, so home/factory/category grow downward without empty space.
      var GX = 12, GY = 276, GW = 336, GH = 276;          // grid panel
      var TIPX = GX + GW + 8, TIPW = 300, TIPH = 260;     // tooltip panel (to the right)
      var TIPY = GY + GH - 228;                            // align tip's bottom with the grid box's bottom

      // grid keys in VISUAL reading order (top-left -> bottom-right); index = slot.
      var CAPS = ['Q','W','E','R','A','S','D','F','Z','X','C','V'];
      var KEYCODE_TO_SLOT = { 81:0, 87:1, 69:2, 82:3, 65:4, 83:5, 68:6, 70:7, 90:8, 88:9, 67:10, 86:11 };
      // BAR numbers cells bottom-up; a category page / gap-filler fills ascending
      // index = bottom row first. In our top-down slots that is:
      var FILL_ORDER = [8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3];
      // home quick-access fills the top 8 cells, home row (A S D F) first then top (Q W E R)
      var QUICK_SLOTS = [4, 5, 6, 7, 0, 1, 2, 3];
      var CAT_LABELS = ['ECONOMY', 'COMBAT', 'UTILITY', 'PRODUCTION'];
      // generic PA category glyphs (GW tech icons) so the 4 category buttons don't reuse unit icons
      var CAT_ICONS = [
        'coui://ui/main/game/galactic_war/gw_play/img/tech/gwc_metal.png',
        'coui://ui/main/game/galactic_war/gw_play/img/tech/gwc_turret.png',
        'coui://ui/main/game/galactic_war/gw_play/img/tech/gwc_intelligence_fabrication.png',
        'coui://ui/main/game/galactic_war/gw_play/img/tech/gwc_structure.png'
      ];
      var KEY_B = 66, KEY_ESC = 27, KEY_SHIFT = 16, KEY_SPACE = 32;

      var el = null, tipEl = null, pushTimer = null, lastPush = null, lastOpen = null;
      // raw model + rendered view, both kept on `grid`
      var grid = {
        open: false, isFactory: true, title: '', builderKey: null,
        cats: null, flat: null, orders: {},          // raw data
        cells: null, entries: null, mode: 'factory', sub: '', pages: 1   // rendered
      };
      var nav = { category: null, page: 1 };   // user navigation state
      var spaceHeld = false;   // factory: hold Space = front of queue
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
      function biOf(entry) { var v = entryField(entry, buildIdOf(entry), 'buildIndex'); return (typeof v === 'number') ? v : 9999; }
      function diagOnce(spec, us) {
        if (diagged[spec]) return; diagged[spec] = true;
        try {
          var keys = us ? Object.keys(us) : null;
          var sample = (us && us.build && us.build.length) ? us.build[0] : null;
          BA.log('gridmenu DIAG spec=' + spec + ' keys=' + JSON.stringify(keys)
            + ' build.len=' + ((us && us.build && us.build.length) || 0) + ' build[0]=' + JSON.stringify(sample));
        } catch (e) {}
      }

      // BAR categoryGroupMapping, ported to PA's buildGroup + path (economy is
      // buried in PA's 'utility' group, so split it out by path).
      function categoryOf(entry) {
        var id = String(buildIdOf(entry));
        if (/(metal_extractor|energy_plant|metal_storage|energy_storage|metal_maker)/.test(id)) return 0; // Economy
        var g = entryField(entry, buildIdOf(entry), 'buildGroup');
        if (g === 'combat' || g === 'ammo') return 1;   // Combat
        if (g === 'factory') return 3;                  // Production
        return 2;                                       // Utility (radar/jammer/teleporter/orbital/fallback)
      }
      function econRank(entry) {                         // economy order: metal first, then energy, then storage
        var id = String(buildIdOf(entry));
        if (/metal_extractor/.test(id)) return 0;
        if (/energy_plant/.test(id)) return 1;
        if (/metal_storage/.test(id)) return 2;
        if (/energy_storage/.test(id)) return 3;
        return 4;
      }
      function isGenerator(entry) { return /(metal_extractor|energy_plant|metal_maker)/.test(String(buildIdOf(entry))); }
      // prefer the advanced variant — drop the basic when an advanced of the same family
      // is also buildable (advanced fabbers list both tiers; quick access shows only adv).
      function dedupAdv(list) {
        var hasAdv = {}, i, id;
        for (i = 0; i < list.length; i++) { id = String(buildIdOf(list[i])); if (/_adv/.test(id)) hasAdv[id.replace(/_adv/g, '')] = true; }
        var out = [];
        for (i = 0; i < list.length; i++) {
          id = String(buildIdOf(list[i]));
          if (/_adv/.test(id) || !hasAdv[id.replace(/_adv/g, '')]) out.push(list[i]);
        }
        return out;
      }

      // --- read the live selection into raw data (no view/nav) ----------------
      function rawCompute() {
        if (typeof model === 'undefined' || !model.selection || !model.unitSpecs) return null;
        var sel; try { sel = model.selection(); } catch (e) { return null; }
        if (!sel || !sel.spec_ids) return null;
        var mobile;
        try { mobile = model.selectedMobile ? model.selectedMobile() : sel.selected_mobile; } catch (e) { mobile = sel.selected_mobile; }

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

        var facUs = model.unitSpecs[specs[0]] || model.unitSpecs[baseSpec(specs[0])];
        var title = locStrip(facUs && facUs.name) || nameOf(specs[0]);
        var key = specs.slice().sort().join(',');
        var orders = sel.build_orders || {};

        if (!mobile) return { isFactory: true, title: title, flat: items, orders: orders, builderKey: key };

        var cats = [[], [], [], []];
        for (var c = 0; c < items.length; c++) cats[categoryOf(items[c])].push(items[c]);
        for (var cc = 0; cc < 4; cc++) cats[cc].sort(function (a, b) { return biOf(a) - biOf(b); });
        cats[0].sort(function (a, b) { var r = econRank(a) - econRank(b); return r !== 0 ? r : biOf(a) - biOf(b); });
        return { isFactory: false, title: title, cats: cats, orders: orders, builderKey: key };
      }

      // --- slice raw data + nav into the 12 visible cells ---------------------
      function renderView() {
        var cells = new Array(12), entries = new Array(12);
        for (var z = 0; z < 12; z++) { cells[z] = null; entries[z] = null; }
        var orders = grid.orders || {};
        function put(slot, entry, extra) {
          var id = buildIdOf(entry), b = baseSpec(id);
          var cell = {
            specId: id,
            label: locStrip(entryField(entry, id, 'name')) || nameOf(id),
            icon: entryField(entry, id, 'buildIcon') || null,
            metal: entryField(entry, id, 'cost'),
            queue: orders[id] || orders[b] || 0
          };
          if (extra) for (var kk in extra) cell[kk] = extra[kk];
          cells[slot] = cell; entries[slot] = entry;
        }

        grid.pages = 1; grid.sub = '';

        if (grid.isFactory) {
          grid.mode = 'factory';
          var list = grid.flat || [];
          grid.pages = Math.max(1, Math.ceil(list.length / 12));
          if (nav.page > grid.pages) nav.page = grid.pages;
          var off = (nav.page - 1) * 12;
          for (var s = 0; s < 12; s++) { var e = list[off + s]; if (e) put(s, e); }

        } else if (nav.category === null) {
          grid.mode = 'home';
          // bottom row = the 4 category buttons (generic glyphs, not unit icons)
          for (var cat = 0; cat < 4; cat++) {
            var cl = grid.cats[cat] || [];
            if (!cl.length) continue;
            cells[8 + cat] = { specId: null, isCategory: true, catLabel: CAT_LABELS[cat], catCount: cl.length, icon: CAT_ICONS[cat] };
          }
          // top 8 = quick access: economy generators (metal, energy), then combat, then
          // utility — advanced preferred (basic dropped when adv buildable). CLICK-ONLY
          // (noCap): these keys stay free for commander actions; only categories are hotkeyed.
          var gens = [], eco = grid.cats[0] || [];
          for (var g0 = 0; g0 < eco.length; g0++) if (isGenerator(eco[g0])) gens.push(eco[g0]);
          var quick = dedupAdv(gens.concat(grid.cats[1] || [], grid.cats[2] || []));
          for (var q = 0; q < QUICK_SLOTS.length && q < quick.length; q++) put(QUICK_SLOTS[q], quick[q], { noCap: true });
          grid.sub = '';

        } else {
          grid.mode = 'category';
          var cidx = nav.category, l2 = grid.cats[cidx] || [];
          grid.pages = Math.max(1, Math.ceil(l2.length / 12));
          if (nav.page > grid.pages) nav.page = grid.pages;
          var o2 = (nav.page - 1) * 12;
          for (var i2 = 0; i2 < 12; i2++) { var e2 = l2[o2 + i2]; if (e2) put(FILL_ORDER[i2], e2); }
          grid.sub = CAT_LABELS[cidx];
        }

        grid.cells = cells; grid.entries = entries;
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
          tipEl = makePanel(TIP_ID, TIP_SRC, 'position:absolute;left:' + TIPX + 'px;bottom:' + TIPY + 'px;width:' + TIPW + 'px;height:' + TIPH + 'px;z-index:1400;', true);
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
        var payload = { open: grid.open, mode: grid.mode, cells: grid.cells, caps: CAPS, title: grid.title, sub: grid.sub, page: nav.page, pages: grid.pages };
        var s = JSON.stringify(payload);
        if (s === lastPush) return;
        lastPush = s;
        try { p.message('grid:update', payload); } catch (e) { BA.warn('gridmenu push failed: ' + (e && e.message)); }
      }
      function repaint() { lastPush = null; if (grid.open) renderView(); pushGrid(); }

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

      // --- per-tick: recompute raw, reset nav on builder change, render, push -
      function tick() {
        var g = null;
        try { g = rawCompute(); } catch (e) { BA.warn('gridmenu compute failed: ' + (e && e.message)); }
        if (g) {
          if (g.builderKey !== grid.builderKey) { nav.category = null; nav.page = 1; }
          grid.open = true; grid.isFactory = g.isFactory; grid.cats = g.cats || null; grid.flat = g.flat || null;
          grid.orders = g.orders || {}; grid.title = g.title; grid.builderKey = g.builderKey;
        } else {
          grid.open = false; grid.cats = null; grid.flat = null; grid.cells = null; grid.entries = null; grid.builderKey = null;
          nav.category = null; nav.page = 1;
        }
        if (grid.open !== lastOpen) {
          lastOpen = grid.open;
          showPanel(PANEL_ID, grid.open);
          setBodyFlag(grid.open);                          // hide/show PA's native build bar
          if (!grid.open) { showPanel(TIP_ID, false); spaceHeld = false; }
        }
        if (grid.open) renderView();
        pushGrid();
      }

      // --- navigation --------------------------------------------------------
      function openCategory(cat) {
        if (grid.isFactory || !grid.cats || !grid.cats[cat] || !grid.cats[cat].length) return;
        nav.category = cat; nav.page = 1;
        showPanel(TIP_ID, false); repaint();
      }
      function goHome() {
        if (grid.isFactory || nav.category === null) return;
        nav.category = null; nav.page = 1;
        showPanel(TIP_ID, false); repaint();
      }
      function nextPage() {
        if (!grid.open || (grid.pages || 1) < 2) return;
        nav.page = (nav.page >= grid.pages) ? 1 : nav.page + 1;
        repaint();
      }

      // --- build actions -----------------------------------------------------
      function doBuild(specId, qty, immediate) {       // factory: enqueue
        if (!qty) return;
        immediate = !!immediate;                        // true => front of queue
        try {
          if (qty > 0) { if (api.unit && api.unit.build) api.unit.build(specId, qty, immediate); else BA.warn('gridmenu: api.unit.build missing'); }
          else { if (api.unit && api.unit.cancelBuild) api.unit.cancelBuild(specId, -qty, immediate); else BA.warn('gridmenu: api.unit.cancelBuild missing'); }
          BA.log('gridmenu build ' + specId + ' x' + qty + (immediate ? ' (front)' : ''));
        } catch (e) { BA.err('gridmenu build failed ' + specId, e); }
        lastPush = null;
      }
      function qtyFromKeyboard(e) { return e.shiftKey ? (e.ctrlKey ? -5 : 5) : (e.ctrlKey ? -1 : 1); }
      function qtyFromMouse(button, shift, ctrl) {
        var base = shift ? (ctrl ? 100 : 5) : (ctrl ? 20 : 1);
        return (button === 2) ? -base : base;
      }
      // fabber: enter PA's native placement mode (same handler as the stock bar).
      function enterFab(specId, shift, ctrl) {
        try {
          if (model.executeStartBuild) model.executeStartBuild({ item: specId, batch: !!shift, cancel: false, urgent: !!ctrl, more: false });
          else if (api.arch && api.arch.beginFabMode) { api.arch.beginFabMode(specId); if (model.mode) model.mode('fab'); }
          else { BA.warn('gridmenu: no fab-mode entry'); return; }
          BA.log('gridmenu fab ' + specId);
        } catch (e) { BA.err('gridmenu fab failed ' + specId, e); }
      }

      // --- keyboard (capture phase, consume while open) ----------------------
      function isGridKey(e) { return KEYCODE_TO_SLOT[e.which] !== undefined; }
      function consume(e) { e.preventDefault(); e.stopImmediatePropagation(); }
      function onKeyDown(e) {
        if (!grid.open || BA.util.uiBusy()) return;
        var w = e.which;
        var submenu = grid.isFactory || nav.category !== null;   // a factory grid or an open category
        if (w === KEY_SPACE) { if (grid.isFactory) { spaceHeld = true; consume(e); return false; } return; }
        if (w === KEY_B) { if (submenu) { consume(e); nextPage(); return false; } return; }   // paging only inside a build menu
        if (w === KEY_ESC) { if (!grid.isFactory && nav.category !== null) { consume(e); goHome(); return false; } return; }
        if (!isGridKey(e)) return;
        var slot = KEYCODE_TO_SLOT[w];
        // HOME (mobile, no category): only the bottom row (Z X C V) is hotkeyed, to open a
        // category. The top 8 quick cells are CLICK-ONLY, so Q/W/E/R/A/S/D/F stay free for
        // the commander's other actions while the menu is up.
        if (!submenu) {
          if (slot >= 8 && !e.ctrlKey && !e.altKey) { consume(e); openCategory(slot - 8); return false; }
          return;   // pass through — quick cells are mouse-only
        }
        // factory grid or open category: every cell is hotkeyed
        consume(e);
        var cell = grid.cells && grid.cells[slot];
        if (!cell) return false;
        if (grid.isFactory) doBuild(cell.specId, qtyFromKeyboard(e), spaceHeld);
        else { enterFab(cell.specId, e.shiftKey, e.ctrlKey); if (!e.shiftKey) goHome(); }
        return false;
      }
      function onKeyUp(e) {
        if (!grid.open) return;
        var w = e.which;
        if (w === KEY_SPACE) { spaceHeld = false; if (grid.isFactory) { consume(e); return false; } return; }
        if (w === KEY_SHIFT) { if (nav.category !== null) goHome(); return; }   // BAR: releasing Shift always returns home
        if (!isGridKey(e)) return;
        // match onKeyDown: in home, quick-cell keys (top 8) pass through; only categories consume
        if (!grid.isFactory && nav.category === null && KEYCODE_TO_SLOT[w] < 8) return;
        consume(e); return false;
      }
      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('keyup', onKeyUp, true);

      // --- mouse: click + hover routed up from the child panel ---------------
      function onCellClick(payload) {
        if (!grid.open || !payload) return;
        var slot = payload.slot, rmb = (payload.button === 2);
        if (grid.mode === 'home') {
          var hc = grid.cells && grid.cells[slot];
          if (rmb || !hc) return;
          if (hc.isCategory) openCategory(slot - 8);                                  // bottom row category button
          else if (hc.specId) enterFab(hc.specId, !!payload.shift, !!payload.ctrl);   // top 8 quick build
          return;
        }
        var cell = grid.cells && grid.cells[slot];
        if (!cell) return;
        // factory: RMB negates (cancel/decrement). fabber: RMB is PA's placement-cancel — ignore it here.
        if (grid.isFactory) doBuild(cell.specId, qtyFromMouse(payload.button || 0, !!payload.shift, !!payload.ctrl), spaceHeld);
        else if (!rmb) { enterFab(cell.specId, !!payload.shift, !!payload.ctrl); if (!payload.shift) goHome(); }
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
        if (!info) { showPanel(TIP_ID, false); return; }
        var p = api.panels[TIP_ID];
        if (p && p.id >= 0) { try { p.message('tip:show', info); } catch (e) {} }
        showPanel(TIP_ID, true);
      }
      var H = (typeof handlers !== 'undefined' && handlers) ? handlers : (window.handlers || null);
      if (H) { H['grid:click'] = onCellClick; H['grid:hover'] = onHover; H['grid:back'] = function () { goHome(); }; H['grid:page'] = function () { nextPage(); }; }
      else BA.warn('gridmenu: no handlers map — clicks/hover will not route');

      // --- boot --------------------------------------------------------------
      injectStyle();
      ensurePanels();
      if (pushTimer) clearInterval(pushTimer);
      pushTimer = setInterval(tick, 150);
      tick();
      // React to selection the instant PA processes it: model.selection is a ko
      // observable set at the end of parseSelection, and ko notifies subscribers
      // synchronously BEFORE the browser repaints — so we add the hide-class in the
      // same frame the native build bar would appear. Kills the select-commander flash.
      try { if (model.selection && model.selection.subscribe) model.selection.subscribe(tick); }
      catch (e) { BA.warn('gridmenu: selection subscribe failed: ' + (e && e.message)); }
      BA.log('gridmenu ready (M3) — factory: flat grid + batching (Space=front, B=page); '
        + 'fabber home: top 8 = quick build (economy/combat/utility), bottom 4 = Z/X/C/V categories; '
        + 'in a category: B=page, Esc/Shift=back; hover for info');
    }
  });
})();
