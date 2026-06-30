(function () {
  'use strict';
  var BA = window.BarAnnihilation; if (!BA) { return; }

  // ---------------------------------------------------------------------------
  // BUILDPLACE — BAR-style LINE / GRID build (M4).
  //
  // Claims SHIFT + left-DRAG on the holodeck WHILE A BUILD IS ARMED and lays a
  // row/field of that building evenly along the drag (gui_pregame_build.lua
  // determineBuildMode:504):
  //   shift + drag       = LINE   (faces ALONG the drag)
  //   shift + alt + drag = GRID    (faces along the drag's dominant axis)
  //   (ctrl reserved; ctrl+drag = AROUND, alt+ctrl = BOX are future phases)
  // PLAIN (no-shift) left presses are left FULLY NATIVE — PA's own click-to-place +
  // continuous left-drag-rotate (the user prefers mouse rotation over discrete keys,
  // 2026-06-30; the earlier [ / ] facing-key experiment was reverted). Single-building
  // facing = PA native; line/grid facing = the drag direction. No facing keys.
  //
  // Placement rides the PROVEN engine (build-probe B6): the NATIVE screen-coord
  // fab path holodeck.unitBeginFab/unitEndFab(snap=true) — the engine raycasts the
  // screen point, derives the upright surface orient, and grid-snaps. (sendOrder
  // 'build' was rejected: it builds tilted AND teleports the fabber.) The shared
  // line/grid facing is the begin->end screen vector. Spacing comes from the unit's
  // real placement_size + area_build_separation, fetched from the on-disk spec
  // (model.unitSpecs is stripped). World spacing without a projection fn:
  // dense-raycast the screen segment ONCE -> world polyline -> walk arc-length by
  // step -> lerp back to screen samples -> fab loop.
  //
  // CAPTURE SEAM: a document CAPTURE-phase mousedown fires before PA's bubble-phase
  // 'mousedown.stock'; when our predicate holds (shift+armed) we stopImmediatePropagation
  // so PA never starts its own fab/fab_rotate/input.capture for that press (PRE-EMPT).
  // Plain (no-shift) clicks fail the predicate and reach PA untouched, so native single
  // placement + native facing-drag are 100% preserved. We do NOT re-arm fab mode
  // (gridmenu already armed it) — re-arming would reset fabCount.
  // ---------------------------------------------------------------------------
  BA.register({
    name: 'buildplace',
    init: function () {
      var DRAG_PX = 8;            // press travel (screen px) before it counts as a drag
      var SAMPLES = 60;           // dense screen samples raycast along the drag (one batch)
      var MAXN = 200;             // BAR MAX_DRAG_BUILD_COUNT cap
      var FACE_PX = 60;           // begin->end screen offset that sets the shared facing
      var GHOST_DEFAULT_PX = 40;  // preview ghost spacing until the scale probe resolves
      var SPACING_UNIT = 8;       // world units of gap added per BAR spacing level (tunable analog of 2*SQUARE_SIZE)
      var SPACING_MAX = 16;       // BAR cmd_limit_build_spacing clamp

      function log(m) { BA.log('BUILD ' + m); }
      function uiScale() { try { var u = (typeof model !== 'undefined' && model.uiScale) ? (typeof model.uiScale === 'function' ? model.uiScale() : model.uiScale) : 1; return u || 1; } catch (e) { return 1; } }
      function hd() { try { return api.Holodeck.focused; } catch (e) { return null; } }
      function onHolodeck(t) { return !!(t && t.nodeName === 'HOLODECK'); }
      function px(cx, cy) { var s = uiScale(); return [Math.floor(cx * s), Math.floor(cy * s)]; }
      function baseSpec(id) { var m = String(id).match(/^(.*\.json)/); return m ? m[1] : String(id); }
      function d3sq(p, q) { var dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2]; return dx * dx + dy * dy + dz * dz; }

      // Are we in build/fab mode with a structure armed by gridmenu? Returns the
      // base spec id (tag suffix stripped) or null. ko observables called as fns.
      function armedSpec() {
        try {
          if (typeof model === 'undefined' || !model) return null;
          var mode = model.mode ? model.mode() : '';
          if (mode !== 'fab' && mode !== 'fab_rotate') return null;
          if (model.selectedMobile && !model.selectedMobile()) return null;   // factories never fab
          var id = model.currentBuildStructureId ? model.currentBuildStructureId() : '';
          return id ? baseSpec(id) : null;                                     // '' when disarmed -> null
        } catch (e) { return null; }
      }

      // --- footprint: model.unitSpecs is STRIPPED (no placement_size); fetch the
      // full unit JSON from disk like PA's own mod-manager ($.get 'spec://...',
      // which also resolves base_spec inheritance). Cache per spec. (build-probe.js)
      var SPEC_CACHE = {};
      function jq() { return (typeof window !== 'undefined') ? (window.$ || window.jQuery) : (typeof $ !== 'undefined' ? $ : null); }
      function fetchFullSpec(specId, cb) {
        if (SPEC_CACHE[specId]) { cb(SPEC_CACHE[specId]); return; }
        var $$ = jq(); if (!$$ || !$$.getJSON) { log('no jQuery for spec fetch'); cb(null); return; }
        var rel = String(specId).replace(/^\//, '');
        var done = function (spec) { SPEC_CACHE[specId] = spec; cb(spec); };
        try {
          $$.getJSON('spec://' + rel).done(done).fail(function () {
            $$.getJSON('coui://' + rel).done(done).fail(function () { log('fetchFullSpec FAIL: ' + rel); cb(null); });
          });
        } catch (e) { log('fetchFullSpec threw: ' + (e && e.message ? e.message : e)); cb(null); }
      }
      function footprintFromSpec(spec) {
        if (spec && spec.placement_size && spec.placement_size.length >= 2) {
          var sep = (typeof spec.area_build_separation === 'number') ? spec.area_build_separation : 2;
          return { x: spec.placement_size[0], z: spec.placement_size[1], sep: sep, raw: true };
        }
        return { x: 12, z: 12, sep: 2, raw: false };
      }
      function stepOf(fp) { return Math.max(fp.x, fp.z) + (fp.sep || 0); }

      // Per-building spacing (BAR cmd_persistent_build_spacing): int 0..MAX kept per spec
      // id in localStorage; widens the step by SPACING_UNIT per level (BAR adds
      // SQUARE_SIZE*spacing*2 to the footprint).
      var SPACE_LS_KEY = 'barann.buildspacing';
      var SPACING = {};
      try { var _sraw = (typeof window !== 'undefined' && window.localStorage) ? localStorage.getItem(SPACE_LS_KEY) : null; if (_sraw) SPACING = JSON.parse(_sraw) || {}; } catch (e) { SPACING = {}; }
      function getSpacing(spec) { var v = SPACING[spec]; return (typeof v === 'number') ? v : 0; }
      function setSpacing(spec, v) {
        v = Math.max(0, Math.min(SPACING_MAX, v | 0)); SPACING[spec] = v;
        try { if (typeof window !== 'undefined' && window.localStorage) localStorage.setItem(SPACE_LS_KEY, JSON.stringify(SPACING)); } catch (e) {}
        return v;
      }
      function stepWorld(fp, spec) { return stepOf(fp) + getSpacing(spec) * SPACING_UNIT; }

      // --- live preview overlay (no-input <panel> composited ON TOP of the 3D;
      // the live_game host doc paints BELOW the world). Same pattern as formations.
      var PANEL_ID = 'barann-buildplace-overlay';
      var PANEL_SRC = 'coui://ui/mods/com.pa.stephenshorton.bar-annihilation/buildplace_overlay.html';
      function ensurePanel() {
        // Recreate (don't reuse) so the panel HTML reloads on Ctrl+Shift+R (a
        // reused panel keeps its original HTML — panel-side edits would need a full
        // PA restart otherwise).
        var old = document.getElementById(PANEL_ID);
        if (old && old.parentNode) { try { old.parentNode.removeChild(old); } catch (e) {} }
        try {
          var p = document.createElement('panel');
          p.id = PANEL_ID;
          p.setAttribute('src', PANEL_SRC);
          p.setAttribute('no-input', '');
          p.setAttribute('no-keyboard', '');
          p.setAttribute('fit', 'dock');
          p.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:1480;pointer-events:none;';
          document.body.appendChild(p);
          api.Panel.bindElement(p);
          log('preview overlay panel bound: ' + PANEL_ID);
        } catch (e) { log('preview overlay panel bind failed: ' + (e && e.message ? e.message : e)); }
      }
      function panelMsg(evt, payload) { try { var p = api.panels[PANEL_ID]; if (p && p.message) p.message(evt, payload); } catch (e) {} }

      // Coalesce preview repaints to ONE per display frame (latest drag wins) — a
      // gaming mouse fires mousemove ~1000x/s. NO raycast per move; the preview is
      // a screen-space approximation, the authoritative raycast runs once on release.
      var RAF = (typeof window !== 'undefined' && window.requestAnimationFrame) ? function (f) { return window.requestAnimationFrame(f); } : null;
      var FRAME_MS = 16;
      var rafPending = false, lastFrame = 0, frameTimer = null, frameArg = null;
      function flush() { rafPending = false; frameTimer = null; if (frameArg) paintNow(frameArg); }
      function paintNow(d) {
        lastFrame = Date.now();
        if (!d || !d.moved) { panelMsg('build.clear', {}); return; }
        if (d.mode === 'single') { panelMsg('build.clear', {}); return; }   // Shift released -> no line/grid preview (PA's hover ghost shows the single)
        var W = window.innerWidth || 1920, H = window.innerHeight || 1080;
        // approximate ghost spacing in screen px: world step / (world-units-per-px).
        // Floor only (no ceiling): zoomed in, buildings genuinely ARE far apart on
        // screen, and a 240px cap pinned the spacing flat so the spacing modifier looked
        // dead. Floor keeps the draw loop from stalling; MAXN bounds the count.
        var ghostPx = (d.step && d.wpp) ? Math.max(6, d.step / (d.wpp * uiScale())) : GHOST_DEFAULT_PX;
        var ghosts = [], guard = 0;
        if (d.mode === 'grid') {                                    // box of ghosts filling the drag rectangle
          var gx0 = Math.min(d.x0, d.x1), gx1 = Math.max(d.x0, d.x1), gy0 = Math.min(d.y0, d.y1), gy1 = Math.max(d.y0, d.y1), yy, xx;
          for (yy = gy0; yy <= gy1 && guard < MAXN; yy += ghostPx) {
            for (xx = gx0; xx <= gx1 && guard < MAXN; xx += ghostPx, guard++) ghosts.push([xx / W, yy / H]);
          }
          panelMsg('build.draw', { stroke: [], ghosts: ghosts, color: '#6ef06e' });
        } else {                                                    // line: stroke + ghosts along the drag
          var dx = d.x1 - d.x0, dy = d.y1 - d.y0, len = Math.sqrt(dx * dx + dy * dy) || 1;
          var ux = dx / len, uy = dy / len, dpx = 0;
          for (dpx = 0; dpx <= len && guard < MAXN; dpx += ghostPx, guard++) ghosts.push([(d.x0 + ux * dpx) / W, (d.y0 + uy * dpx) / H]);
          panelMsg('build.draw', { stroke: [[d.x0 / W, d.y0 / H], [d.x1 / W, d.y1 / H]], ghosts: ghosts, color: '#6ef06e' });
        }
      }
      function drawPreview(d) {
        frameArg = d;
        if (RAF) { if (!rafPending) { rafPending = true; RAF(flush); } return; }
        var dt = Date.now() - lastFrame;
        if (dt >= FRAME_MS) { if (frameTimer) { clearTimeout(frameTimer); frameTimer = null; } flush(); }
        else if (!frameTimer) { frameTimer = setTimeout(flush, FRAME_MS - dt); }
      }
      function clearPreview() {
        frameArg = null; rafPending = false;
        if (frameTimer) { clearTimeout(frameTimer); frameTimer = null; }
        panelMsg('build.clear', {}); lastFrame = Date.now();
      }

      ensurePanel();

      // --- state -----------------------------------------------------------------
      var drag = null;       // { spec, x0,y0, x1,y1, moved, step, wpp }
      var placing = false;   // a commit (async raycast + fab loop) is in flight

      function endDrag() { drag = null; window.__barLineDragging = false; clearPreview(); }

      // Build mode from the LIVE modifier state. BAR: releasing Shift mid-drag CLEARS
      // the line anchor permanently (re-pressing Shift won't restore it), so once
      // dropped we stay 'single' for the rest of the drag. Shift+Alt = grid.
      function dragMode(e, dr) {
        if (!e.shiftKey) dr.dropped = true;
        return dr.dropped ? 'single' : (e.altKey ? 'grid' : 'line');
      }

      // --- capture-phase listeners ----------------------------------------------
      function onDown(e) {
        // Stale-drag recovery: ANY fresh mousedown means a prior gesture is over
        // (lost mouseup from alt-tab/off-window, or an RMB chord). Clearing here is
        // also how an RMB during our drag aborts the line: we drop drag, fail the
        // predicate (button!==0), don't stop propagation, and PA's native RMB-cancel
        // runs. (Critical: a stale drag left live would make the NEXT plain click's
        // onUp stopImmediatePropagation PA's input.capture overlay and lock input.)
        if (drag) endDrag();
        // During an in-flight commit, fab is still armed; block a stray left press on
        // the holodeck so PA can't start a concurrent native fab and corrupt fab state.
        if (placing) { if (e.button === 0 && onHolodeck(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); } return; }
        if (e.button !== 0 || !e.shiftKey || e.ctrlKey) return;    // BAR: shift+drag (no ctrl); PLAIN left stays native (PA click-place + drag-rotate)
        if (!onHolodeck(e.target)) return;
        if (BA.util.uiBusy && BA.util.uiBusy()) return;
        var spec = armedSpec(); if (!spec) return;                 // only when a build is armed
        e.preventDefault(); e.stopImmediatePropagation();          // PRE-EMPT PA's native fab for this shift press
        // BAR determineBuildMode: shift+alt = GRID, shift alone = LINE.
        drag = { spec: spec, mode: e.altKey ? 'grid' : 'line', dropped: false, x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, moved: false, step: 0, wpp: 0 };
        var dref = drag;                                           // identity guard for the async callbacks below
        window.__barLineDragging = true;
        // prefetch footprint (so step is ready by mouseup) ...
        fetchFullSpec(spec, function (full) { if (drag === dref) { dref.fp = footprintFromSpec(full); dref.step = stepWorld(dref.fp, spec); } });
        // ... and probe world-units-per-RENDER-px once, for the preview ghost spacing.
        var h = hd();
        if (h && h.raycast) {
          var a = px(e.clientX, e.clientY);
          try {
            h.raycast([[a[0], a[1]], [a[0] + 100, a[1]]]).then(function (hits) {
              if (drag === dref && hits && hits[0] && hits[0].pos && hits[1] && hits[1].pos) {
                dref.wpp = Math.sqrt(d3sq(hits[1].pos, hits[0].pos)) / 100;
              }
            }, function () {});
          } catch (e2) {}
        }
      }

      function onMove(e) {
        if (!drag) return;
        // NOTE: do NOT gate on e.buttons here — PA's Coherent webview reports
        // e.buttons=0 during capture-phase mousemove, which would kill the drag on
        // the first move. Lost-mouseup recovery is handled by onDown stale-clear +
        // blur/mouseleave instead.
        drag.x1 = e.clientX; drag.y1 = e.clientY;
        drag.mode = dragMode(e, drag);                   // BAR re-evaluates the mode LIVE during the drag
        var dx = drag.x1 - drag.x0, dy = drag.y1 - drag.y0;
        if (!drag.moved && (dx * dx + dy * dy) >= DRAG_PX * DRAG_PX) drag.moved = true;
        drawPreview(drag);
        e.stopImmediatePropagation();
      }

      function onUp(e) {
        if (!drag || e.button !== 0) return;
        e.preventDefault(); e.stopImmediatePropagation();
        var d = drag;
        d.x1 = e.clientX; d.y1 = e.clientY;                        // mouseup is the authoritative end point
        d.mode = dragMode(e, d);                                   // final mode (single if Shift was released mid-drag)
        var dx = d.x1 - d.x0, dy = d.y1 - d.y0;
        if (!d.moved && (dx * dx + dy * dy) >= DRAG_PX * DRAG_PX) d.moved = true;
        var stillShift = e.shiftKey;
        endDrag();                                                 // clears drag + flag + preview
        var h = hd(); if (!h || !h.raycast || !h.unitBeginFab || !h.unitEndFab) { log('holodeck fab/raycast unavailable'); return; }
        if (d.mode === 'single' || !d.moved) { placeSingle(h, px(d.x1, d.y1), stillShift); return; }   // Shift dropped or no drag -> one at cursor
        if (d.mode === 'grid') commitGrid(d, h, stillShift); else commitLine(d, h, stillShift);
      }

      function onEsc(e) {
        // Cancel an in-progress line; do NOT consume the event so PA's native Esc
        // still exits fab mode (BAR: Esc = get out).
        if ((e.keyCode === 27 || e.which === 27) && drag) endDrag();
      }
      // Switch line<->grid live when Alt is pressed/released mid-drag with the mouse
      // stationary (mousemove already handles it while moving). Observe only — never
      // consume, so Alt stays available to PA/other binds.
      function onMod(e) {
        if (!drag) return;
        var m = dragMode(e, drag);
        if (m !== drag.mode) { drag.mode = m; if (drag.moved) drawPreview(drag); }
      }
      // BAR buildspacing bind (grid_keys.txt): Alt+Z = inc, Alt+X = dec — and
      // Shift+Alt+Z/X too, so you tweak it mid grid-drag with Shift+Alt already held.
      // Per-building, persisted. Only consumed in build mode; works armed AND live mid-drag.
      function onSpace(e) {
        if (!e.altKey) return;                                                              // spacing is Alt-modified (Alt = grid, so this naturally pairs)
        var code = e.which || e.keyCode, dir = (code === 90) ? 1 : (code === 88) ? -1 : 0;   // Z=inc  X=dec
        if (!dir) return;
        var spec = armedSpec(); if (!spec) return;
        e.preventDefault(); e.stopImmediatePropagation();
        var v = setSpacing(spec, getSpacing(spec) + dir);
        if (drag) { if (drag.fp) drag.step = stepWorld(drag.fp, spec); if (drag.moved) drawPreview(drag); }
        panelMsg('build.flash', { text: 'Spacing ' + v });
        log('spacing[' + spec + '] = ' + v);
      }

      // Recovery: a mouseup lost off-window/on blur would strand drag. Clear it.
      function onBlur() { if (drag) endDrag(); }
      function onLeave(e) { if (drag && (e.target === document || e.relatedTarget === null)) endDrag(); }

      // --- placement (the proven build-probe engine, no re-arm) -------------------
      // Single placement (only reached via a SHIFT gesture: shift+click, or a
      // shift-drag that degraded to single). Default facing (begin==end). Queue
      // semantics mirror PA native fab mouseup (enterQueueMode(shiftKey)): Shift held
      // = append + stay armed; no Shift = replace + exit fab mode. Confirm sound +
      // marker mirror native (live_game.js:3192-3197).
      function placeSingle(h, sp, stillShift) {
        var q = !!stillShift;
        try {
          h.unitBeginFab(sp[0], sp[1], true);
          var rp = h.unitEndFab(sp[0], sp[1], q, true);
          try { h.showCommandConfirmation('', sp[0], sp[1]); } catch (e) {}
          if (rp && rp.then) rp.then(function (ok) { if (ok) { try { api.audio.playSound('/SE/UI/UI_Building_place'); } catch (e2) {} } }, function () {});
        } catch (e) { log('single place threw: ' + e); }
        if (!stillShift) { try { if (model.endFabMode) model.endFabMode(); } catch (e) {} }
      }

      // finishCommit is the SINGLE guaranteed exit — every error path must reach it or
      // `placing` stays true and silently disables line build for the rest of the match.
      function commitLine(d, h, stillShift) {
        placing = true;
        fetchFullSpec(d.spec, function (full) {
          try {
            var fp = footprintFromSpec(full), step = Math.max(1, stepWorld(fp, d.spec));   // clamp: degenerate footprint -> no infinite stack
            if (!fp.raw) log('footprint DEFAULTED for ' + d.spec + ' (spec fetch missed) — spacing may be off');
            log('line: step ' + step.toFixed(0) + ' (spacing ' + getSpacing(d.spec) + ')');
            var a = px(d.x0, d.y0), b = px(d.x1, d.y1), pts = [], s;
            for (s = 0; s <= SAMPLES; s++) { var t = s / SAMPLES; pts.push([Math.round(a[0] + t * (b[0] - a[0])), Math.round(a[1] + t * (b[1] - a[1]))]); }
            var rr = h.raycast(pts);
            if (!rr || !rr.then) { log('line raycast not thenable'); finishCommit(stillShift); return; }
            rr.then(function (hits) {
              try {
                if (!hits || !hits.length) { log('line raycast empty'); finishCommit(stillShift); return; }
                var poly = [], i;
                for (i = 0; i < hits.length; i++) { if (hits[i] && hits[i].pos) poly.push({ scr: pts[i], pos: hits[i].pos }); }
                if (poly.length < 2) { log('drag crossed too little open ground (' + poly.length + ' hits)'); finishCommit(stillShift); return; }
                var cum = [0], j;
                for (j = 1; j < poly.length; j++) cum.push(cum[j - 1] + Math.sqrt(d3sq(poly[j].pos, poly[j - 1].pos)));
                var total = cum[cum.length - 1], placements = [], dd;
                for (dd = 0; dd <= total && placements.length < MAXN; dd += step) {
                  var k = 1; while (k < cum.length && cum[k] < dd) k++; if (k >= cum.length) k = cum.length - 1;
                  var seg = (cum[k] - cum[k - 1]) || 1, f = (dd - cum[k - 1]) / seg;
                  placements.push([Math.round(poly[k - 1].scr[0] + f * (poly[k].scr[0] - poly[k - 1].scr[0])), Math.round(poly[k - 1].scr[1] + f * (poly[k].scr[1] - poly[k - 1].scr[1]))]);
                }
                placeLine(h, placements, stillShift);
              } catch (e) { log('commit then threw: ' + (e && e.message ? e.message : e)); finishCommit(stillShift); }
            }, function (err) { log('line raycast rejected: ' + err); finishCommit(stillShift); });
          } catch (e) { log('commit body threw: ' + (e && e.message ? e.message : e)); finishCommit(stillShift); }
        });
      }

      // GRID (Shift+Alt): fill the drag's screen-axis-aligned rectangle with a
      // world-even grid, snake-filled (BAR getBuildPositionsGrid: alternate row dir
      // for travel-optimal build order). Screen step per axis derived from a single
      // centre scale-probe (world-units-per-render-px in X and Y); the engine grid-
      // snaps each placement, so approximate screen spacing is fine.
      function commitGrid(d, h, stillShift) {
        placing = true;
        fetchFullSpec(d.spec, function (full) {
          try {
            var fp = footprintFromSpec(full), step = Math.max(1, stepWorld(fp, d.spec));
            if (!fp.raw) log('footprint DEFAULTED for ' + d.spec + ' (spec fetch missed) — spacing may be off');
            var a0 = px(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1));
            var a1 = px(Math.max(d.x0, d.x1), Math.max(d.y0, d.y1));
            var rx0 = a0[0], ry0 = a0[1], rx1 = a1[0], ry1 = a1[1];
            var cxr = Math.round((rx0 + rx1) / 2), cyr = Math.round((ry0 + ry1) / 2);
            var rr = h.raycast([[cxr, cyr], [cxr + 100, cyr], [cxr, cyr + 100]]);   // centre + X + Y probes, one batch
            if (!rr || !rr.then) { log('grid probe not thenable'); finishCommit(stillShift); return; }
            rr.then(function (hits) {
              try {
                if (!hits || !hits[0] || !hits[0].pos) { log('grid: centre off terrain'); finishCommit(stillShift); return; }
                var wppX = (hits[1] && hits[1].pos) ? Math.sqrt(d3sq(hits[1].pos, hits[0].pos)) / 100 : 0;
                var wppY = (hits[2] && hits[2].pos) ? Math.sqrt(d3sq(hits[2].pos, hits[0].pos)) / 100 : 0;
                if (!wppX) { log('grid: bad X scale probe'); finishCommit(stillShift); return; }
                if (!wppY) wppY = wppX;
                var sx = Math.max(4, step / wppX), sy = Math.max(4, step / wppY);   // screen step px per axis
                var cols = Math.max(1, Math.floor((rx1 - rx0) / sx) + 1), rows = Math.max(1, Math.floor((ry1 - ry0) / sy) + 1);
                while (cols * rows > MAXN) { if (cols >= rows) cols--; else rows--; }   // cap total
                var placements = [], r, c, cc;
                for (r = 0; r < rows; r++) {
                  var py = Math.round(ry0 + r * sy);
                  for (c = 0; c < cols; c++) { cc = (r % 2 === 0) ? c : (cols - 1 - c); placements.push([Math.round(rx0 + cc * sx), py]); }   // snake-fill
                }
                log('grid: ' + cols + 'x' + rows + ' = ' + placements.length + ' (step ' + step.toFixed(0) + ', spacing ' + getSpacing(d.spec) + ')');
                // face along the drag's dominant axis (wider drag -> horizontal facing)
                var gdx = d.x1 - d.x0, gdy = d.y1 - d.y0;
                var gFace = (Math.abs(gdx) >= Math.abs(gdy)) ? [(gdx >= 0 ? 1 : -1) * FACE_PX, 0] : [0, (gdy >= 0 ? 1 : -1) * FACE_PX];
                placeLine(h, placements, stillShift, gFace);
              } catch (e) { log('grid then threw: ' + (e && e.message ? e.message : e)); finishCommit(stillShift); }
            }, function (err) { log('grid probe rejected: ' + err); finishCommit(stillShift); });
          } catch (e) { log('grid body threw: ' + (e && e.message ? e.message : e)); finishCommit(stillShift); }
        });
      }

      function finishCommit(stillShift) {
        if (!stillShift) { try { if (model.endFabMode) model.endFabMode(); } catch (e) {} }
        placing = false;
      }

      function placeLine(h, placements, stillShift, faceVec) {
        if (!placements.length) { finishCommit(stillShift); return; }
        // One shared facing for the whole batch so buildings line up (no per-position
        // auto-rotate). faceVec wins if given (grid passes its dominant drag axis);
        // else derive from the line's endpoints (face ALONG the drag).
        var faceDx = 0, faceDy = 0;
        if (faceVec) { faceDx = faceVec[0]; faceDy = faceVec[1]; }
        else if (placements.length >= 2) {
          var vx = placements[placements.length - 1][0] - placements[0][0], vy = placements[placements.length - 1][1] - placements[0][1];
          var L = Math.sqrt(vx * vx + vy * vy) || 1; faceDx = Math.round(vx / L * FACE_PX); faceDy = Math.round(vy / L * FACE_PX);
        }
        var idx = 0;
        (function placeNext() {
          if (idx >= placements.length) { log('line: ' + placements.length + ' placed'); finishCommit(stillShift); return; }
          var p = placements[idx], cur = idx, r; idx++;
          try { h.unitBeginFab(p[0], p[1], true); r = h.unitEndFab(p[0] + faceDx, p[1] + faceDy, true, true); }   // queue=true (append) for all
          catch (e) { log('fab[' + cur + '] threw ' + (e && e.message ? e.message : e)); placeNext(); return; }
          if (r && r.then) r.then(function () { placeNext(); }, function (e) { log('endFab[' + cur + '] FAIL ' + e); placeNext(); });
          else placeNext();
        })();
      }

      // --- idempotency + recovery wiring -----------------------------------------
      if (window.__barBuildplaceCleanup) { try { window.__barBuildplaceCleanup(); } catch (e) {} }
      document.addEventListener('mousedown', onDown, true);
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup', onUp, true);
      document.addEventListener('keydown', onEsc, true);
      document.addEventListener('keydown', onMod, true);
      document.addEventListener('keyup', onMod, true);
      document.addEventListener('keydown', onSpace, true);
      window.addEventListener('blur', onBlur, true);
      document.addEventListener('mouseleave', onLeave, true);
      window.__barBuildplaceCleanup = function () {
        document.removeEventListener('mousedown', onDown, true);
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mouseup', onUp, true);
        document.removeEventListener('keydown', onEsc, true);
        document.removeEventListener('keydown', onMod, true);
        document.removeEventListener('keyup', onMod, true);
        document.removeEventListener('keydown', onSpace, true);
        window.removeEventListener('blur', onBlur, true);
        document.removeEventListener('mouseleave', onLeave, true);
        try { if (frameTimer) clearTimeout(frameTimer); } catch (e) {}
        window.__barLineDragging = false;
      };

      log('buildplace ready (v10) — plain left = NATIVE (place + drag-rotate); Shift+drag = LINE, +Alt = GRID (face along drag); Alt+Z/X = spacing (per-building); release Shift = single');
    }
  });
})();
