(function () {
  'use strict';
  var BA = window.BarAnnihilation; if (!BA) { return; }

  // -------------------------------------------------------------------------
  // Capability probe (read-only) — dumps PA's live runtime surface to the log so
  // we can confirm the SELECT-ENGINE assumptions before committing async tiers.
  // Trigger Ctrl+Shift+P in a loaded match with some units selected (ideally a
  // mix incl. a builder + a damaged unit). Answers the checklist in
  // docs/SELECT-ENGINE.md. PA keeps only the FIRST console.log arg, so each line
  // is a single concatenated string.
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
      function firstSpec(sel) { return (sel && sel.raw && sel.raw.spec_ids) ? (Object.keys(sel.raw.spec_ids)[0] || null) : null; }
      function countMap(m) { var n = 0; for (var k in m) { if (m.hasOwnProperty(k) && m[k] && m[k].length) n += m[k].length; } return n; }

      function run() {
        BA.log('PROBE ===== begin (mod v' + BA.version + ') =====');
        var sel = BA.util.readSelection();
        out('selection.summary', { types: sel ? sel.types : -1, units: sel ? sel.units : -1 });
        safe('selection.raw', function () { out('selection.raw', sel ? sel.raw : null); });
        safe('army', function () { out('army', { armyIndex: (model.armyIndex ? model.armyIndex() : 'n/a'), armyId: (model.armyId ? model.armyId() : 'n/a') }); });

        safe('unitSpecs', function () {
          var spec = firstSpec(sel); if (!spec) { BA.log('PROBE unitSpecs: no selection'); return; }
          var us = (model.unitSpecs && model.unitSpecs[spec]) ? model.unitSpecs[spec] : null;
          out('unitSpecs[' + spec + '].keys', us ? Object.keys(us) : null);
          if (us) out('unitSpecs.traits', { structure: us.structure, canBuild: us.canBuild, build_len: (us.build || []).length, commands: us.commands, dps: us.dps, damage: us.damage, max_range: us.max_range, unit_types: us.unit_types });
        });

        safe('getUnitState', function () {
          var w = wv(); if (!w || !w.getUnitState) { BA.log('PROBE getUnitState: no worldview'); return; }
          var ids = sel ? sel.ids : []; if (!ids.length) { BA.log('PROBE getUnitState: nothing selected'); return; }
          var one = ids[0];
          w.getUnitState([one]).then(function (res) {
            out('getUnitState.raw', res);
            var u = (res && res[one]) ? res[one] : ((res && res.length) ? res[0] : res);
            out('getUnitState.unitKeys', u ? Object.keys(u) : null);
            out('getUnitState.probeFields', u ? { hasHealth: !!u.health, hasLocation: !!u.location, hasPosition: !!u.position, hasToolDetails: !!u.tool_details, hasIdle: (u.idle !== undefined), hasCommandCount: (u.command_count !== undefined), hasCloak: (u.cloaked !== undefined || u.cloak !== undefined) } : null);
          }, function (e) { BA.log('PROBE getUnitState rejected: ' + e); });
        });

        safe('getArmyUnits', function () {
          var w = wv(); if (!w || !w.getArmyUnits) { BA.log('PROBE getArmyUnits: no worldview'); return; }
          var ai = (model.armyIndex ? model.armyIndex() : 0);
          w.getArmyUnits(ai, -1).then(function (m) { out('getArmyUnits(idx=' + ai + ',planet=-1)', { specs: m ? Object.keys(m).length : 0, units: countMap(m), firstSpec: m ? Object.keys(m)[0] : null }); }, function (e) { BA.log('PROBE getArmyUnits(-1) rejected: ' + e); });
          w.getArmyUnits(ai, 0).then(function (m) { out('getArmyUnits(idx=' + ai + ',planet=0)', { units: countMap(m) }); }, function () {});
        });

        safe('specGET', function () {
          var spec = firstSpec(sel); if (!spec || typeof $ === 'undefined' || !$.get) { BA.log('PROBE specGET: skip'); return; }
          function report(tag, data) { var d = data; try { if (typeof data === 'string') d = JSON.parse(data); } catch (e) {} out('specGET' + tag + '.keys', d ? Object.keys(d) : null); if (d) out('specGET' + tag + '.unit_types', d.unit_types); }
          $.get(spec).done(function (d) { report('[/' + spec + ']', d); }).fail(function () {
            $.get('spec:' + spec).done(function (d) { report('[spec:]', d); }).fail(function () { BA.log('PROBE specGET: both /spec and spec: failed'); });
          });
        });

        safe('raycast', function () {
          var h = hd(); if (!h || !h.raycastTerrain) { BA.log('PROBE raycast: no holodeck.raycastTerrain'); return; }
          var cx = Math.floor((window.innerWidth || 1920) / 2), cy = Math.floor((window.innerHeight || 1080) / 2);
          var r = h.raycastTerrain(cx, cy);
          if (r && r.then) r.then(function (hit) { out('raycastTerrain.hit', hit); }, function (e) { BA.log('PROBE raycast rejected: ' + e); });
          else out('raycastTerrain.sync', r);
        });

        safe('groups', function () {
          out('selectionGroupCounts', (model.selectionGroupCounts ? model.selectionGroupCounts() : 'n/a'));
          out('hasCaptureGroup', !!(api.select && api.select.captureGroup));
        });

        safe('engineSelfTest', function () {
          if (!BA.select || !BA.select._specOf) { BA.log('PROBE engineSelfTest: engine not ready'); return; }
          var specIds = (sel && sel.raw) ? sel.raw.spec_ids : {}, total = 0, builders = 0, mobile = 0, weapons = 0;
          for (var spec in specIds) { if (!specIds.hasOwnProperty(spec)) continue; var t = BA.select._specOf(spec), arr = specIds[spec] || []; total += arr.length; if (t.canBuild) builders += arr.length; if (t.mobile) mobile += arr.length; if (t.hasWeapons) weapons += arr.length; }
          out('engineSelfTest', { total: total, builders: builders, mobile: mobile, weapons: weapons });
        });

        BA.log('PROBE ===== end (async results print on the lines above as they resolve) =====');
      }

      BA.probe = run;
      // Capture-phase listener (like the overlay's) — survives PA's repeated
      // Mousetrap.reset() on keymap rebuilds, which a Mousetrap bind would not.
      // Ctrl+Shift+P, P = keyCode 80.
      function onProbeKey(e) {
        if (e.ctrlKey && e.shiftKey && !e.altKey && (e.which === 80 || e.keyCode === 80)) {
          e.preventDefault(); e.stopImmediatePropagation();
          if (!BA.util.uiBusy()) run();
          return false;
        }
      }
      document.addEventListener('keydown', onProbeKey, true);
      BA.log('probe ready — select units, press Ctrl+Shift+P to dump the capability surface to the log');
    }
  });
})();
