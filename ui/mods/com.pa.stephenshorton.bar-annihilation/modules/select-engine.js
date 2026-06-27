(function () {
  'use strict';
  var BA = window.BarAnnihilation; if (!BA) { return; }

  // -------------------------------------------------------------------------
  // Selection engine — reusable enumerate -> filter -> conclude pipeline that
  // reimplements BAR's `select Source+Filter+Conclusion` DSL on PA's API.
  // Exposed as BA.select.run(spec). Design: docs/SELECT-ENGINE.md.
  // Tiers: SpecCache (sync def traits) | getUnitState (async runtime) | shadow
  // trackers (groups, later). Each filter declares needsState so a pure-def
  // query never pays the async cost. Nothing here is bound to a key yet — the
  // faithful BAR presets get wired in after the live probe confirms the async
  // surface (see docs/SELECT-ENGINE.md build order).
  // -------------------------------------------------------------------------
  BA.register({
    name: 'select-engine',
    init: function () {
      function inArr(a, v) { if (!a) return false; for (var i = 0; i < a.length; i++) if (a[i] === v) return true; return false; }
      function whenThen(v, cb) { return (v && typeof v.then === 'function') ? v.then(cb) : cb(v); }
      function worldView() { try { return api.getWorldView ? api.getWorldView(0) : null; } catch (e) { return null; } }
      // Planet indices to enumerate (getArmyUnits(idx,-1) returns EMPTY — probe 2026-06-26 — so loop).
      function planetIndices() { try { var pl = model.planetListState ? model.planetListState() : null; if (pl && pl.planets && pl.planets.length) { var a = []; for (var i = 0; i < pl.planets.length; i++) a.push(i); return a; } } catch (e) {} return [0]; }
      // Promise.all shim for Coherent thenables (no native Promise.all in old Coherent).
      function allThen(arr, cb) { var n = arr.length, res = new Array(n), done = 0; if (!n) { cb([]); return; } for (var i = 0; i < n; i++) { (function (ix) { var v = arr[ix]; if (v && typeof v.then === 'function') v.then(function (r) { res[ix] = r; if (++done === n) cb(res); }, function () { res[ix] = null; if (++done === n) cb(res); }); else { res[ix] = v; if (++done === n) cb(res); } })(i); } }

      // ---- SpecCache: per-def blueprint traits from model.unitSpecs (sync).
      // Cache only KNOWN specs so a too-early call can't poison the cache.
      var specCache = {};
      function specOf(spec) {
        if (specCache[spec]) return specCache[spec];
        var raw = (typeof model !== 'undefined' && model.unitSpecs) ? model.unitSpecs[spec] : null;
        var t = { spec: spec, known: !!raw };
        if (raw) {
          var cmds = raw.commands || [];
          t.structure = !!raw.structure;
          t.mobile = !raw.structure;
          t.canBuild = !!raw.canBuild || !!(raw.build && raw.build.length);
          t.hasWeapons = (raw.dps > 0) || (raw.damage > 0) || (raw.max_range > 0) || !!(raw.projectiles && raw.projectiles.length);
          t.transport = inArr(cmds, 'Load') || inArr(cmds, 'Unload');
          t.manualFire = inArr(cmds, 'FireSecondaryWeapon');
          t.maxRange = raw.max_range || 0;
          t.commands = cmds;
          specCache[spec] = t;
        }
        return t;
      }

      // ---- current selection helpers --------------------------------------
      function curSpecIds() { var s = BA.util.readSelection(); return (s && s.raw && s.raw.spec_ids) ? s.raw.spec_ids : {}; }
      function curIdSet() { var set = {}, s = BA.util.readSelection(), ids = s ? s.ids : []; for (var i = 0; i < ids.length; i++) set[ids[i]] = true; return set; }
      function pairsFrom(map) { var out = []; for (var spec in map) { if (!map.hasOwnProperty(spec)) continue; var arr = map[spec] || []; for (var i = 0; i < arr.length; i++) out.push({ id: arr[i], spec: spec }); } return out; }

      // ---- SOURCES: () -> (array | Promise<array>) of {id, spec} -----------
      var SOURCES = {
        prevselection: function () { return pairsFrom(curSpecIds()); },
        allmap: function () {                 // async; planetIdx=-1 returns EMPTY, so fan out per planet and merge.
          var wv = worldView(); if (!wv || !wv.getArmyUnits) { BA.warn('select: getArmyUnits unavailable'); return []; }
          var ai = (model.armyIndex ? model.armyIndex() : 0), idxs = planetIndices(), calls = [];
          for (var i = 0; i < idxs.length; i++) calls.push(wv.getArmyUnits(ai, idxs[i]));
          return { then: function (cb) {
            allThen(calls, function (maps) {
              var merged = {};
              for (var m = 0; m < maps.length; m++) { var mp = maps[m]; if (!mp) continue; for (var spec in mp) { if (mp.hasOwnProperty(spec)) merged[spec] = (merged[spec] || []).concat(mp[spec] || []); } }
              cb(pairsFrom(merged));
            });
          } };
        }
      };

      // ---- FILTERS: name -> (invert, arg) -> { needsState, test(u) } -------
      // u = { id, spec, t:specTraits, state }. invert flips the predicate.
      function defPred(inv, fn) { return { needsState: false, test: function (u) { var r = !!fn(u); return inv ? !r : r; } }; }
      function statePred(inv, fn) { return { needsState: true, test: function (u) { var r = !!fn(u); return inv ? !r : r; } }; }
      function specSeg(spec, name) { return !!spec && (spec.indexOf('/' + name + '.') >= 0 || spec.indexOf('/' + name + '/') >= 0); }
      var FILTERS = {
        builder:    function (inv) { return defPred(inv, function (u) { return u.t.canBuild; }); },
        building:   function (inv) { return defPred(inv, function (u) { return u.t.structure; }); },
        mobile:     function (inv) { return defPred(inv, function (u) { return u.t.mobile; }); },
        weapons:    function (inv) { return defPred(inv, function (u) { return u.t.hasWeapons; }); },
        transport:  function (inv) { return defPred(inv, function (u) { return u.t.transport; }); },
        manualfire: function (inv) { return defPred(inv, function (u) { return u.t.manualFire; }); },
        inprevsel:  function (inv) { return defPred(inv, function (u) { return !!_prevSet[u.id]; }); },
        idmatches:  function (inv, a) { return defPred(inv, function (u) { return u.spec === a || specSeg(u.spec, a); }); },
        specin:     function (inv, set) { return defPred(inv, function (u) { return !!(set && set[u.spec]); }); }
        // NO health filters: probe 2026-06-26 confirmed getUnitState carries no HP
        // (only {planet,unit_spec,pos,army,orient}) and no other client path exposes
        // per-unit health, so BAR's damaged-select is a HARD WALL. statePred is kept
        // for future POSITION-based filters (getUnitState.pos: FromMouse/closest).
        // category/aircraft/radar/jammer -> async spec GET ('spec:'+id has unit_types[]) — next increment.
      };
      var _prevSet = {};   // snapshot of the selection at run() start (for inprevsel)

      // ---- CONCLUSIONS ----------------------------------------------------
      var cycleState = {};
      function keysOf(o) { var a = []; for (var k in o) if (o.hasOwnProperty(k)) a.push(isNaN(+k) ? k : +k); return a; }
      function selectIds(ids, append) {
        if (append) { var set = curIdSet(); for (var i = 0; i < ids.length; i++) set[ids[i]] = true; ids = keysOf(set); }
        if (!ids.length) { if (!append) try { api.select.empty(); } catch (e) {} return ids; }
        try { api.select.unitsById(ids); } catch (e) { BA.err('select: unitsById failed', e); }
        return ids;
      }
      function conclude(name, arg, ids, append, cycleKey) {
        ids = ids.slice().sort();
        if (name === 'selectnum')  return selectIds(ids.slice(0, Number(arg) || 0), append);
        if (name === 'selectpart') return selectIds(ids.slice(0, Math.ceil(ids.length * (Number(arg) || 0) / 100)), append);
        if (name === 'selectone') {
          if (!ids.length) return ids;
          var k = cycleKey || 'default', ix = (ids.indexOf(cycleState[k]) + 1) % ids.length;
          cycleState[k] = ids[ix];
          try { api.select.unitsById([ids[ix]]); if (api.camera && api.camera.track) api.camera.track(true); } catch (e) {}
          return [ids[ix]];
        }
        return selectIds(ids, append);   // selectall (default)
      }

      // ---- run(spec) ------------------------------------------------------
      function run(spec) {
        spec = spec || {};
        var srcFn = SOURCES[(spec.source || 'prevselection').toLowerCase()];
        if (!srcFn) { BA.warn('select: unknown source ' + spec.source); return; }
        _prevSet = curIdSet();
        var preds = [], needState = false, defs = spec.filters || [];
        for (var i = 0; i < defs.length; i++) {
          var fn = FILTERS[(defs[i].name || '').toLowerCase()];
          if (!fn) { BA.warn('select: unportable/unknown filter "' + defs[i].name + '" (skipped)'); continue; }
          var p = fn(!!defs[i].invert, defs[i].arg); preds.push(p); if (p.needsState) needState = true;
        }
        function finish(list) {
          var ids = []; for (var i = 0; i < list.length; i++) ids.push(list[i].id);
          var picked = conclude((spec.conclusion || 'selectall').toLowerCase(), spec.conclusionArg, ids, !!spec.append, spec.cycleKey);
          BA.log('select: source=' + (spec.source || 'prevselection') + ' kept=' + ids.length + ' picked=' + (picked ? picked.length : 0));
          return picked;
        }
        return whenThen(srcFn(spec.sourceArg), function (pairs) {
          pairs = pairs || [];
          var stage = [];
          for (var i = 0; i < pairs.length; i++) {
            var u = pairs[i]; u.t = specOf(u.spec); var ok = true;
            for (var j = 0; j < preds.length; j++) { if (!preds[j].needsState && !preds[j].test(u)) { ok = false; break; } }
            if (ok) stage.push(u);
          }
          if (!needState) return finish(stage);
          var ids = []; for (var i = 0; i < stage.length; i++) ids.push(stage[i].id);
          var wv = worldView();
          if (!wv || !wv.getUnitState || !ids.length) { BA.warn('select: runtime state needed but unavailable'); return finish([]); }
          return wv.getUnitState(ids).then(function (sm) {
            var out = [];
            for (var i = 0; i < stage.length; i++) {
              var u = stage[i]; u.state = sm ? (sm[u.id] || sm[i] || null) : null; var ok = true;
              for (var j = 0; j < preds.length; j++) { if (preds[j].needsState && !preds[j].test(u)) { ok = false; break; } }
              if (ok) out.push(u);
            }
            return finish(out);
          });
        });
      }

      BA.select = { run: run, _specOf: specOf, _sources: SOURCES, _filters: FILTERS };
      BA.log('select-engine ready (sync def tier live; async state/category/group tiers pending live probe)');
    }
  });
})();
