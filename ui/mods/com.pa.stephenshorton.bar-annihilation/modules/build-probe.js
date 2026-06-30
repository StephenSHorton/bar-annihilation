(function () {
  'use strict';
  var BA = window.BarAnnihilation; if (!BA) { return; }

  // ---------------------------------------------------------------------------
  // BUILD-PLACEMENT probe (DEV-ONLY) — the M4 Phase-0 GATE. Settles, empirically
  // in a live match, the one claim the whole M4 plan rests on:
  //
  //   Does worldview.sendOrder({command:'build', spec, location:{planet,pos}})
  //   actually place a building at a WORLD position from a client mod?
  //
  // 'build' is in sendOrder's documented command list (worldview.js:164) and our
  // formations feature already drives sendOrder for move/attack_ground — but the
  // BUILD verb has ZERO stock-UI callers (PA's native build uses screen-coord
  // holodeck.unitEndFab), so it is documented-but-unexercised. Prove it before any
  // line/area loop is built on top. Also exercises worldview.fixupBuildLocations
  // (server-side snap to build-grid + metal spots) and queued positioned builds.
  //
  // Like formation-probe.js this ISSUES REAL ORDERS — run it in a skirmish. It is
  // DEV-ONLY and must be de-listed from modinfo.json before any release.
  //
  // SETUP: skirmish, select ONE fabber or your commander (so it has a buildable
  // list), point the cursor at OPEN GROUND a bit away, then press:
  //   Ctrl+Shift+B  GATE   one positioned build at the cursor (the make-or-break test)
  //   Ctrl+Shift+1  FIXUP  fixupBuildLocations -> build at the snapped pos (snap + orient)
  //   Ctrl+Shift+2  QUEUE  3 builds at distinct points (queue:false,true,true) — do they append?
  //   Ctrl+Shift+3  MEX    metal_extractor near a metal spot — does fixup magnetize onto it?
  //
  // WATCH the world (ghost appears? fabber walks over + starts building?) and READ
  // the .then results / errors in <datadir>\log\PA-*.txt (lines tagged "BPROBE").
  // ---------------------------------------------------------------------------
  BA.register({
    name: 'build-probe',
    init: function () {
      var lastX = 0, lastY = 0;
      document.addEventListener('mousemove', function (e) { lastX = e.clientX; lastY = e.clientY; }, true);

      function log(m) { BA.log('BPROBE ' + m); }
      function uiScale() { try { var u = (typeof model !== 'undefined' && model.uiScale) ? (typeof model.uiScale === 'function' ? model.uiScale() : model.uiScale) : 1; return u || 1; } catch (e) { return 1; } }
      function cursorPx() { var s = uiScale(); return [Math.floor(lastX * s), Math.floor(lastY * s)]; }
      function wv() { try { return api.getWorldView ? api.getWorldView(0) : null; } catch (e) { return null; } }
      function hd() { try { return api.Holodeck.focused; } catch (e) { return null; } }

      function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
      function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
      function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
      function norm(a) { var L = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1; return [a[0] / L, a[1] / L, a[2] / L]; }
      function r3(p) { return [Math.round(p[0]), Math.round(p[1]), Math.round(p[2])]; }

      // Resolve a ground frame at the cursor in ONE raycast: world point C, planet,
      // and the screen-right tangent (for spreading distinct test positions).
      // raycast (NOT raycastTerrain): raycastTerrain drops a falsy planet index 0.
      function groundFrame(cb) {
        var h = hd(); if (!h || !h.raycast) { log('no holodeck'); return; }
        var px = cursorPx(), d = 200;
        var r = h.raycast([[px[0], px[1]], [px[0] + d, px[1]]]);
        if (!r || !r.then) { log('raycast not thenable: ' + JSON.stringify(r)); return; }
        r.then(function (hits) {
          if (!hits || !hits[0] || !hits[0].pos) { log('cursor missed — point at OPEN GROUND. hits=' + JSON.stringify(hits)); return; }
          var C = hits[0].pos;
          var planet = (hits[0].planet !== undefined && hits[0].planet !== null) ? hits[0].planet : 0;
          var right = (hits[1] && hits[1].pos) ? norm(sub(hits[1].pos, C)) : [1, 0, 0];
          log('resolved planet=' + planet + ' (raw hits[0].planet=' + hits[0].planet + ')');
          cb(C, planet, right);
        }, function (e) { log('raycast rejected: ' + e); });
      }

      function spreadLine(C, right, n, spacing) {
        var pts = []; for (var i = 0; i < n; i++) { pts.push(add(C, scale(right, (i - (n - 1) / 2) * spacing))); } return pts;
      }
      function okcb(tag) { return function (r) { log(tag + ' OK -> ' + JSON.stringify(r)); }; }
      function errcb(tag) { return function (e) { log(tag + ' FAIL -> ' + (e && e.message ? e.message : e)); }; }

      // --- buildable spec resolution (mirrors gridmenu.js) --------------------
      function baseSpec(id) { var m = String(id).match(/^(.*\.json)/); return m ? m[1] : String(id); }
      function buildIdOf(entry) {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object') return entry.id || entry.spec || entry.key || null;
        return null;
      }
      // The selected builder's buildable list = model.unitSpecs[builderSpec].build[].
      function buildList() {
        try {
          if (typeof model === 'undefined' || !model.selection || !model.unitSpecs) return [];
          var sel = model.selection(); if (!sel || !sel.spec_ids) return [];
          var specs = []; for (var k in sel.spec_ids) { if (sel.spec_ids.hasOwnProperty(k)) specs.push(k); }
          for (var i = 0; i < specs.length; i++) {
            var us = model.unitSpecs[specs[i]] || model.unitSpecs[baseSpec(specs[i])];
            if (us && us.build && us.build.length) return us.build;
          }
        } catch (e) {}
        return [];
      }
      function pickSpec(match) {
        var bl = buildList(); if (!bl.length) return null;
        if (match) { for (var i = 0; i < bl.length; i++) { var id = buildIdOf(bl[i]); if (id && match(String(id))) return baseSpec(id); } return null; }
        var first = buildIdOf(bl[0]); return first ? baseSpec(first) : null;
      }
      function fabId() { var s = BA.util.readSelection(); return (s && s.ids && s.ids.length) ? s.ids[0] : null; }

      function precheck(tag, specMatch) {
        var fab = fabId(); if (!fab) { log(tag + ': nothing selected — select ONE fabber/commander'); return null; }
        var w = wv(); if (!w || !w.sendOrder) { log(tag + ': sendOrder UNAVAILABLE on getWorldView(0)'); return null; }
        var spec = pickSpec(specMatch || null);
        if (!spec) { log(tag + ': no ' + (specMatch ? 'matching' : 'buildable') + ' spec — is the selected unit a builder?'); return null; }
        return { fab: fab, w: w, spec: spec };
      }

      // GATE — one positioned build at the cursor.
      function gate() {
        var g = precheck('B'); if (!g) return;
        groundFrame(function (C, planet) {
          log('B GATE: build ' + g.spec + ' by ' + g.fab + ' @ ' + JSON.stringify(r3(C)) + ' planet=' + planet);
          g.w.sendOrder({ units: [g.fab], command: 'build', spec: g.spec, location: { planet: planet, pos: C }, queue: false }).then(okcb('B'), errcb('B'));
        });
      }

      // FIXUP — snap via fixupBuildLocations, then build at the snapped pos (test orient).
      function fixup() {
        var g = precheck('B1'); if (!g) return;
        if (!g.w.fixupBuildLocations) { log('B1: fixupBuildLocations UNAVAILABLE'); return; }
        groundFrame(function (C, planet) {
          log('B1 fixup+build: ' + g.spec + ' raw=' + JSON.stringify(r3(C)) + ' planet=' + planet);
          var fr = g.w.fixupBuildLocations(g.spec, planet, [{ pos: C }]);
          if (!fr || !fr.then) { log('B1 fixup not thenable: ' + JSON.stringify(fr)); return; }
          fr.then(function (snapped) {
            log('B1 fixup -> ' + JSON.stringify(snapped));
            var loc = (snapped && snapped[0]) ? snapped[0] : { pos: C };
            var order = { units: [g.fab], command: 'build', spec: g.spec, location: { planet: planet, pos: loc.pos }, queue: false };
            if (loc.orient !== undefined) order.location.orient = loc.orient;   // does sendOrder honor orient?
            g.w.sendOrder(order).then(okcb('B1'), errcb('B1'));
          }, errcb('B1 fixup'));
        });
      }

      // QUEUE — three positioned builds, queue:false then true,true (do they append?).
      function queue() {
        var g = precheck('B2'); if (!g) return;
        groundFrame(function (C, planet, right) {
          var pts = spreadLine(C, right, 3, 60);
          log('B2 queue loop: 3x ' + g.spec + ' @ ' + JSON.stringify(r3(C)) + ' planet=' + planet);
          for (var i = 0; i < 3; i++) {
            g.w.sendOrder({ units: [g.fab], command: 'build', spec: g.spec, location: { planet: planet, pos: pts[i] }, queue: (i > 0) }).then(okcb('B2[' + i + ']'), errcb('B2[' + i + ']'));
          }
        });
      }

      // MEX — metal extractor near a metal spot; does fixup magnetize it onto the spot?
      function mex() {
        var g = precheck('B3', function (id) { return /metal_extractor|metal_spot|mex/.test(id); }); if (!g) return;
        if (!g.w.fixupBuildLocations) { log('B3: fixupBuildLocations UNAVAILABLE'); return; }
        groundFrame(function (C, planet) {
          log('B3 mex snap: ' + g.spec + ' near ' + JSON.stringify(r3(C)) + ' planet=' + planet + ' (point NEAR a metal spot)');
          g.w.fixupBuildLocations(g.spec, planet, [{ pos: C }]).then(function (snapped) {
            log('B3 fixup -> ' + JSON.stringify(snapped) + ' (did pos jump onto a metal spot?)');
            var loc = (snapped && snapped[0]) ? snapped[0] : { pos: C };
            g.w.sendOrder({ units: [g.fab], command: 'build', spec: g.spec, location: { planet: planet, pos: loc.pos }, queue: false }).then(okcb('B3'), errcb('B3'));
          }, errcb('B3 fixup'));
        });
      }

      // ORIENT-ORDER — fixup for orient, then pass orient at the ORDER level (vs B1's
      // location.orient, which the engine ignored — buildings stayed tilted on the planet).
      function orientOrder() {
        var g = precheck('B4'); if (!g) return;
        if (!g.w.fixupBuildLocations) { log('B4: fixupBuildLocations UNAVAILABLE'); return; }
        groundFrame(function (C, planet) {
          g.w.fixupBuildLocations(g.spec, planet, [{ pos: C }]).then(function (snapped) {
            var loc = (snapped && snapped[0]) ? snapped[0] : { pos: C };
            log('B4 order-level orient: ' + g.spec + ' pos=' + JSON.stringify(r3(loc.pos)) + ' orient=' + JSON.stringify(loc.orient));
            var order = { units: [g.fab], command: 'build', spec: g.spec, location: { planet: planet, pos: loc.pos }, queue: false };
            if (loc.orient !== undefined) order.orient = loc.orient;   // ORDER-LEVEL (sibling of location)
            g.w.sendOrder(order).then(okcb('B4'), errcb('B4'));
          }, errcb('B4 fixup'));
        });
      }

      // FAB-PATH — place via the native screen-coord fab API (engine derives the
      // surface-aligned orient for free). The fallback architecture if sendOrder
      // can't carry orient. Arms fab mode, then begins+ends a placement at the cursor.
      function fabPath() {
        var g = precheck('B5'); if (!g) return;
        var h = hd(); if (!h || !h.unitBeginFab || !h.unitEndFab) { log('B5: unitBeginFab/EndFab unavailable'); return; }
        var px = cursorPx();
        try {
          if (model.executeStartBuild) model.executeStartBuild({ item: g.spec, batch: false, cancel: false, urgent: false, more: false });
          else if (api.arch && api.arch.beginFabMode) api.arch.beginFabMode(g.spec);
          log('B5 fab-path: armed ' + g.spec + ', placing at screen ' + JSON.stringify(px) + ' (Esc to clear fab mode after)');
        } catch (e) { log('B5 arm threw: ' + (e && e.message ? e.message : e)); return; }
        setTimeout(function () {
          try {
            h.unitBeginFab(px[0], px[1], false);
            var r = h.unitEndFab(px[0], px[1], false, false);
            if (r && r.then) r.then(okcb('B5 endFab'), errcb('B5 endFab')); else log('B5 endFab -> ' + JSON.stringify(r));
          } catch (e) { log('B5 fab place threw: ' + (e && e.message ? e.message : e)); }
        }, 60);
      }

      // --- M4 PLACEMENT-ENGINE test: world-spaced LINE via the native fab path ---
      // Proves the core M4 loop in isolation, BEFORE the live drag-capture seam:
      //   dense-raycast a screen segment -> world polyline -> walk by arc-length in
      //   steps of (footprint + separation) -> place each via unitBeginFab/EndFab
      //   (snap=true) so the ENGINE grid-snaps + applies the upright orient (B5 win).
      // No world->screen projection needed: spacing is computed in WORLD units from
      // the raycast hits, then mapped back to the dense SCREEN samples. Success =
      // a row of EVENLY-spaced, ALL-UPRIGHT buildings queued on one fabber.
      function specFootprint(spec) {
        try {
          var us = model.unitSpecs[spec] || model.unitSpecs[baseSpec(spec)];
          if (us && us.placement_size && us.placement_size.length >= 2) {
            var sep = (typeof us.area_build_separation === 'number') ? us.area_build_separation : 2;
            return { x: us.placement_size[0], z: us.placement_size[1], sep: sep, raw: true };
          }
        } catch (e) {}
        return { x: 12, z: 12, sep: 2, raw: false };
      }
      function d3sq(p, q) { var dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2]; return dx * dx + dy * dy + dz * dz; }

      function line() {
        var g = precheck('B6'); if (!g) return;
        var h = hd(); if (!h || !h.raycast || !h.unitBeginFab || !h.unitEndFab) { log('B6: holodeck fab/raycast unavailable'); return; }
        var fp = specFootprint(g.spec);
        var step = Math.max(fp.x, fp.z) + (fp.sep || 0);
        var a = cursorPx();
        var SCREEN_LEN = 500, SAMPLES = 60, MAXN = 40;
        var pts = [], s;
        for (s = 0; s <= SAMPLES; s++) { var t = s / SAMPLES; pts.push([Math.floor(a[0] + t * SCREEN_LEN), a[1]]); }
        log('B6 LINE: ' + g.spec + ' step=' + step.toFixed(1) + ' (footprint ' + fp.x + 'x' + fp.z + ' sep ' + fp.sep + (fp.raw ? '' : ' DEFAULTED — placement_size not found') + ') sampling ' + (SAMPLES + 1) + 'px right from ' + JSON.stringify(a));
        h.raycast(pts).then(function (hits) {
          if (!hits || !hits.length) { log('B6 raycast empty'); return; }
          var planet = 0, poly = [], i;
          for (i = 0; i < hits.length; i++) {
            if (hits[i] && hits[i].pos) {
              if (hits[i].planet !== undefined && hits[i].planet !== null) planet = hits[i].planet;
              poly.push({ scr: pts[i], pos: hits[i].pos });
            }
          }
          if (poly.length < 2) { log('B6 only ' + poly.length + ' terrain hit(s) — point at OPEN GROUND with room to the right'); return; }
          var cum = [0], j;
          for (j = 1; j < poly.length; j++) { cum.push(cum[j - 1] + Math.sqrt(d3sq(poly[j].pos, poly[j - 1].pos))); }
          var total = cum[cum.length - 1];
          var placements = [], d;
          for (d = 0; d <= total && placements.length < MAXN; d += step) {
            var k = 1; while (k < cum.length && cum[k] < d) k++;
            if (k >= cum.length) k = cum.length - 1;
            var seg = (cum[k] - cum[k - 1]) || 1;
            var f = (d - cum[k - 1]) / seg;
            var sx = Math.round(poly[k - 1].scr[0] + f * (poly[k].scr[0] - poly[k - 1].scr[0]));
            var sy = Math.round(poly[k - 1].scr[1] + f * (poly[k].scr[1] - poly[k - 1].scr[1]));
            placements.push([sx, sy]);
          }
          log('B6 placing ' + placements.length + ' along ' + Math.round(total) + ' world-units (planet=' + planet + ')');
          try { model.executeStartBuild({ item: g.spec, batch: false, cancel: false, urgent: false, more: false }); }
          catch (e) { log('B6 arm threw: ' + (e && e.message ? e.message : e)); return; }
          setTimeout(function () {
            var idx = 0;
            var placeNext = function () {
              if (idx >= placements.length) { try { if (model.endFabMode) model.endFabMode(); } catch (e) {} log('B6 done — ' + placements.length + ' placed'); return; }
              var p = placements[idx], queueFlag = (idx > 0), cur = idx; idx++;
              try { h.unitBeginFab(p[0], p[1], true); } catch (e) { log('B6 beginFab[' + cur + '] threw: ' + e); }
              var r = h.unitEndFab(p[0], p[1], queueFlag, true);
              if (r && r.then) r.then(function (ok) { if (!ok) log('B6[' + cur + '] endFab ok=false @ ' + JSON.stringify(p)); placeNext(); }, function (e) { log('B6[' + cur + '] endFab FAIL ' + e); placeNext(); });
              else placeNext();
            };
            placeNext();
          }, 80);
        }, function (e) { log('B6 raycast rejected: ' + e); });
      }

      var TESTS = { 66: gate, 49: fixup, 50: queue, 51: mex, 52: orientOrder, 53: fabPath, 54: line };   // Ctrl+Shift+ B / 1 / 2 / 3 / 4 / 5 / 6
      function onKey(e) {
        if (e.ctrlKey && e.shiftKey && !e.altKey) {
          var code = e.which || e.keyCode;
          if (TESTS[code]) {
            e.preventDefault(); e.stopImmediatePropagation();
            if (!BA.util.uiBusy()) { try { TESTS[code](); } catch (err) { log('test threw: ' + (err && err.message ? err.message : err)); } }
            return false;
          }
        }
      }
      document.addEventListener('keydown', onKey, true);
      log('build-probe ready (DEV) — select ONE fabber/commander, point at OPEN GROUND, press:');
      log('  Ctrl+Shift+B=gate  +1=fixup(loc.orient)  +2=queue 3  +3=mex snap  +4=order.orient  +5=fab-path(engine orient)');
      log('  ORIENT settled: +5 (native fab) builds UPRIGHT; sendOrder build tilts + teleports. M4 uses the fab path.');
      log('  Ctrl+Shift+6 = LINE: world-spaced row via the fab path (the M4 placement engine) — expect EVEN + all UPRIGHT');
    }
  });
})();
