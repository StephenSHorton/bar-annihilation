(function () {
  'use strict';
  var BA = window.BarAnnihilation; if (!BA) { return; }

  // ---------------------------------------------------------------------------
  // FORMATION / SPLINE probe (DEV-ONLY) — settles, empirically in a live match,
  // the two open questions that decide how we add spline/curve targeting to the
  // radial-default commands:
  //
  //   (A) Does worldview.sendOrder give EACH unit its OWN distinct destination
  //       from a client mod?  (the per-unit "spread along the curve" route)
  //   (B) Does location.multi_pos (a curve array) get honored beyond patrol —
  //       e.g. for `move`?  (the engine-does-the-path route)
  //
  // Unlike probe.js this ISSUES REAL ORDERS, so run it in a skirmish. It is
  // DEV-ONLY and must be de-listed from modinfo.json (alongside probe.js) before
  // any release.
  //
  // SETUP: skirmish, select a handful of MOBILE units, point the cursor at OPEN
  // GROUND a bit away from them, then press:
  //   Ctrl+Shift+1  T1  per-unit MOVE          -> each unit to its own point on a line  (the gate)
  //   Ctrl+Shift+2  T2  multi_pos MOVE curve   -> whole group, one order, a curved path
  //   Ctrl+Shift+3  T3  multi_pos PATROL curve -> whole group patrols the curve (multi_pos's documented use)
  //   Ctrl+Shift+4  T4  per-unit ATTACK_GROUND -> each unit attack-grounds its own point  (the goal)
  //
  // WATCH the units; READ the .then results / errors in <datadir>\log\PA-*.txt
  // (lines tagged "FPROBE"). What we need to learn per test: did the order
  // round-trip (OK vs FAIL), and did units go to DISTINCT points (A) / trace the
  // CURVE (B). The geometry is approximate — we only care about yes/no behavior.
  // ---------------------------------------------------------------------------
  BA.register({
    name: 'formation-probe',
    init: function () {
      var lastX = 0, lastY = 0;
      document.addEventListener('mousemove', function (e) { lastX = e.clientX; lastY = e.clientY; }, true);

      function log(m) { BA.log('FPROBE ' + m); }
      function uiScale() { try { var u = (typeof model !== 'undefined' && model.uiScale) ? (typeof model.uiScale === 'function' ? model.uiScale() : model.uiScale) : 1; return u || 1; } catch (e) { return 1; } }
      function cursorPx() { var s = uiScale(); return [Math.floor(lastX * s), Math.floor(lastY * s)]; }
      function wv() { try { return api.getWorldView ? api.getWorldView(0) : null; } catch (e) { return null; } }
      function hd() { try { return api.Holodeck.focused; } catch (e) { return null; } }

      function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
      function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
      function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
      function norm(a) { var L = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1; return [a[0] / L, a[1] / L, a[2] / L]; }
      function r3(p) { return [Math.round(p[0]), Math.round(p[1]), Math.round(p[2])]; }

      // Resolve a ground frame at the cursor in ONE raycast: world point C, the
      // planet, and two on-ground tangents (screen-right, screen-down) so the test
      // line/curve actually lie on the terrain regardless of the planet's frame.
      function groundFrame(cb) {
        var h = hd(); if (!h || !h.raycast) { log('no holodeck'); return; }
        var px = cursorPx(), d = 200;
        // Use raycast (NOT raycastTerrain): raycastTerrain attaches the planet only via
        // `if (result.planet)`, which DROPS a falsy planet index 0 — exactly the
        // single-planet skirmish case (that was the "invalid target planet"/planet=undefined).
        // raycast uses `if (result.planet !== undefined)`, so it keeps planet 0.
        var r = h.raycast([[px[0], px[1]], [px[0] + d, px[1]], [px[0], px[1] + d]]);
        if (!r || !r.then) { log('raycast not thenable: ' + JSON.stringify(r)); return; }
        r.then(function (hits) {
          if (!hits || !hits[0] || !hits[0].pos) { log('cursor missed — point at OPEN GROUND. hits=' + JSON.stringify(hits)); return; }
          var C = hits[0].pos;
          var planet = (hits[0].planet !== undefined && hits[0].planet !== null) ? hits[0].planet : 0;
          var right = (hits[1] && hits[1].pos) ? norm(sub(hits[1].pos, C)) : [1, 0, 0];
          var fwd = (hits[2] && hits[2].pos) ? norm(sub(hits[2].pos, C)) : [0, 0, 1];
          log('resolved planet=' + planet + ' (raw hits[0].planet=' + hits[0].planet + ')');
          cb(C, planet, right, fwd);
        }, function (e) { log('raycast rejected: ' + e); });
      }

      function spreadLine(C, right, n, spacing) {
        var pts = []; for (var i = 0; i < n; i++) { pts.push(add(C, scale(right, (i - (n - 1) / 2) * spacing))); } return pts;
      }
      function arcCurve(C, right, fwd, k, width, bow) {
        var pts = []; for (var j = 0; j < k; j++) { var t = (k === 1) ? 0.5 : j / (k - 1); pts.push(add(add(C, scale(right, (t - 0.5) * width)), scale(fwd, Math.sin(t * Math.PI) * bow))); } return pts;
      }
      function okcb(tag) { return function (r) { log(tag + ' OK -> ' + JSON.stringify(r)); }; }
      function errcb(tag) { return function (e) { log(tag + ' FAIL -> ' + (e && e.message ? e.message : e)); }; }

      function selIds() { var s = BA.util.readSelection(); return (s && s.ids) ? s.ids : []; }
      function ready(tag) {
        var ids = selIds(); if (!ids.length) { log(tag + ': nothing selected'); return null; }
        var w = wv(); if (!w || !w.sendOrder) { log(tag + ': sendOrder UNAVAILABLE on getWorldView(0)'); return null; }
        return { ids: ids, w: w };
      }

      // T1 — per-unit distinct positions, command 'move' (THE GATE for the spread route)
      function test1() {
        var g = ready('T1'); if (!g) return;
        groundFrame(function (C, planet, right) {
          var pts = spreadLine(C, right, g.ids.length, 30);
          log('T1 per-unit MOVE: ' + g.ids.length + ' units -> distinct points on a line @ ' + JSON.stringify(r3(C)) + ' planet=' + planet);
          for (var i = 0; i < g.ids.length; i++) {
            g.w.sendOrder({ units: [g.ids[i]], command: 'move', location: { planet: planet, pos: pts[i] }, queue: false }).then(okcb('T1[' + i + ']'), errcb('T1[' + i + ']'));
          }
        });
      }

      // T2 — multi_pos curve, command 'move' (does the engine path-follow a curve for move?)
      function test2() {
        var g = ready('T2'); if (!g) return;
        groundFrame(function (C, planet, right, fwd) {
          var curve = arcCurve(C, right, fwd, 6, 180, 90);
          log('T2 multi_pos MOVE: whole group, one order, ' + curve.length + '-pt curve @ ' + JSON.stringify(r3(C)) + ' planet=' + planet);
          g.w.sendOrder({ units: g.ids, command: 'move', location: { planet: planet, multi_pos: curve }, queue: false }).then(okcb('T2'), errcb('T2'));
        });
      }

      // T3 — multi_pos curve, command 'patrol' (multi_pos's documented use; baseline that it works at all)
      function test3() {
        var g = ready('T3'); if (!g) return;
        groundFrame(function (C, planet, right, fwd) {
          var curve = arcCurve(C, right, fwd, 6, 180, 90);
          log('T3 multi_pos PATROL: whole group patrols a ' + curve.length + '-pt curve @ ' + JSON.stringify(r3(C)) + ' planet=' + planet);
          g.w.sendOrder({ units: g.ids, command: 'patrol', location: { planet: planet, multi_pos: curve }, queue: false }).then(okcb('T3'), errcb('T3'));
        });
      }

      // T4 — per-unit distinct positions, command 'attack_ground' (THE GOAL: spline for a combat verb)
      function test4() {
        var g = ready('T4'); if (!g) return;
        groundFrame(function (C, planet, right) {
          var pts = spreadLine(C, right, g.ids.length, 30);
          log('T4 per-unit ATTACK_GROUND: ' + g.ids.length + ' units -> distinct points on a line @ ' + JSON.stringify(r3(C)) + ' planet=' + planet);
          for (var i = 0; i < g.ids.length; i++) {
            g.w.sendOrder({ units: [g.ids[i]], command: 'attack_ground', location: { planet: planet, pos: pts[i] }, queue: false }).then(okcb('T4[' + i + ']'), errcb('T4[' + i + ']'));
          }
        });
      }

      var TESTS = { 49: test1, 50: test2, 51: test3, 52: test4 };   // Ctrl+Shift+ 1 / 2 / 3 / 4
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
      log('formation-probe ready (DEV) — select mobile units, point at OPEN GROUND, press Ctrl+Shift+1..4');
      log('  1=per-unit MOVE (gate)  2=multi_pos MOVE curve  3=multi_pos PATROL curve  4=per-unit ATTACK_GROUND');
    }
  });
})();
