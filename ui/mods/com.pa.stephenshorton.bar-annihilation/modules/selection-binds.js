(function () {
  'use strict';
  var BA = window.BarAnnihilation; if (!BA) { return; }

  // -------------------------------------------------------------------------
  // M1 — Selection on real BAR (Grid) keys, with TOTAL override of PA.
  // We Mousetrap.unbind(key)+bind(key, ourFn) after PA binds, and re-apply when
  // PA rebuilds its keymap, so only our action fires (PA's is fully blocked).
  // -------------------------------------------------------------------------
  BA.register({
    name: 'bar-binds',
    init: function () {
      if (typeof Mousetrap === 'undefined' || !Mousetrap.bind) { BA.warn('Mousetrap unavailable — BAR key binds disabled'); return; }

      // BAR Ctrl+Q (grid) = `PrevSelection++_ClearSelection_SelectPart_50+` — keep half
      // the current selection, REPLACE. Route through the engine's faithful SelectPart
      // (floor(n*50/100) + the shared circular cursor, so repeated presses cycle/halve).
      function split50() {
        var s = BA.util.readSelection();
        if (!s || s.units < 2) { BA.log('BAR split: need >=2 selected (have ' + (s ? s.units : 0) + ')'); return; }
        if (BA.select && BA.select.run) { BA.select.run({ source: 'prevselection', conclusion: 'selectpart', conclusionArg: 50, append: false }); return; }
        var half = s.ids.slice(0, Math.floor(s.ids.length / 2));   // fallback if engine not ready
        api.select.unitsById(half);
        BA.log('BAR split 50%: kept ' + half.length + ' of ' + s.units);
      }

      function selectAllCombat() {
        api.select.allCombatUnits();
        BA.log('BAR: select all combat units');
      }

      // BAR Ctrl+E (grid) = `select AllMap++_ClearSelection_SelectAll+` — ALL own units
      // map-wide (not just combat). Routes through the select-engine's allmap source.
      function selectAllUnits() {
        if (BA.select && BA.select.run) BA.select.run({ source: 'allmap', conclusion: 'selectall' });
        else { BA.warn('select-engine not ready; falling back to all-combat'); api.select.allCombatUnits(); }
      }

      // BAR sc_q: select all on-screen units matching the type(s) currently selected.
      function selectSameTypeOnScreen() {
        var sel = (typeof model !== 'undefined' && model.selection)
          ? ((typeof model.selection === 'function') ? model.selection() : model.selection) : null;
        var types = (sel && sel.spec_ids) ? Object.keys(sel.spec_ids) : [];
        if (!types.length) { BA.log('BAR: select same type -- nothing selected'); return; }
        var hd = (typeof api !== 'undefined' && api.Holodeck) ? api.Holodeck.focused : null;
        if (!hd || !hd.selectMatchingTypes) { BA.warn('BAR: no focused holodeck for selectMatchingTypes'); return; }
        hd.selectMatchingTypes('default', types);
        BA.log('BAR: select same type on screen (' + types.length + ' type(s))');
      }

      // Same-type MAP-WIDE (off-screen included) — the keyboard counterpart of BAR's
      // Ctrl+double-click. Enumerate all own units via the engine's allmap source and
      // keep those whose spec is in the current selection. (Needs client enumeration:
      // there is no engine verb for specific-type map-wide — that's why the old Ctrl+W
      // was dropped before we had getArmyUnits.)
      function selectSameTypeMapWide() {
        var sel = BA.util.readSelection(), specs = (sel && sel.raw && sel.raw.spec_ids) ? Object.keys(sel.raw.spec_ids) : [];
        if (!specs.length) { BA.log('BAR: same-type map-wide -- nothing selected'); return; }
        if (!BA.select || !BA.select.run) { BA.warn('select-engine not ready for same-type map-wide'); return; }
        var set = {}; for (var i = 0; i < specs.length; i++) set[specs[i]] = true;
        BA.select.run({ source: 'allmap', filters: [{ name: 'specin', arg: set }], conclusion: 'selectall' });
        BA.log('BAR: select same type map-wide (' + specs.length + ' type(s))');
      }

      // BAR 'focus': center (and track) the camera on the current selection.
      function focusSelection() {
        try { if (api.camera && api.camera.track) api.camera.track(true); } catch (e) {}
      }
      function selectThenFocus(promise) {
        if (promise && promise.then) promise.then(focusSelection); else setTimeout(focusSelection, 30);
      }
      // Stable signature (sorted unit ids) of the current selection.
      function selSig() { var s = BA.util.readSelection(); return s.ids.slice().sort().join(','); }
      // Run a selector that changes selection; center the camera ONLY if the
      // selection ends up UNCHANGED (BAR "press again, while already selected, to
      // go there"). Selection updates arrive async, so we watch one selection event.
      function selectThenFocusOnRepeat(selectorFn, label) {
        var before = selSig(), done = false, sub = null;
        function finish(changed) {
          if (done) return; done = true;
          try { if (sub) sub.dispose(); } catch (e) {}
          if (!changed) focusSelection();
          BA.log('BAR: ' + label + (changed ? '' : ' (focus)'));
        }
        if (model.selection && model.selection.subscribe) {
          sub = model.selection.subscribe(function () { finish(selSig() !== before); });
          setTimeout(function () { finish(false); }, 250);   // no event => unchanged => center
        } else { setTimeout(function () { finish(selSig() !== before); }, 60); }
        try { selectorFn(); } catch (e) { BA.err('BAR select failed', e); }
      }

      // BAR Ctrl+Tab: cycle ONE idle builder at a time (BAR's "SelectOne"). PA's
      // legacy api.select.idleFabber() is unreliable (doesn't select/cycle), so we
      // drive the native, reliable api.select.idleFabbers(planet) (selects ALL idle
      // fabbers), read the resulting set via a one-shot selection subscription, then
      // narrow to a single builder and advance a cycle pointer on each press.
      var idleCycle = { last: null };
      function currentPlanet() {
        // focus_planet_id (camera.js:379) is what idleFabbers/onPlanet expect; NOT .planet().
        // The camera api defaults it to -1 and only updates on a planet switch, but PA's
        // own idle button defaults to 0 (control_group_bar.js:47) — so coerce -1 -> 0.
        try { var pid = api.camera.getFocus(api.Holodeck.focused.id).planetId(); return (typeof pid === 'number' && pid >= 0) ? pid : 0; } catch (e) { return 0; }
      }
      function selectIdleBuilderCycle() {
        var pid = currentPlanet();
        if (!model.selection || !model.selection.subscribe) { api.select.idleFabbers(pid); return; }
        var done = false, sub = null;
        function finish(ids) {
          if (done) return; done = true;
          try { if (sub) sub.dispose(); } catch (e) {}
          if (!ids || !ids.length) { BA.log('BAR: no idle builders (planet ' + pid + ')'); return; }
          ids = ids.slice().sort();
          var nextIx = (ids.indexOf(idleCycle.last) + 1) % ids.length;   // not-found(-1) -> 0
          idleCycle.last = ids[nextIx];
          api.select.unitsById([ids[nextIx]]);
          setTimeout(focusSelection, 30);
          BA.log('BAR: idle builder ' + (nextIx + 1) + '/' + ids.length);
        }
        sub = model.selection.subscribe(function () { finish(BA.util.readSelection().ids); });
        setTimeout(function () { finish(null); }, 250);   // fallback if nothing idle / no change
        api.select.idleFabbers(pid);
      }

      // Mousetrap key string (BAR Grid default) -> { label, run }.
      var KEYMAP = {
        'tab':      { label: 'Select commander',    run: function () { selectThenFocusOnRepeat(function () { api.select.commander(); }, 'select commander'); } },
        'ctrl+tab': { label: 'Select idle builder', run: selectIdleBuilderCycle },
        'ctrl+q':   { label: 'Split selection 50%', run: split50 },
        'ctrl+e':   { label: 'Select all units',    run: selectAllUnits },
        'q':        { label: 'Select same type (on screen)', run: selectSameTypeOnScreen },
        'ctrl+w':   { label: 'Select same type (map-wide)',  run: selectSameTypeMapWide },
        '\\':       { label: 'Toggle key overlay',  run: function () { if (BA.overlayToggle) BA.overlayToggle(); else BA.warn('overlay toggle not ready yet'); } },
        'ctrl+shift+r': { label: 'Reload UI scene (dev)', run: function () { try { BA.log('reloading live_game scene...'); api.game.debug.reloadScene(api.Panel.pageId); } catch (e) { BA.err('scene reload failed', e); } } }
      };

      // Publish our binds for the keyboard overlay.
      for (var bk in KEYMAP) { if (KEYMAP.hasOwnProperty(bk)) BA.binds[bk] = KEYMAP[bk].label; }

      function wrap(fn) {
        return function () {
          if (BA.util.uiBusy()) return;          // defer to PA while typing / on landing
          try { fn(); } catch (e) { BA.err('BAR bind action failed', e); }
          return false;                  // Mousetrap: preventDefault + stop (blocks PA)
        };
      }

      function applyBinds() {
        var keys = Object.keys(KEYMAP), n = 0;
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          try { Mousetrap.unbind(k); Mousetrap.bind(k, wrap(KEYMAP[k].run), 'keydown'); n++; }
          catch (e) { BA.err('failed to bind ' + k, e); }
        }
        BA.log('BAR binds applied (' + n + ' keys, PA blocked): ' + keys.join(' '));
      }
      applyBinds();

      try { if (typeof active_dictionary !== 'undefined' && active_dictionary && active_dictionary.subscribe) active_dictionary.subscribe(function () { applyBinds(); }); }
      catch (e) { BA.warn('could not hook active_dictionary: ' + (e && e.message)); }
      try { if (typeof input_maps_reload !== 'undefined' && input_maps_reload && input_maps_reload.progress) input_maps_reload.progress(function () { setTimeout(applyBinds, 0); }); }
      catch (e) {}
    }
  });
})();
