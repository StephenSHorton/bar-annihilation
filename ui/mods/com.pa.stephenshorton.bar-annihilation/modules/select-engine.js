(function () {
  'use strict';
  var BA = window.BarAnnihilation; if (!BA) { return; }

  // -------------------------------------------------------------------------
  // Selection engine — reusable enumerate -> filter -> conclude pipeline that
  // faithfully reimplements BAR's `select Source+_Filter+_Conclusion+` DSL
  // (bar-src/luaui/Include/select_api.lua) on PA's client API.
  // Exposed as BA.select.run(spec). Design: docs/SELECT-ENGINE.md.
  //
  // TIERS (data-shapes confirmed via probe.js, 2026-06-27):
  //   sync   — def traits from model.unitSpecs incl. `types` (the unit_types array).
  //            Drives most filters incl. the whole category tier (aircraft/radar/
  //            jammer/category/weaponrange). No async cost.
  //   spec   — async $.get('spec:'+id) blueprint + nested tool fetch, memoized per
  //            spec forever. Drives antiAir (weapon target_layers ⊇ WL_Air, not flyer).
  //   state  — async getUnitState (per-unit pos) for FromMouse_d / SelectClosestToCursor.
  //   group  — shadow tracker wrapping captureGroup/forgetGroup -> InHotkeyGroup/InGroup.
  //   (Visible is the only deferred tier: needs a mutate-and-restore on-screen hack.)
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

      // ---- async spec-blueprint tier --------------------------------------
      // $.get('spec:'+id) (probe-confirmed) returns the merged blueprint whose tools[]
      // are refs; a nested fetch of each tool yields target_layers (["WL_Air"] = can hit
      // air). Computes traits the sync unit_specs push lacks. Memoized per spec forever.
      var bpCache = {};   // spec -> { antiair } (resolved async)
      function getJSON(path) {   // -> thenable resolving parsed-object|null (tries spec: then /)
        return { then: function (res) {
          if (typeof $ === 'undefined' || !$.get) { res(null); return; }
          function parse(d) { var o = d; try { if (typeof d === 'string') o = JSON.parse(d); } catch (e) {} return o; }
          var p; try { p = $.get('spec:' + path); } catch (e) { res(null); return; }
          if (!p || !p.done) { res(null); return; }
          p.done(function (d) { res(parse(d)); }).fail(function () {
            var q; try { q = $.get('/' + path); } catch (e) { res(null); return; }
            if (!q || !q.done) { res(null); return; }
            q.done(function (d) { res(parse(d)); }).fail(function () { res(null); });
          });
        } };
      }
      function blueprintTraits(spec, cb) {     // resolve + memoize one spec's async traits
        if (bpCache[spec] !== undefined) { cb(bpCache[spec]); return; }
        getJSON(spec).then(function (bp) {
          if (!bp) { bpCache[spec] = {}; cb(bpCache[spec]); return; }
          var tools = bp.tools || [], paths = [];
          for (var i = 0; i < tools.length; i++) if (tools[i] && tools[i].spec_id) paths.push(tools[i].spec_id);
          var isAir = hasType(specOf(spec).types, 'Air');
          if (!paths.length) { bpCache[spec] = { antiair: false }; cb(bpCache[spec]); return; }
          var calls = []; for (var j = 0; j < paths.length; j++) calls.push(getJSON(paths[j]));
          allThen(calls, function (toolDefs) {
            var aa = false;
            for (var k = 0; k < toolDefs.length; k++) { var td = toolDefs[k]; if (td && td.target_layers && inArr(td.target_layers, 'WL_Air')) aa = true; }
            bpCache[spec] = { antiair: aa && !isAir };   // BAR antiAir excludes flyers (select_api.lua:248)
            cb(bpCache[spec]);
          });
        });
      }
      function resolveBlueprints(specs, done) {
        var todo = []; for (var i = 0; i < specs.length; i++) if (bpCache[specs[i]] === undefined && todo.indexOf(specs[i]) < 0) todo.push(specs[i]);
        if (!todo.length) { done(); return; }
        var n = todo.length, k = 0;
        for (var i = 0; i < n; i++) blueprintTraits(todo[i], function () { if (++k === n) done(); });
      }

      // ---- position tier: cursor world-pos + per-unit positions -----------
      // FromMouse / SelectClosestToCursor need the cursor world pos (raycastTerrain ->
      // {pos:[x,y,z]}, probed) and per-unit pos (getUnitState.pos, probed). PA has no
      // cursor API, so we track the pointer ourselves off the full-screen host document
      // (client==offset there); apply ui_scale exactly as PA's scaleMouseEvent does.
      var lastMouse = { x: ((window.innerWidth || 1920) / 2), y: ((window.innerHeight || 1080) / 2) };
      var cursorTracked = false;
      function installCursorTracking() {
        if (cursorTracked) return; cursorTracked = true;
        document.addEventListener('mousemove', function (e) { lastMouse.x = e.clientX; lastMouse.y = e.clientY; }, true);
      }
      function uiScale() { try { var s = (model.uiScale ? (typeof model.uiScale === 'function' ? model.uiScale() : model.uiScale) : 1); return s || 1; } catch (e) { return 1; } }
      function holo() { try { return api.Holodeck.focused; } catch (e) { return null; } }
      function mouseWorldPos(cb) {            // -> [x,y,z] | null
        var h = holo(); if (!h || !h.raycastTerrain) { cb(null); return; }
        var sc = uiScale(), r;
        try { r = h.raycastTerrain(Math.floor(lastMouse.x * sc), Math.floor(lastMouse.y * sc)); } catch (e) { cb(null); return; }
        if (r && r.then) r.then(function (hit) { cb(hit && hit.pos ? hit.pos : null); }, function () { cb(null); });
        else cb(r && r.pos ? r.pos : null);
      }
      function positionsOf(ids, cb) {         // -> { id: [x,y,z] }
        var wv = worldView(); if (!wv || !wv.getUnitState || !ids.length) { cb({}); return; }
        wv.getUnitState(ids).then(function (sm) {
          var m = {}; if (sm) for (var i = 0; i < ids.length; i++) { var st = sm[ids[i]] || sm[i]; if (st && st.pos) m[ids[i]] = st.pos; } cb(m);
        }, function () { cb({}); });
      }
      function dist2(a, b) { var dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2]; return dx * dx + dy * dy + dz * dz; }
      function dist2xz(a, b) { var dx = a[0] - b[0], dz = a[2] - b[2]; return dx * dx + dz * dz; }
      // FromMouse_d (sphere) / FromMouseCylinder_d (xz disc): own units within radius d of cursor.
      function fromMouseSource(arg, cylinder) {
        var d = Number(arg) || 0;
        return { then: function (cb) {
          whenThen(allmapSource(), function (pairs) {
            pairs = pairs || []; if (!pairs.length) { cb([]); return; }
            mouseWorldPos(function (mp) {
              if (!mp) { BA.warn('select: FromMouse — no cursor world pos'); cb([]); return; }
              var ids = []; for (var i = 0; i < pairs.length; i++) ids.push(pairs[i].id);
              positionsOf(ids, function (pm) {
                var out = [], r2 = d * d;
                for (var i = 0; i < pairs.length; i++) { var q = pm[pairs[i].id]; if (!q) continue; var dd = cylinder ? dist2xz(q, mp) : dist2(q, mp); if (dd <= r2) out.push(pairs[i]); }
                cb(out);
              });
            });
          });
        } };
      }

      // ---- group shadow tracker -------------------------------------------
      // PA exposes no unit->group map, but native Ctrl+N and the control-group bar both
      // route through api.select.capture/forget/recallGroup (inputmap.js:143-163), so we
      // wrap them: capture REPLACES a group with the current selection, forget clears it.
      // (Groups set before we wrap — e.g. the commander's auto group 1 — are invisible.)
      var groupSets = {};   // groupNum -> { unitId: true }
      function inAnyGroup(id) { for (var g in groupSets) { if (groupSets.hasOwnProperty(g) && groupSets[g][id]) return true; } return false; }
      var groupsWrapped = false;
      function wrapGroups() {
        if (groupsWrapped || !api || !api.select) return; groupsWrapped = true;
        var sel = api.select, oc = sel.captureGroup, of = sel.forgetGroup;
        if (oc) sel.captureGroup = function (g) { var r = oc.apply(sel, arguments); try { var n = (typeof g === 'number') ? g : 0, set = {}, s = BA.util.readSelection(), ids = s ? s.ids : []; for (var i = 0; i < ids.length; i++) set[ids[i]] = true; groupSets[n] = set; BA.log('group: captured ' + ids.length + ' unit(s) into group ' + n); } catch (e) {} return r; };
        if (of) sel.forgetGroup = function (g) { var r = of.apply(sel, arguments); try { var n = (typeof g === 'number') ? g : 0; delete groupSets[n]; } catch (e) {} return r; };
        BA.log('group shadow tracker installed (capture/forget wrapped)');
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
        allmap:            allmapSource,
        frommouse:         function (arg) { return fromMouseSource(arg, false); },   // FromMouse_d (sphere)
        frommousecylinder: function (arg) { return fromMouseSource(arg, true); },    // FromMouseCylinder_d (xz disc)
        frommousec:        function (arg) { return fromMouseSource(arg, true); }      // BAR alias FromMouseC_d
        // visible -> mutate-and-restore hack (flicker); deferred (research: no frustum query).
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
        antiair:      function (inv) { return { needsSpec: true, needsState: false, test: function (u) { var r = !!(u.bp && u.bp.antiair); return inv ? !r : r; } }; },  // async tool target_layers WL_Air, not flyer
        category:     function (inv, a) {
          var key = String(a || '').toLowerCase(); var v = CATMAP[key] || (a ? a : null);
          if (!v) return null; var arr = (typeof v === 'string') ? [v] : v;
          return defPred(inv, function (u) { for (var i = 0; i < arr.length; i++) if (hasType(u.t.types, arr[i])) return true; return false; });
        },
        inprevsel:    function (inv) { return defPred(inv, function (u) { return !!_prevSet[u.id]; }); },           // literal currently-selected (spIsUnitSelected)
        inpreviousselection: function (inv) { return defPred(inv, function (u) { return !!_prevSet[u.id]; }); },
        inhotkeygroup: function (inv) { return defPred(inv, function (u) { return inAnyGroup(u.id); }); },          // shadow tracker
        ingroup:      function (inv, a) { var n = Number(a); if (isNaN(n)) return null; return defPred(inv, function (u) { return !!(groupSets[n] && groupSets[n][u.id]); }); },
        idmatches:    function (inv, a) { return defPred(inv, function (u) { return u.spec === a || specSeg(u.spec, a); }); },
        namecontain:  function (inv, a) { return defPred(inv, function (u) { return !!a && u.spec.indexOf(a) >= 0; }); }, // substring over spec path (~BAR udef.name)
        specin:       function (inv, set) { return defPred(inv, function (u) { return !!(set && set[u.spec]); }); }       // internal helper (same-type map-wide)
      };
      var _prevSet = {};   // snapshot of the selection at run() start (for inprevsel)

      // Filters that are genuinely NOT portable to a client mod — never fake them.
      // (per-unit HP and the C++ order queue are unreachable; cloak/stealth absent.)
      var WALL = { cloak: 1, cloaked: 1, stealth: 1, resurrect: 1, guarding: 1, waiting: 1, patrolling: 1,
                   idle: 1, absolutehealth: 1, relativehealth: 1 };
      // All portable filters are now implemented; unknown names fall through to "unknown".
      var PENDING = {};

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
        if (name === 'selectclosesttocursor') {   // async: nearest candidate to the cursor world pos
          mouseWorldPos(function (mp) {
            if (!mp || !ids.length) { selectIds([], append); return; }
            positionsOf(ids, function (pm) {
              var best = null, bd = Infinity;
              for (var i = 0; i < ids.length; i++) { var q = pm[ids[i]]; if (!q) continue; var dd = dist2(q, mp); if (dd < bd) { bd = dd; best = ids[i]; } }
              selectIds(best != null ? [best] : [], append);
              BA.log('select: closest-to-cursor picked ' + (best != null ? 1 : 0));
            });
          });
          return null;   // async; selection actuates in the callback above
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
        var preds = [], needState = false, needSpec = false, defs = spec.filters || [], abort = null;
        for (var i = 0; i < defs.length; i++) {
          var nm = (defs[i].name || '').toLowerCase();
          var fn = FILTERS[nm];
          if (!fn) { abort = (WALL[nm] ? 'not portable (grey out): ' : (PENDING[nm] ? 'PENDING async tier: ' : 'unknown filter: ')) + nm; break; }
          var p = fn(!!defs[i].invert, defs[i].arg);
          if (!p) { abort = 'filter arg unsupported: ' + nm + '_' + defs[i].arg; break; }
          preds.push(p); if (p.needsState) needState = true; if (p.needsSpec) needSpec = true;
        }
        if (abort) { BA.log('select: ABORT — ' + abort + ' (refusing to mis-select)'); return; }

        // tier of a predicate = the stage it runs in (state > spec > sync).
        function applyTier(u, tier) {
          for (var j = 0; j < preds.length; j++) {
            var pr = preds[j], pt = pr.needsState ? 'state' : (pr.needsSpec ? 'spec' : 'sync');
            if (pt === tier && !pr.test(u)) return false;
          }
          return true;
        }
        function finish(list) {
          var ids = []; for (var i = 0; i < list.length; i++) ids.push(list[i].id);
          var picked = conclude((spec.conclusion || 'selectall').toLowerCase(), spec.conclusionArg, ids, !!spec.append);
          BA.log('select: src=' + srcName + ' filt=' + defs.length + ' append=' + !!spec.append + ' kept=' + ids.length + ' picked=' + (picked ? picked.length : 0));
          return picked;
        }
        function specStage(list, cb) {            // async: resolve blueprint traits per distinct spec
          if (!needSpec) { cb(list); return; }
          var specs = []; for (var i = 0; i < list.length; i++) if (specs.indexOf(list[i].spec) < 0) specs.push(list[i].spec);
          resolveBlueprints(specs, function () {
            var out = []; for (var i = 0; i < list.length; i++) { var u = list[i]; u.bp = bpCache[u.spec] || {}; if (applyTier(u, 'spec')) out.push(u); }
            cb(out);
          });
        }
        function stateStage(list, cb) {           // async: per-unit getUnitState (pos)
          if (!needState) { cb(list); return; }
          var ids = []; for (var i = 0; i < list.length; i++) ids.push(list[i].id);
          var wv = worldView();
          if (!wv || !wv.getUnitState || !ids.length) { BA.warn('select: runtime state needed but unavailable'); cb([]); return; }
          wv.getUnitState(ids).then(function (sm) {
            var out = []; for (var i = 0; i < list.length; i++) { var u = list[i]; u.state = sm ? (sm[u.id] || sm[i] || null) : null; if (applyTier(u, 'state')) out.push(u); }
            cb(out);
          });
        }
        return whenThen(srcFn(spec.sourceArg), function (pairs) {
          pairs = pairs || [];
          var stage = [];
          for (var i = 0; i < pairs.length; i++) { var u = pairs[i]; u.t = specOf(u.spec); if (applyTier(u, 'sync')) stage.push(u); }
          specStage(stage, function (afterSpec) { stateStage(afterSpec, function (afterState) { finish(afterState); }); });
        });
      }

      installCursorTracking();
      wrapGroups();

      BA.select = { run: run, _specOf: specOf, _blueprint: blueprintTraits, _mouseWorldPos: mouseWorldPos, _positionsOf: positionsOf, _sources: SOURCES, _filters: FILTERS, _count: getCountUnits, _groups: groupSets, _wall: WALL, _pending: PENDING };
      BA.log('select-engine ready (def + category + antiAir + position + group tiers; Visible deferred)');
    }
  });
})();
