(function () {
  'use strict';
  var BA = window.BarAnnihilation; if (!BA) { return; }

  // -------------------------------------------------------------------------
  // Selection engine — reusable enumerate -> filter -> conclude pipeline that
  // faithfully reimplements BAR's `select Source+_Filter+_Conclusion+` DSL
  // (bar-src/luaui/Include/select_api.lua) on PA's client API.
  // Exposed as BA.select.run(spec). Design: docs/SELECT-ENGINE.md.
  //
  // TIERS:
  //   sync   — def traits from model.unitSpecs (SpecCache). No async cost.
  //   spec   — async $.get('spec:'+id) blueprint (unit_types/recon/tools), memoized
  //            forever per spec. Drives category/aircraft/radar/jammer/antiair/
  //            weaponrange. (PENDING — needs the live data-shape probe; see probe.js.)
  //   state  — async getUnitState (per-unit pos) for FromMouse/closest. (PENDING.)
  //   group  — shadow tracker over captureGroup/forgetGroup. (PENDING.)
  //
  // FIDELITY (verified vs select_api.lua):
  //   * append DEFAULTS TRUE in BAR; ClearSelection_ -> replace. Each preset passes
  //     `append` explicitly; selectIds unions with the current selection when true.
  //   * SelectOne/SelectNum/SelectPart share ONE global circular cursor
  //     (getCountUnits) that skips already-selected units when appending — this is
  //     what makes repeated presses CYCLE. A naive "first N" is the cheap lookalike.
  //   * SelectPart = floor(#uids * pct / 100).
  //   * Builder = the full OR-chain (build options OR reclaim/repair), not "canBuild".
  //   * A filter we cannot faithfully evaluate (WALL/PENDING) ABORTS the run with a
  //     clear log rather than silently dropping it (which would mis-select).
  // -------------------------------------------------------------------------
  BA.register({
    name: 'select-engine',
    init: function () {
      function inArr(a, v) { if (!a) return false; for (var i = 0; i < a.length; i++) if (a[i] === v) return true; return false; }
      function inArrCI(a, v) { if (!a) return false; v = String(v).toLowerCase(); for (var i = 0; i < a.length; i++) if (String(a[i]).toLowerCase() === v) return true; return false; }
      function hasType(types, t) { return inArrCI(types, t) || inArrCI(types, 'UNITTYPE_' + t); }
      // Armed = has a weapon. Sync signal: UNITTYPE_Offense (mobile combat) OR any
      // *Defense type (static/mobile defenses carry AirDefense/SurfaceDefense/etc, not
      // Offense). Fabbers (Construction) and economy/recon lack both -> correctly excluded.
      function isArmed(types) { if (!types) return false; for (var i = 0; i < types.length; i++) { var s = String(types[i]); if (s === 'UNITTYPE_Offense' || s.indexOf('Defense') >= 0) return true; } return false; }
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
          t.types = raw.types || [];          // SYNC unit_types (probed: field is `types`, UNITTYPE_* form)
          t.structure = !!raw.structure;
          t.mobile = !raw.structure;
          t.buildLen = (raw.build && raw.build.length) || 0;
          // BAR isBuilder OR-chain (select_api.lua:57-63) mapped onto PA traits:
          //   buildOptions[1] -> Construction/Fabber type, canBuild, build[] non-empty, or Build cmd
          //   reclaim/repair  -> the REAL Reclaim/Repair commands (NOT Assist — combat units
          //                      also Assist, which over-matched everything; probe 2026-06-27).
          //   resurrect / carrier-ship clauses have no PA analog (no resurrect; skip).
          t.canBuild = !!raw.canBuild || t.buildLen > 0 || hasType(t.types, 'Construction') || hasType(t.types, 'Fabber') || inArr(cmds, 'Build');
          t.canReclaim = inArr(cmds, 'Reclaim');
          t.canRepair = inArr(cmds, 'Repair');
          t.builder = t.canBuild || t.canReclaim || t.canRepair;
          // weapons (BAR: has a weapon mount) -> sync Offense/*Defense type. The old
          // dps/max_range heuristic false-positives on fabber build-arm range.
          t.hasWeapons = isArmed(t.types) || (!t.types.length && ((raw.dps > 0) || (raw.damage > 0) || !!(raw.projectiles && raw.projectiles.length)));
          t.transport = inArr(cmds, 'Load') || inArr(cmds, 'Unload') || inArrCI(cmds, 'load');
          t.manualFire = inArr(cmds, 'FireSecondaryWeapon');
          t.maxRange = raw.max_range || 0;   // PA backfills max-over-tools async; reflects build-arm for fabbers
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
      function allmapSource() {                 // async; planetIdx=-1 returns EMPTY, so fan out per planet and merge.
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
      var SOURCES = {
        prevselection:     function () { return pairsFrom(curSpecIds()); },
        previousselection: function () { return pairsFrom(curSpecIds()); },   // BAR alias (select_api.lua:575)
        allmap:            allmapSource
        // visible -> mutate-and-restore hack (flicker); deferred (research: no frustum query).
        // frommouse_d / frommousecylinder_d -> position tier (getUnitState pos + raycast); PENDING.
      };

      // BAR modCategory / category-filter token -> PA UNITTYPE_* (probe: types is the
      // SYNC unit_types array). A faithful subset; unmapped categories abort the run
      // rather than mis-select. radar/jammer use the UNITTYPE tag (sync proxy for BAR's
      // radarRadius/jammerRadius; misses sonar-only naval — recon-channel would need async).
      var CATMAP = {
        air: 'Air', vtol: 'Air', aircraft: 'Air',
        ship: 'Naval', sea: 'Naval', naval: 'Naval',
        bot: 'Bot', kbot: 'Bot',
        tank: 'Tank', vehicle: 'Tank',
        building: 'Structure', structure: 'Structure',
        mobile: 'Mobile',
        commander: 'Commander', comm: 'Commander',
        weapon: 'Offense', armed: 'Offense', offense: 'Offense',
        sub: 'Sub', underwater: 'Sub', canbeuw: 'Sub',
        hover: ['Hover', 'WaterHover'],
        phib: 'Amphibious', amphibious: 'Amphibious',
        factory: 'Factory',
        builder: 'Construction', constructor: 'Construction', fabber: 'Fabber', construction: 'Construction',
        orbital: 'Orbital',
        land: 'Land',
        artillery: 'Artillery',
        scout: 'Scout', recon: 'Recon',
        radar: 'Radar', jammer: 'RadarJammer',
        advanced: 'Advanced', basic: 'Basic', titan: 'Titan'
      };

      // ---- FILTERS: name -> (invert, arg) -> { needsState, test(u) } | null --
      // u = { id, spec, t:specTraits, state }. invert flips the predicate. A factory
      // returning null means "arg unsupported" -> run() aborts (never mis-selects).
      function defPred(inv, fn) { return { needsState: false, test: function (u) { var r = !!fn(u); return inv ? !r : r; } }; }
      function specSeg(spec, name) { return !!spec && (spec.indexOf('/' + name + '.') >= 0 || spec.indexOf('/' + name + '/') >= 0 || spec.indexOf('/' + name) === spec.length - name.length - 1); }
      var FILTERS = {
        builder:      function (inv) { return defPred(inv, function (u) { return u.t.builder; }); },
        buildoptions: function (inv) { return defPred(inv, function (u) { return u.t.buildLen > 0; }); },   // BAR BuildOptions (select_api.lua:150)
        building:     function (inv) { return defPred(inv, function (u) { return u.t.structure; }); },
        mobile:       function (inv) { return defPred(inv, function (u) { return u.t.mobile; }); },
        weapons:      function (inv) { return defPred(inv, function (u) { return u.t.hasWeapons; }); },
        transport:    function (inv) { return defPred(inv, function (u) { return u.t.transport; }); },
        manualfireunit: function (inv) { return defPred(inv, function (u) { return u.t.manualFire; }); },
        // category tier — SYNC via u.t.types (UNITTYPE_*). BAR canFly/radarRadius/jammerRadius/Category_c.
        aircraft:     function (inv) { return defPred(inv, function (u) { return hasType(u.t.types, 'Air'); }); },
        radar:        function (inv) { return defPred(inv, function (u) { return hasType(u.t.types, 'Radar'); }); },
        jammer:       function (inv) { return defPred(inv, function (u) { return hasType(u.t.types, 'RadarJammer'); }); },
        weaponrange:  function (inv, a) { var n = Number(a) || 0; return defPred(inv, function (u) { return u.t.hasWeapons && u.t.maxRange > n; }); },
        category:     function (inv, a) {
          var key = String(a || '').toLowerCase(); var v = CATMAP[key] || (a ? a : null);
          if (!v) return null; var arr = (typeof v === 'string') ? [v] : v;
          return defPred(inv, function (u) { for (var i = 0; i < arr.length; i++) if (hasType(u.t.types, arr[i])) return true; return false; });
        },
        inprevsel:    function (inv) { return defPred(inv, function (u) { return !!_prevSet[u.id]; }); },           // literal currently-selected (spIsUnitSelected)
        inpreviousselection: function (inv) { return defPred(inv, function (u) { return !!_prevSet[u.id]; }); },
        idmatches:    function (inv, a) { return defPred(inv, function (u) { return u.spec === a || specSeg(u.spec, a); }); },
        namecontain:  function (inv, a) { return defPred(inv, function (u) { return !!a && u.spec.indexOf(a) >= 0; }); }, // substring over spec path (~BAR udef.name)
        specin:       function (inv, set) { return defPred(inv, function (u) { return !!(set && set[u.spec]); }); }       // internal helper (same-type map-wide)
      };
      var _prevSet = {};   // snapshot of the selection at run() start (for inprevsel)

      // Filters that are genuinely NOT portable to a client mod — never fake them.
      // (per-unit HP and the C++ order queue are unreachable; cloak/stealth absent.)
      var WALL = { cloak: 1, cloaked: 1, stealth: 1, resurrect: 1, guarding: 1, waiting: 1, patrolling: 1,
                   idle: 1, absolutehealth: 1, relativehealth: 1 };
      // Portable but not yet wired (async spec-tool tier: antiair; group shadow tier).
      var PENDING = { antiair: 1, inhotkeygroup: 1, ingroup: 1 };

      // ---- CONCLUSIONS ----------------------------------------------------
      // Faithful BAR getCountUnits (select_api.lua:410-454): one persistent circular
      // cursor across ALL SelectOne/Num/Part calls; skips already-selected when
      // appending. Translated to 0-based indexing.
      var countUnitsIndex = 0;
      function getCountUnits(uids, countUntil, append) {
        var n = uids.length; if (n === 0) return [];
        var already = append ? curIdSet() : {};
        var units = [], selected = 0;
        if (countUnitsIndex >= n) countUnitsIndex = 0;
        var start = countUnitsIndex;
        while (true) {
          var uid = uids[countUnitsIndex];
          if (!already[uid]) { units.push(uid); selected++; }
          countUnitsIndex++;
          if (countUnitsIndex >= n) countUnitsIndex = 0;
          if (countUnitsIndex === start || selected >= countUntil) break;
        }
        return units;
      }
      function keysOf(o) { var a = []; for (var k in o) if (o.hasOwnProperty(k)) a.push(isNaN(+k) ? k : +k); return a; }
      // SelectUnitArray(ids, append): append => union with current selection; else replace.
      function selectIds(ids, append) {
        if (append) { var set = curIdSet(); for (var i = 0; i < ids.length; i++) set[ids[i]] = true; ids = keysOf(set); }
        if (!ids.length) { if (!append) try { api.select.empty(); } catch (e) {} return ids; }
        try { api.select.unitsById(ids); } catch (e) { BA.err('select: unitsById failed', e); }
        return ids;
      }
      function conclude(name, arg, ids, append) {
        ids = ids.slice().sort();   // stable order so the circular cursor cycles reliably
        if (name === 'selectnum' || name === 'selectnumber') return selectIds(getCountUnits(ids, Number(arg) || 0, append), append);
        if (name === 'selectpart') {
          var countUntil = Math.floor(ids.length * (Number(arg) || 0) / 100);   // BAR: math.floor
          return selectIds(getCountUnits(ids, countUntil, append), append);
        }
        if (name === 'selectone') {
          var picked = getCountUnits(ids, 1, append);
          var res = selectIds(picked, append);
          if (picked.length) { try { if (api.camera && api.camera.track) api.camera.track(true); } catch (e) {} }  // center on the cycled unit
          return res;
        }
        return selectIds(ids, append);   // selectall (default)
      }

      // ---- run(spec) ------------------------------------------------------
      function run(spec) {
        spec = spec || {};
        var srcName = (spec.source || 'prevselection').toLowerCase();
        var srcFn = SOURCES[srcName];
        if (!srcFn) {
          if (srcName === 'visible' || srcName.indexOf('frommouse') === 0) BA.warn('select: source "' + srcName + '" not yet implemented (PENDING tier) — aborting');
          else BA.warn('select: unknown source ' + spec.source + ' — aborting');
          return;
        }
        _prevSet = curIdSet();
        var preds = [], needState = false, defs = spec.filters || [], abort = null;
        for (var i = 0; i < defs.length; i++) {
          var nm = (defs[i].name || '').toLowerCase();
          var fn = FILTERS[nm];
          if (!fn) { abort = (WALL[nm] ? 'not portable (grey out): ' : (PENDING[nm] ? 'PENDING async tier: ' : 'unknown filter: ')) + nm; break; }
          var p = fn(!!defs[i].invert, defs[i].arg);
          if (!p) { abort = 'filter arg unsupported: ' + nm + '_' + defs[i].arg; break; }
          preds.push(p); if (p.needsState) needState = true;
        }
        if (abort) { BA.log('select: ABORT — ' + abort + ' (refusing to mis-select)'); return; }

        function finish(list) {
          var ids = []; for (var i = 0; i < list.length; i++) ids.push(list[i].id);
          var picked = conclude((spec.conclusion || 'selectall').toLowerCase(), spec.conclusionArg, ids, !!spec.append);
          BA.log('select: src=' + srcName + ' filt=' + defs.length + ' append=' + !!spec.append + ' kept=' + ids.length + ' picked=' + (picked ? picked.length : 0));
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

      BA.select = { run: run, _specOf: specOf, _sources: SOURCES, _filters: FILTERS, _count: getCountUnits, _wall: WALL, _pending: PENDING };
      BA.log('select-engine ready (sync def tier + faithful conclusions; async spec/state/group tiers PENDING probe)');
    }
  });
})();
