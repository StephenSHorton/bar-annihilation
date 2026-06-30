(function () {
  'use strict';
  var BA = window.BarAnnihilation; if (!BA) { return; }

  // -------------------------------------------------------------------------
  // M1 capability probe (read-only) — dumps PA's live runtime data SHAPES to the
  // client log so the async select tiers (category / recon / antiair / position /
  // group) can be implemented against confirmed fields instead of guesses.
  //
  // Trigger: Ctrl+Shift+P in a loaded match. IDEAL setup before pressing:
  //   - select a MIXED group (a fabber + a combat unit + an AA unit + a radar),
  //   - assign a couple of control groups (Ctrl+1, Ctrl+2) so spec_groups shows.
  //
  // PA keeps only the FIRST console.log arg, so every line is ONE concatenated
  // string. Async results print on later lines as they resolve. Read the dump
  // from <datadir>\log\PA-*.txt (newest).  This module is DEV-ONLY and must be
  // de-listed from modinfo.json scenes before merging to main (release cleanup).
  // -------------------------------------------------------------------------
  BA.register({
    name: 'probe',
    init: function () {
      function out(label, obj) {
        var s; try { s = (typeof obj === 'string') ? obj : JSON.stringify(obj); } catch (e) { s = '[unstringifiable: ' + (e && e.message) + ']'; }
        BA.log('PROBE ' + label + ': ' + s);
      }
      function safe(label, fn) { try { fn(); } catch (e) { BA.log('PROBE ' + label + ' ERROR: ' + (e && e.message ? e.message : e)); } }
      function wv() { try { return api.getWorldView ? api.getWorldView(0) : null; } catch (e) { return null; } }
      function hd() { try { return api.Holodeck.focused; } catch (e) { return null; } }
      function keys(o) { return o ? Object.keys(o) : null; }
      function has(o, k) { return !!(o && o[k] !== undefined && o[k] !== null); }
      function firstSpec(sel) { return (sel && sel.raw && sel.raw.spec_ids) ? (Object.keys(sel.raw.spec_ids)[0] || null) : null; }
      // jQuery-promise GET that tolerates both the 'spec:' and '/' prefixes; reports which worked.
      function specGet(prefix, spec, cb) {
        if (typeof $ === 'undefined' || !$.get) { cb(null, 'no-jquery'); return; }
        try {
          var p = $.get(prefix + spec);
          if (p && p.done) { p.done(function (d) { var o = d; try { if (typeof d === 'string') o = JSON.parse(d); } catch (e) {} cb(o, null); }).fail(function (e) { cb(null, (e && e.status) || 'fail'); }); }
          else if (p && p.then) { p.then(function (d) { var o = d; try { if (typeof d === 'string') o = JSON.parse(d); } catch (e) {} cb(o, null); }, function (e) { cb(null, 'reject'); }); }
          else cb(null, 'no-promise');
        } catch (e) { cb(null, e && e.message); }
      }

      function run() {
        BA.log('PROBE ===== begin (mod v' + BA.version + ') =====');
        var sel = BA.util.readSelection();
        out('selection.summary', { types: sel ? sel.types : -1, units: sel ? sel.units : -1 });

        // (0) ui_scale — needed to convert mouse offsetX/Y for raycast.
        safe('uiScale', function () {
          var a = null, b = null;
          try { a = (model.uiScale && typeof model.uiScale === 'function') ? model.uiScale() : (model.uiScale || null); } catch (e) {}
          try { b = (api.settings && api.settings.getSynchronous) ? api.settings.getSynchronous('ui', 'ui_scale') : null; } catch (e) {}
          out('uiScale', { 'model.uiScale': a, 'settings.ui_scale': b });
        });

        // (1) selection model — spec_ids, spec_groups (group membership badges), selected_mobile.
        safe('selection.model', function () {
          var s = sel ? sel.raw : null;
          out('selection.keys', keys(s));
          out('selection.spec_groups', s ? s.spec_groups : null);
          out('selection.selected_mobile', s ? s.selected_mobile : null);
        });

        // (2) model.unitSpecs[spec] — THE contested sync surface. Does it carry
        // unit_types / types / recon / tools / navigation / max_range / commands?
        safe('unitSpecs', function () {
          var spec = firstSpec(sel); if (!spec) { BA.log('PROBE unitSpecs: no selection'); return; }
          var us = (model.unitSpecs && model.unitSpecs[spec]) ? model.unitSpecs[spec] : null;
          out('unitSpecs[' + spec + '].keys', keys(us));
          if (us) {
            out('unitSpecs.presence', {
              unit_types: has(us, 'unit_types'), types: has(us, 'types'), recon: has(us, 'recon'),
              tools: has(us, 'tools'), navigation: has(us, 'navigation'), max_range: us.max_range,
              commands: us.commands, structure: us.structure, canBuild: us.canBuild,
              build_len: (us.build || []).length
            });
            if (us.tools) out('unitSpecs.tools[0]', us.tools[0]);
            if (us.unit_types) out('unitSpecs.unit_types', us.unit_types);
            if (us.types) out('unitSpecs.types', us.types);
            if (us.recon) out('unitSpecs.recon', us.recon);
            if (us.navigation) out('unitSpecs.navigation', us.navigation);
          }
        });

        // (3) async spec blueprint via $.get — the authoritative unit_types/recon/tools source.
        safe('specGET', function () {
          var spec = firstSpec(sel); if (!spec) { BA.log('PROBE specGET: no selection'); return; }
          specGet('spec:', spec, function (d, err) {
            if (!d) { BA.log('PROBE specGET[spec:] failed (' + err + '); trying /'); specGet('/', spec, dumpBlueprint); return; }
            BA.log('PROBE specGET[spec:] OK'); dumpBlueprint(d);
          });
          function dumpBlueprint(d) {
            if (!d) { BA.log('PROBE specGET: both spec: and / failed'); return; }
            out('blueprint.keys', keys(d));
            out('blueprint.unit_types', d.unit_types);
            out('blueprint.recon', d.recon);
            out('blueprint.navigation', d.navigation);
            // tools: are they refs ({spec_id,bones}) or merged (max_range/target_layers inline)?
            if (d.tools && d.tools.length) {
              out('blueprint.tools[0]', d.tools[0]);
              out('blueprint.tools[0].presence', { spec_id: has(d.tools[0], 'spec_id'), max_range: d.tools[0].max_range, target_layers: d.tools[0].target_layers, ammo_id: d.tools[0].ammo_id });
              // If tools[0] is a ref, fetch the linked tool file to see max_range/target_layers/ammo_id.
              if (d.tools[0].spec_id && d.tools[0].max_range === undefined) {
                specGet('spec:', d.tools[0].spec_id, function (t, e) {
                  if (!t) { specGet('/', d.tools[0].spec_id, dumpTool); return; }
                  dumpTool(t);
                });
              }
            } else out('blueprint.tools', d.tools || 'none');
          }
          function dumpTool(t) {
            if (!t) { BA.log('PROBE toolGET failed'); return; }
            out('tool.keys', keys(t));
            out('tool.fields', { max_range: t.max_range, target_layers: t.target_layers, ammo_id: t.ammo_id, rate_of_fire: t.rate_of_fire });
          }
        });

        // (4) getUnitState — confirm the pos field name + that health is absent.
        safe('getUnitState', function () {
          var w = wv(); if (!w || !w.getUnitState) { BA.log('PROBE getUnitState: no worldview'); return; }
          var ids = sel ? sel.ids : []; if (!ids.length) { BA.log('PROBE getUnitState: nothing selected'); return; }
          var one = ids[0];
          w.getUnitState([one]).then(function (res) {
            var u = (res && res[one]) ? res[one] : ((res && res.length) ? res[0] : res);
            out('getUnitState.unitKeys', keys(u));
            out('getUnitState.posFields', u ? { pos: u.pos, location: u.location, position: u.position, orient: u.orient, planet: u.planet, health: u.health, hasHealth: has(u, 'health') } : null);
          }, function (e) { BA.log('PROBE getUnitState rejected: ' + e); });
        });

        // (5) raycast — confirm the world-pos hit field name (pos vs surface_pos vs
        // location vs [x,y,z]) and whether raycast(units:true) returns the unit under cursor.
        safe('raycast', function () {
          var h = hd(); if (!h) { BA.log('PROBE raycast: no holodeck'); return; }
          var sc = 1; try { sc = (model.uiScale ? (typeof model.uiScale === 'function' ? model.uiScale() : model.uiScale) : 1) || 1; } catch (e) {}
          var cx = Math.floor(((window.innerWidth || 1920) / 2) * sc), cy = Math.floor(((window.innerHeight || 1080) / 2) * sc);
          if (h.raycastTerrain) {
            var r = h.raycastTerrain(cx, cy);
            if (r && r.then) r.then(function (hit) { out('raycastTerrain.hit', hit); }, function (e) { BA.log('PROBE raycastTerrain rejected: ' + e); });
            else out('raycastTerrain.sync', r);
          }
          if (h.raycast) {
            var r2 = h.raycast(cx, cy);
            if (r2 && r2.then) r2.then(function (hit) { out('raycast.hit(units:true)', hit); }, function (e) { BA.log('PROBE raycast rejected: ' + e); });
          }
        });

        // (6) groups — capture/forget verbs + the shadow tracker's captured membership.
        safe('groups', function () {
          out('group.verbs', { captureGroup: !!(api.select && api.select.captureGroup), recallGroup: !!(api.select && api.select.recallGroup), forgetGroup: !!(api.select && api.select.forgetGroup), recallGroupWithTypeFilter: !!(api.select && api.select.recallGroupWithTypeFilter) });
          var gs = (BA.select && BA.select._groups) ? BA.select._groups : null;
          var counts = {}; if (gs) for (var g in gs) { if (gs.hasOwnProperty(g)) { var n = 0; for (var u in gs[g]) if (gs[g].hasOwnProperty(u)) n++; counts[g] = n; } }
          out('group.shadowCounts', counts);   // assign Ctrl+1/Ctrl+2 BEFORE probing to populate this
        });

        // (6b) position tier — read-only: cursor world pos + closest unit among the
        // current selection (hover the cursor near a unit before pressing Ctrl+Shift+P).
        safe('positionTest', function () {
          if (!BA.select || !BA.select._mouseWorldPos) { BA.log('PROBE positionTest: engine not ready'); return; }
          function d2(a, b) { var dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2]; return dx * dx + dy * dy + dz * dz; }
          BA.select._mouseWorldPos(function (mp) {
            if (!mp) { out('positionTest', 'no cursor world pos'); return; }
            var ids = sel ? sel.ids : [];
            if (!ids.length) { out('positionTest', { cursorPos: mp, note: 'select units + hover near one to test closest' }); return; }
            BA.select._positionsOf(ids, function (pm) {
              var best = null, bd = Infinity, within = 0;
              for (var i = 0; i < ids.length; i++) { var q = pm[ids[i]]; if (!q) continue; var dd = d2(q, mp); if (dd < bd) { bd = dd; best = ids[i]; } if (dd <= 200 * 200) within++; }
              out('positionTest', { cursorPos: [Math.round(mp[0]), Math.round(mp[1]), Math.round(mp[2])], closestUnitId: best, closestDist: Math.round(Math.sqrt(bd)), within200: within, ofSelected: ids.length });
            });
          });
        });

        // (7) sanity: the sync engine self-test — def traits + CATEGORY classification
        // over the current selection, so the new sync category filters are verifiable
        // against a known mixed selection without needing a keybind.
        safe('engineSelfTest', function () {
          if (!BA.select || !BA.select._specOf) { BA.log('PROBE engineSelfTest: engine not ready'); return; }
          function ci(types, t) { if (!types) return false; t = ('UNITTYPE_' + t).toLowerCase(); for (var i = 0; i < types.length; i++) if (String(types[i]).toLowerCase() === t) return true; return false; }
          var specIds = (sel && sel.raw) ? sel.raw.spec_ids : {};
          var c = { total: 0, builders: 0, mobile: 0, weapons: 0, aircraft: 0, radar: 0, jammer: 0, airdef: 0, building: 0, commander: 0, transport: 0 };
          for (var spec in specIds) {
            if (!specIds.hasOwnProperty(spec)) continue;
            var t = BA.select._specOf(spec), arr = specIds[spec] || [], k = arr.length;
            c.total += k;
            if (t.builder) c.builders += k; if (t.mobile) c.mobile += k; if (t.hasWeapons) c.weapons += k;
            if (t.structure) c.building += k; if (t.transport) c.transport += k;
            if (ci(t.types, 'Air')) c.aircraft += k; if (ci(t.types, 'Radar')) c.radar += k;
            if (ci(t.types, 'RadarJammer')) c.jammer += k; if (ci(t.types, 'AirDefense')) c.airdef += k;
            if (ci(t.types, 'Commander')) c.commander += k;
          }
          out('engineSelfTest', c);
          out('engineSelfTest.types', (function () { var o = {}; for (var s in specIds) { if (specIds.hasOwnProperty(s)) o[s.split('/').pop()] = BA.select._specOf(s).types; } return o; })());
          // async antiAir over the selection (target_layers WL_Air, excluding flyers).
          if (BA.select._blueprint) {
            var specs = []; for (var s2 in specIds) if (specIds.hasOwnProperty(s2)) specs.push(s2);
            var n = specs.length, k = 0, aa = 0;
            if (n) specs.forEach(function (s) { BA.select._blueprint(s, function (bp) { if (bp && bp.antiair) aa += (specIds[s] || []).length; if (++k === n) out('engineSelfTest.antiair', { antiairUnits: aa }); }); });
          }
        });

        BA.log('PROBE ===== end (async lines print above as they resolve) =====');
      }

      BA.probe = run;
      function onProbeKey(e) {
        if (e.ctrlKey && e.shiftKey && !e.altKey && (e.which === 80 || e.keyCode === 80)) {  // Ctrl+Shift+P
          e.preventDefault(); e.stopImmediatePropagation();
          if (!BA.util.uiBusy()) run();
          return false;
        }
      }
      document.addEventListener('keydown', onProbeKey, true);
      BA.log('probe ready (DEV) — select a mixed group, press Ctrl+Shift+P to dump data shapes');
    }
  });
})();
