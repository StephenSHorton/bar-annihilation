(function () {
  'use strict';
  var BA = window.BarAnnihilation; if (!BA) { return; }

  // ---------------------------------------------------------------------------
  // FORMATIONS — Phase 1 + armed-verb.
  //
  // Claims EVERY right-DRAG on the holodeck and turns it into a per-unit
  // formation: units spread evenly along the drawn line, each gets its OWN
  // destination via worldview.sendOrder (proven 2026-06-28). The command is the
  // ARMED command if one is on the cursor (our a/e/r/... cmd-mode keys, i.e.
  // model.cmdIndex()/model.commands()), else MOVE. A right-CLICK (no drag) issues
  // the armed command at a point (or PA's smart command if none), and disarms.
  //
  // Phase 1 scope: STRAIGHT line, simple ordered assignment, no preview. Next:
  // freehand curve capture, the on-screen per-unit dots, optimal (Hungarian/NoX)
  // non-crossing assignment, per-command nuance.
  //
  // Native custom-formations are forced OFF: we are deliberately REPLACING PA's
  // native move-spline, and a leaked drag then degrades to a single-point move
  // rather than a competing native formation.
  // ---------------------------------------------------------------------------
  BA.register({
    name: 'formations',
    init: function () {
      var DRAG_PX = 8;      // press travel (screen px) before it counts as a drag
      var PATH_MIN_PX = 6;  // min screen-px gap between captured freehand points
      var MIN_UNITS = 2;    // <2 selected -> ordinary single command, no formation

      function log(m) { BA.log('FORM ' + m); }
      function uiScale() { try { var u = (typeof model !== 'undefined' && model.uiScale) ? (typeof model.uiScale === 'function' ? model.uiScale() : model.uiScale) : 1; return u || 1; } catch (e) { return 1; } }
      function wv() { try { return api.getWorldView ? api.getWorldView(0) : null; } catch (e) { return null; } }
      function hd() { try { return api.Holodeck.focused; } catch (e) { return null; } }
      function onHolodeck(t) { return !!(t && t.nodeName === 'HOLODECK'); }
      function px(cx, cy) { var s = uiScale(); return [Math.floor(cx * s), Math.floor(cy * s)]; }
      function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
      function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
      function dist(a, b) { var dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2]; return Math.sqrt(dx * dx + dy * dy + dz * dz); }

      // Resample a screen-space polyline to n points spaced EVENLY BY ARC LENGTH
      // (port of BAR's GetInterpNodes), endpoints pinned. path = [[x,y],...] client px.
      function resample(path, n) {
        if (n <= 1) return [path[0].slice()];
        if (path.length < 2) { var dup = []; for (var i = 0; i < n; i++) dup.push(path[0].slice()); return dup; }
        var cum = [0];
        for (var k = 1; k < path.length; k++) { var dx = path[k][0] - path[k - 1][0], dy = path[k][1] - path[k - 1][1]; cum.push(cum[k - 1] + Math.sqrt(dx * dx + dy * dy)); }
        var total = cum[cum.length - 1];
        if (total === 0) { var d2 = []; for (var j = 0; j < n; j++) d2.push(path[0].slice()); return d2; }
        var out = [], seg = 0;
        for (var i2 = 0; i2 < n; i2++) {
          var target = total * i2 / (n - 1);
          while (seg < path.length - 2 && cum[seg + 1] < target) seg++;
          var segLen = cum[seg + 1] - cum[seg];
          var f = segLen > 0 ? (target - cum[seg]) / segLen : 0;
          out.push([path[seg][0] + (path[seg + 1][0] - path[seg][0]) * f, path[seg][1] + (path[seg + 1][1] - path[seg][1]) * f]);
        }
        return out;
      }

      // The command currently armed on the cursor ('' = default). Reads PA's own
      // command-mode state (set by our cmd-mode keys via model.setCommandIndex).
      function armedVerb() {
        try {
          if (typeof model === 'undefined' || !model || !model.cmdIndex) return '';
          var idx = model.cmdIndex();
          if (idx === undefined || idx === null || idx < 0) return '';
          var cmds = model.commands ? model.commands() : null;
          return (cmds && cmds[idx]) ? cmds[idx] : '';
        } catch (e) { return ''; }
      }
      function disarm() { try { if (typeof model !== 'undefined' && model && model.endCommandMode) model.endCommandMode(); } catch (e) {} }
      // armed command verb -> worldview.sendOrder verb for a ground-point spread.
      function sendVerb(armed) {
        if (!armed || armed === 'move') return 'move';
        if (armed === 'attack') return 'attack_ground';   // attack a ground point (= attack-move), confirmed
        return armed;                                      // patrol/reclaim/repair/assist/... pass through
      }

      // Replace native move-spline: turn PA's own custom formations off.
      try { if (typeof model !== 'undefined' && model && model.allowCustomFormations) model.allowCustomFormations(false); } catch (e) {}

      // --- live preview overlay --------------------------------------------------
      // The live_game host document is composited BELOW the 3D world and NEVER
      // paints body DOM over the holodeck (a raw <canvas> appended to body is
      // invisible — learned the hard way). So the preview is rendered inside a
      // no-input <panel> VIEW (formation_overlay.html) which the engine composites
      // ON TOP of the 3D — the same trick PA's own build_hover overlay uses. We
      // push it the normalized stroke + per-unit slots each frame via
      // panel.message; the view just draws.
      var PANEL_ID = 'barann-formation-overlay';
      var PANEL_SRC = 'coui://ui/mods/com.pa.stephenshorton.bar-annihilation/formation_overlay.html';
      function ensureFormPanel() {
        if (document.getElementById(PANEL_ID)) return;
        try {
          var p = document.createElement('panel');
          p.id = PANEL_ID;
          p.setAttribute('src', PANEL_SRC);
          p.setAttribute('no-input', '');       // click-through (proven: PA's build_hover panel)
          p.setAttribute('no-keyboard', '');
          p.setAttribute('fit', 'dock');
          p.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:1480;pointer-events:none;';
          document.body.appendChild(p);
          api.Panel.bindElement(p);
          log('preview overlay panel bound: ' + PANEL_ID);
        } catch (e) { log('preview overlay panel bind failed: ' + (e && e.message ? e.message : e)); }
      }
      function panelMsg(evt, payload) {
        try { var p = api.panels[PANEL_ID]; if (p && p.message) p.message(evt, payload); } catch (e) {}
      }

      function verbColor(armed) {                          // BAR-ish colors by command
        if (armed === 'attack' || armed === 'special_attack') return '#ff4b4b';   // red
        if (armed === 'reclaim' || armed === 'unload') return '#ffd23f';           // yellow
        if (armed === 'patrol') return '#7ad7ff';                                  // light blue
        return '#6ef06e';                                                          // move/default = green
      }

      // HARD time-throttle on the WHOLE preview (~45/sec max). A gaming mouse fires
      // mousemove hundreds-to-1000x/sec; recomputing the per-unit spread (resample
      // over the whole path × selection size) AND pushing a full panel redraw on
      // every move floods Coherent — and it scales with unit count, so it bit hard
      // at 105 units. The earlier version only throttled the SEND; the compute still
      // ran per move. Now we gate the entire compute on wall-clock, keep only the
      // latest drag, and guarantee a trailing frame so the final shape isn't dropped.
      // (Not requestAnimationFrame — it wasn't reliably coalescing in this scene.)
      var FRAME_MS = 22;          // ~45 fps; plenty smooth for a preview, much lighter
      var MARKER_MAX = 64;        // cap preview dots (orders still go to ALL units; >64 dots just overlap)
      var lastFrame = 0, frameTimer = null, frameArg = null;
      function paintNow(d) {
        lastFrame = Date.now();
        if (!d || !d.moved || d.path.length < 2) { panelMsg('form.clear', {}); return; }
        var W = window.innerWidth || 1920, H = window.innerHeight || 1080, i;
        var line = d.path.length > 64 ? resample(d.path, 64) : d.path;   // cap the line polyline
        var stroke = [];
        for (i = 0; i < line.length; i++) stroke.push([line[i][0] / W, line[i][1] / H]);
        var slots = [];
        if (d.n >= 2) {                                     // one marker per unit (capped), evenly along the stroke
          var s = resample(d.path, d.n > MARKER_MAX ? MARKER_MAX : d.n);
          for (i = 0; i < s.length; i++) slots.push([s[i][0] / W, s[i][1] / H]);
        }
        panelMsg('form.draw', { stroke: stroke, slots: slots, color: verbColor(d.armed) });
      }
      function drawPreview(d) {                            // throttles the COMPUTE, not just the send
        frameArg = d;
        var dt = Date.now() - lastFrame;
        if (dt >= FRAME_MS) { if (frameTimer) { clearTimeout(frameTimer); frameTimer = null; } paintNow(d); }
        else if (!frameTimer) { frameTimer = setTimeout(function () { frameTimer = null; if (frameArg) paintNow(frameArg); }, FRAME_MS - dt); }
      }
      function clearPreview() {
        frameArg = null;
        if (frameTimer) { clearTimeout(frameTimer); frameTimer = null; }
        panelMsg('form.clear', {}); lastFrame = Date.now();   // immediate clear on release/esc
      }

      ensureFormPanel();   // pre-create the transparent, click-through overlay panel

      var drag = null;   // { x0,y0, x1,y1, moved, queue, path, n, armed }

      function onDown(e) {
        if (e.button !== 2 || !onHolodeck(e.target)) return;
        if (BA.util.uiBusy && BA.util.uiBusy()) return;
        e.preventDefault(); e.stopImmediatePropagation();   // beat PA's bubble-phase 'mousedown.stock'
        var sel = BA.util.readSelection();
        drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, moved: false, queue: !!e.shiftKey, path: [[e.clientX, e.clientY]], n: (sel && sel.ids) ? sel.ids.length : 0, armed: armedVerb() };
      }
      function onMove(e) {
        if (!drag) return;
        drag.x1 = e.clientX; drag.y1 = e.clientY;
        var last = drag.path[drag.path.length - 1];       // accumulate the freehand stroke
        var pdx = e.clientX - last[0], pdy = e.clientY - last[1];
        if (pdx * pdx + pdy * pdy >= PATH_MIN_PX * PATH_MIN_PX) drag.path.push([e.clientX, e.clientY]);
        var dx = drag.x1 - drag.x0, dy = drag.y1 - drag.y0;
        if (!drag.moved && (dx * dx + dy * dy) >= DRAG_PX * DRAG_PX) drag.moved = true;
        drawPreview(drag);
        e.stopImmediatePropagation();
      }
      function onUp(e) {
        if (!drag || e.button !== 2) return;
        e.preventDefault(); e.stopImmediatePropagation();
        var d = drag; drag = null;
        clearPreview();
        var h = hd(); if (!h) { log('no holodeck'); return; }
        if (!d.moved) {                                   // click: issue armed command at the point, or PA's smart command
          var sp = px(d.x0, d.y0), a = armedVerb();
          if (a && h.unitCommand) { h.unitCommand(a, sp[0], sp[1], d.queue); disarm(); }
          else if (h.unitGo) h.unitGo(sp[0], sp[1], d.queue);
          return;
        }
        doFormation(d, h);
      }

      function doFormation(d, h) {
        var sel = BA.util.readSelection(); var ids = (sel && sel.ids) ? sel.ids : [];
        var armed = d.armed, verb = sendVerb(armed);
        if (ids.length < MIN_UNITS) {                     // 0/1 unit -> single command to the end point
          if (ids.length && h.unitCommand) { var ep = px(d.x1, d.y1); h.unitCommand(armed || 'move', ep[0], ep[1], d.queue); disarm(); }
          return;
        }
        var w = wv(); if (!w || !w.sendOrder) { log('sendOrder unavailable'); return; }
        if (!h.raycast) { log('no raycast'); return; }
        var N = ids.length;
        var samp = resample(d.path, N);                   // N points evenly along the freehand stroke
        var pts = samp.map(function (p) { return px(p[0], p[1]); });
        h.raycast(pts).then(function (hits) {
          if (!hits || !hits.length) { log('raycast empty'); return; }
          var planet = (hits[0] && hits[0].planet !== undefined && hits[0].planet !== null) ? hits[0].planet : 0;
          var slots = [];
          for (var k = 0; k < hits.length; k++) { if (hits[k] && hits[k].pos) slots.push(hits[k].pos); }
          if (slots.length < 2) { log('only ' + slots.length + ' slot(s) hit ground — drag over open terrain'); return; }
          assignAndIssue(ids, slots, planet, d.queue, w, verb, !!armed);
        }, function (err) { log('raycast rejected: ' + err); });
      }

      function issue(w, id, pos, planet, queue, verb) {
        w.sendOrder({ units: [id], command: verb, location: { planet: planet, pos: pos }, queue: queue }).then(null, function (e) { log('sendOrder fail: ' + e); });
      }

      // BAR "NoX" (no-crossing) assignment. ordered[k] is the unit sent to slots[k].
      // Starting from the axis-sorted order, swap any two units whose paths to their
      // slots cross — i.e. swapping shortens the pair's combined travel. Repeating to
      // convergence removes ALL crossings, so no two units have to trade places (and
      // thus push THROUGH each other, which PA units refuse to do). O(n^2) per pass,
      // a handful of passes, one-shot at issue time — no per-frame cost.
      function decross(ordered, pm, slots) {
        var n = Math.min(ordered.length, slots.length), EPS = 0.5, passes = 0, improved = true;
        while (improved && passes < 8) {
          improved = false; passes++;
          for (var a = 0; a < n - 1; a++) {
            var pa = pm[ordered[a]], sa = slots[a];
            for (var b = a + 1; b < n; b++) {
              var pb = pm[ordered[b]], sb = slots[b];
              if (dist(pa, sb) + dist(pb, sa) + EPS < dist(pa, sa) + dist(pb, sb)) {
                var t = ordered[a]; ordered[a] = ordered[b]; ordered[b] = t;   // uncross
                pa = pm[ordered[a]]; improved = true;        // slot a now holds a different unit
              }
            }
          }
        }
        return ordered;
      }

      function assignAndIssue(ids, slots, planet, queue, w, verb, wasArmed) {
        var dir = sub(slots[slots.length - 1], slots[0]);   // formation axis (world)
        function pair(ordered) {
          var n = Math.min(ordered.length, slots.length);
          for (var i = 0; i < n; i++) issue(w, ordered[i], slots[i], planet, queue, verb);
          if (wasArmed) disarm();                           // one-shot: consume the armed command
          log(verb + ' formation: ' + n + '/' + ids.length + ' units -> ' + slots.length + ' slots, planet=' + planet + (queue ? ' queued' : ''));
        }
        // Axis sort = good starting order; decross() then removes path crossings so
        // units go to their NEAREST non-crossing slot and don't have to swap places.
        if (BA.select && BA.select._positionsOf) {
          BA.select._positionsOf(ids, function (pm) {
            var ordered = ids.slice().filter(function (id) { return pm[id]; });
            if (!ordered.length) { pair(ids.slice()); return; }
            ordered.sort(function (a, b) { return dot(pm[a], dir) - dot(pm[b], dir); });
            decross(ordered, pm, slots);
            pair(ordered);
          });
        } else {
          pair(ids.slice());
        }
      }

      document.addEventListener('mousedown', onDown, true);
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup', onUp, true);
      document.addEventListener('keydown', function (e) { if (drag && (e.keyCode === 27 || e.which === 27)) { drag = null; clearPreview(); } }, true);

      log('formations ready (freehand preview + per-unit formation) — right-DRAG = per-unit formation w/ on-screen markers; right-CLICK = armed cmd / smart; native custom-formations OFF');
    }
  });
})();
