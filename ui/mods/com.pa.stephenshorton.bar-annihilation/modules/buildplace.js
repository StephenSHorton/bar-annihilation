(function () {
  'use strict';
  var BA = window.BarAnnihilation; if (!BA) { return; }

  // ---------------------------------------------------------------------------
  // BUILDPLACE — BAR-style LINE build (Phase 1 of M4).
  //
  // Claims SHIFT + left-DRAG on the holodeck WHILE A BUILD IS ARMED and lays a
  // row of that building evenly along the drag, all sharing one facing. This is
  // BAR's exact gesture mapping (gui_pregame_build.lua determineBuildMode:504):
  //   shift + drag, no alt/ctrl = LINE  (alt = GRID, alt+ctrl = BOX, ctrl = AROUND
  //   are RESERVED for later phases — we claim ONLY plain shift).
  //
  // Placement rides the PROVEN engine (build-probe B6): the NATIVE screen-coord
  // fab path holodeck.unitBeginFab/unitEndFab(snap=true) — the engine raycasts the
  // screen point, derives the upright surface orient, and grid-snaps. (sendOrder
  // 'build' was rejected: it builds tilted AND teleports the fabber.) Spacing comes
  // from the unit's real placement_size + area_build_separation, fetched from the
  // on-disk spec (model.unitSpecs is stripped). World spacing without a projection
  // fn: dense-raycast the screen segment ONCE -> world polyline -> walk arc-length
  // by step -> lerp back to screen samples -> fab loop.
  //
  // CAPTURE SEAM: a document CAPTURE-phase mousedown fires before PA's bubble-phase
  // 'mousedown.stock'; when our predicate holds we stopImmediatePropagation so PA
  // never starts its own fab_rotate/input.capture for that press (PRE-EMPT). Plain
  // (no-shift) clicks fail the predicate and reach PA untouched, so native single
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
        var W = window.innerWidth || 1920, H = window.innerHeight || 1080;
        // approximate ghost spacing in screen px: world step / (world-units-per-px)
        var ghostPx = (d.step && d.wpp) ? Math.max(8, Math.min(240, d.step / (d.wpp * uiScale()))) : GHOST_DEFAULT_PX;
        var dx = d.x1 - d.x0, dy = d.y1 - d.y0, len = Math.sqrt(dx * dx + dy * dy) || 1;
        var ux = dx / len, uy = dy / len, ghosts = [], dpx = 0, guard = 0;
        for (dpx = 0; dpx <= len && guard < MAXN; dpx += ghostPx, guard++) {
          ghosts.push([(d.x0 + ux * dpx) / W, (d.y0 + uy * dpx) / H]);
        }
        panelMsg('build.draw', { stroke: [[d.x0 / W, d.y0 / H], [d.x1 / W, d.y1 / H]], ghosts: ghosts, color: '#6ef06e' });
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
        if (e.button !== 0 || !e.shiftKey || e.altKey || e.ctrlKey) return;   // BAR LINE = shift only
        if (!onHolodeck(e.target)) return;
        if (BA.util.uiBusy && BA.util.uiBusy()) return;
        var spec = armedSpec(); if (!spec) return;                 // only when a build is armed
        e.preventDefault(); e.stopImmediatePropagation();          // PRE-EMPT PA's native fab for this press
        drag = { spec: spec, x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, moved: false, step: 0, wpp: 0 };
        var dref = drag;                                           // identity guard for the async callbacks below
        window.__barLineDragging = true;
        // prefetch footprint (so step is ready by mouseup) ...
        fetchFullSpec(spec, function (full) { if (drag === dref) dref.step = stepOf(footprintFromSpec(full)); });
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
        if (!(e.buttons & 1)) { endDrag(); return; }     // left no longer held -> lost mouseup, self-heal
        drag.x1 = e.clientX; drag.y1 = e.clientY;
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
        var dx = d.x1 - d.x0, dy = d.y1 - d.y0;
        if (!d.moved && (dx * dx + dy * dy) >= DRAG_PX * DRAG_PX) d.moved = true;
        var stillShift = e.shiftKey;
        endDrag();                                                 // clears drag + flag + preview
        var h = hd(); if (!h || !h.raycast || !h.unitBeginFab || !h.unitEndFab) { log('holodeck fab/raycast unavailable'); return; }
        if (!d.moved) { placeSingle(h, px(d.x0, d.y0), stillShift); return; }
        commitLine(d, h, stillShift);
      }

      function onEsc(e) {
        // Cancel an in-progress line; do NOT consume the event so PA's native Esc
        // still exits fab mode (BAR: Esc = get out).
        if ((e.keyCode === 27 || e.which === 27) && drag) endDrag();
      }

      // Recovery: a mouseup lost off-window/on blur would strand drag. Clear it.
      function onBlur() { if (drag) endDrag(); }
      function onLeave(e) { if (drag && (e.target === document || e.relatedTarget === null)) endDrag(); }

      // --- placement (the proven build-probe engine, no re-arm) -------------------
      function placeSingle(h, sp, stillShift) {
        try { h.unitBeginFab(sp[0], sp[1], true); h.unitEndFab(sp[0], sp[1], true, true); } catch (e) { log('single place threw: ' + e); }
        if (!stillShift) { try { if (model.endFabMode) model.endFabMode(); } catch (e) {} }
      }

      // finishCommit is the SINGLE guaranteed exit — every error path must reach it or
      // `placing` stays true and silently disables line build for the rest of the match.
      function commitLine(d, h, stillShift) {
        placing = true;
        fetchFullSpec(d.spec, function (full) {
          try {
            var fp = footprintFromSpec(full), step = Math.max(1, stepOf(fp));   // clamp: degenerate footprint -> no infinite stack
            if (!fp.raw) log('footprint DEFAULTED for ' + d.spec + ' (spec fetch missed) — spacing may be off');
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

      function finishCommit(stillShift) {
        if (!stillShift) { try { if (model.endFabMode) model.endFabMode(); } catch (e) {} }
        placing = false;
      }

      function placeLine(h, placements, stillShift) {
        if (!placements.length) { finishCommit(stillShift); return; }
        // One shared begin->end facing vector so every building lines up (on a sphere
        // the engine default points a different screen-way per position). A single
        // placement uses default facing (faceDx/Dy=0) to match placeSingle.
        var faceDx = 0, faceDy = 0;
        if (placements.length >= 2) {
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
      window.addEventListener('blur', onBlur, true);
      document.addEventListener('mouseleave', onLeave, true);
      window.__barBuildplaceCleanup = function () {
        document.removeEventListener('mousedown', onDown, true);
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mouseup', onUp, true);
        document.removeEventListener('keydown', onEsc, true);
        window.removeEventListener('blur', onBlur, true);
        document.removeEventListener('mouseleave', onLeave, true);
        try { if (frameTimer) clearTimeout(frameTimer); } catch (e) {}
        window.__barLineDragging = false;
      };

      log('buildplace ready — Shift+left-drag in build mode = BAR line; plain click = native single placement');
    }
  });
})();
