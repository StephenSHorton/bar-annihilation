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

      // ---- M7 unit order-states: BAR move / fire / wait ------------------
      // BAR grid sets an ABSOLUTE state by TAP COUNT (not a cycle): 1/2/3 taps.
      // PA's order-states live in the action_bar PANEL — `set_order_state` ONLY
      // works from that view; calling engine.call from live_game logs success
      // but is a SILENT no-op. So drive them exactly as PA's own keybinds do
      // (live_game.js:1477-1519): message the action_bar panel.
      //   selection_order <Name> -> absolute set (model.selection<Name>())
      //   toggle_order    <Name> -> cycle        (model.toggle<Name>OrderIndex())
      // PA states (live_game_action_bar.js): move=Maneuver/Roam/HoldPosition,
      // fire=FireAtWill/ReturnFire/HoldFire, energy=Consume/Conserve(hold).
      var TAP_MS = 300;   // tap-chain window (~Spring KeyChainTimeout); tunable

      function sendActionBar(msg, name, label) {
        var sel = BA.util.readSelection();
        if (!sel || !sel.units) { BA.log('BAR: ' + label + ' -- nothing selected'); return; }
        try {
          if (api && api.panels && api.panels.action_bar && api.panels.action_bar.message) {
            api.panels.action_bar.message(msg, name);
            BA.log('BAR: ' + label + ' -> ' + name + ' (' + sel.units + ' unit(s))');
          } else { BA.warn('action_bar panel unavailable (' + label + ')'); }
        } catch (e) { BA.err(msg + ' ' + name + ' failed', e); }
      }

      // Faithful multi-tap: count taps within TAP_MS, then apply the absolute
      // selection_order for that count (clamped to the highest defined tap).
      function multiTapOrder(byTap, baseLabel) {
        var taps = 0, timer = null, maxTap = 0;
        for (var k in byTap) { if (byTap.hasOwnProperty(k)) maxTap = Math.max(maxTap, +k); }
        return function () {
          taps++;
          if (timer) clearTimeout(timer);
          timer = setTimeout(function () {
            var n = Math.min(taps, maxTap); taps = 0; timer = null;
            sendActionBar('selection_order', byTap[n], baseLabel + ' ' + n + '-tap');
          }, TAP_MS);
        };
      }

      // ---- Command modes: BAR command keys -> PA command-mode arm ---------
      // BAR command keys ARM a command cursor on the current selection; you then
      // click a target (entity = the command, ground = the move/area variant) —
      // exactly BAR's arm-then-click. model.setCommandIndex(N) is the live_game
      // model's OWN command-mode entry (live_game.js:1457), callable from this
      // scene; it SELF-GATES on model.allowedCommands (no-op if the selection
      // can't do it, e.g. 'a' on a fabber). EXCEPT stop(-1), which issues
      // immediately (no click). Indices double-verified vs self.commands[]
      // (live_game.js:1361) AND PA's own command_mode_* keybinds (inputmap.js).
      // Build-menu collision is handled by gridmenu's capture-phase consume:
      // a build SUBMENU eats these keys first; HOME leaves the top row free;
      // closed = commands fire.
      function cmdMode(index, label) {
        return function () {
          try {
            if (typeof model === 'undefined' || !model || !model.setCommandIndex) { BA.warn('setCommandIndex unavailable (' + label + ')'); return; }
            model.setCommandIndex(index);
            BA.log('BAR: ' + label + ' (cmd ' + index + ')');
          } catch (e) { BA.err('command mode ' + label + ' failed', e); }
        };
      }

      // BAR Ctrl+B = self-destruct. PA's native path (Delete) pops a confirm modal;
      // BAR explodes on a countdown. Per user: explode the selection IMMEDIATELY, no
      // confirm. api.unit.selfDestruct() -> engine.call('unit.selfDestruct') (global
      // api, callable from live_game, acts on the current selection).
      function selfDestruct() {
        var sel = BA.util.readSelection();
        if (!sel || !sel.units) { BA.log('BAR: self-destruct -- nothing selected'); return; }
        try {
          if (api && api.unit && api.unit.selfDestruct) { api.unit.selfDestruct(); BA.log('BAR: self-destruct (' + sel.units + ' unit(s))'); }
          else BA.warn('api.unit.selfDestruct unavailable');
        } catch (e) { BA.err('self-destruct failed', e); }
      }

      // ---- Register every action into the BA.rebind registry (M8) ------------
      // Decoupled from the key: the registry owns id->key mapping + persisted
      // overrides; we bind via applyBinds() and re-bind on onChange(). The default
      // keys here are VERBATIM from the old KEYMAP. ONLY bind what BAR's own configs
      // bind — the engine (BA.select.run) supports the full `select` DSL, but bound
      // KEYS mirror BAR's defaults (no invented binds). Rows: [id, defaultKey,
      // category, label, run].
      var REG = [
        // Selection
        ['select.commander',      'tab',      'Selection', 'Select commander',              function () { selectThenFocusOnRepeat(function () { api.select.commander(); }, 'select commander'); }],
        ['select.idleBuilder',    'ctrl+tab', 'Selection', 'Select idle builder',           selectIdleBuilderCycle],
        ['select.split50',        'ctrl+q',   'Selection', 'Split selection 50%',           split50],
        ['select.allUnits',       'ctrl+e',   'Selection', 'Select all units',              selectAllUnits],
        ['select.sameTypeScreen', 'q',        'Selection', 'Select same type (on screen)',  selectSameTypeOnScreen],
        ['select.sameTypeMap',    'ctrl+w',   'Selection', 'Select same type (map-wide)',   selectSameTypeMapWide],
        // Order-states (M7 multi-tap absolute set / toggle)
        ['order.move',   ';', 'Order states', 'Move state (tap 1/2/3 = roam/hold/maneuver)', multiTapOrder({ 1: 'Roam', 2: 'HoldPosition', 3: 'Maneuver' }, 'move state')],
        ['order.fire',   'l', 'Order states', 'Fire state (tap 1/2/3 = free/hold/return)',   multiTapOrder({ 1: 'FireAtWill', 2: 'HoldFire', 3: 'ReturnFire' }, 'fire state')],
        ['order.energy', 'y', 'Order states', 'Wait / energy hold (toggle)',                 function () { sendActionBar('toggle_order', 'Energy', 'wait/hold'); }],
        // T = BAR "repeat". PA's only repeat is a factory's continuous build-stance
        // (buildStanceOrders ['normal','continuous'], gated canBuild && !mobile), so this
        // faithfully toggles factory repeat and no-ops on mobile units (PA has no mobile
        // queue-repeat). Same action_bar path as the Y/energy toggle.
        ['order.repeat', 't', 'Order states', 'Repeat (factory build stance)',               function () { sendActionBar('toggle_order', 'BuildStance', 'repeat / build stance'); }],
        // Commands (BAR no-mod command row) — arm a PA command cursor, then click a target.
        ['cmd.attack',       'a',      'Commands', 'Attack',                  cmdMode(1, 'attack')],
        ['cmd.reclaim',      'e',      'Commands', 'Reclaim',                 cmdMode(4, 'reclaim')],
        ['cmd.repair',       'r',      'Commands', 'Repair',                  cmdMode(3, 'repair')],
        ['cmd.fight',        'f',      'Commands', 'Fight (attack-move)',     cmdMode(1, 'fight (attack-move)')],
        ['cmd.stop',         'g',      'Commands', 'Stop',                    cmdMode(-1, 'stop')],
        ['cmd.patrol',       'h',      'Commands', 'Patrol',                  cmdMode(5, 'patrol')],
        ['cmd.load',         'j',      'Commands', 'Load',                    cmdMode(10, 'load')],
        ['cmd.unload',       'u',      'Commands', 'Unload',                  cmdMode(9, 'unload')],
        ['cmd.guard',        'o',      'Commands', 'Guard (assist)',          cmdMode(2, 'guard/assist')],
        ['cmd.dgun',         'd',      'Commands', 'D-Gun / manual fire',     cmdMode(12, 'd-gun')],
        ['cmd.factoryGuard', 'ctrl+g', 'Commands', 'Factory guard (assist)',  cmdMode(2, 'factory guard')],
        ['unit.selfDestruct','ctrl+b', 'Commands', 'Self-destruct (instant)', selfDestruct],
        // UI
        ['ui.overlay',     '\\',           'UI', 'Toggle key overlay',    function () { if (BA.overlayToggle) BA.overlayToggle(); else BA.warn('overlay toggle not ready yet'); }],
        ['ui.reloadScene', 'ctrl+shift+r', 'UI', 'Reload UI scene (dev)',  function () { try { BA.log('reloading live_game scene...'); api.game.debug.reloadScene(api.Panel.pageId); } catch (e) { BA.err('scene reload failed', e); } }]
      ];
      // NOTE: ui.openRebind is intentionally NOT registered here — the rebind panel
      // module owns it (unbound by default; user assigns it from the panel).
      if (BA.rebind && BA.rebind.register) {
        for (var ri = 0; ri < REG.length; ri++) {
          BA.rebind.register(REG[ri][0], { defaultKey: REG[ri][1], category: REG[ri][2], label: REG[ri][3], run: REG[ri][4] });
        }
      } else { BA.warn('BA.rebind unavailable — keybinds will not apply (registry missing)'); }

      function wrap(fn) {
        return function () {
          if (BA.util.uiBusy()) return;          // defer to PA while typing / on landing
          try { fn(); } catch (e) { BA.err('BAR bind action failed', e); }
          return false;                  // Mousetrap: preventDefault + stop (blocks PA)
        };
      }

      // Rebuild BA.binds (key -> label) for the keyboard overlay from the LIVE keys
      // of rebindable, bound actions only (display-only capture gestures are owned by
      // the other modules and are not single Mousetrap keys). Reassigns a fresh map so
      // stale keys never linger; the overlay reads BA.binds afresh each render.
      function syncBABinds() {
        var next = {}, all = (BA.rebind && BA.rebind.getAll) ? BA.rebind.getAll() : [];
        for (var i = 0; i < all.length; i++) {
          var r = all[i];
          if (!r.rebindable || !r.run || !r.key) continue;
          next[r.key] = r.label;
        }
        BA.binds = next;
      }

      // Registry-driven bind pass. Track _boundKeys and unbind them first so a rebind
      // releases the STALE key (keys change at runtime now — critical). Total override:
      // Mousetrap.unbind+bind per action, wrap() returns false so PA's own action for
      // that key is fully blocked. Digits 1-0 are never bindable (registry isReserved).
      // _boundKeys stores {key, event} pairs: Mousetrap.unbind MUST be given the same
      // event type used to bind, or it targets the wrong action. A plain single-char key
      // (e.g. 'z') binds under 'keydown' here, but unbind() with no action defaults to
      // 'keypress' for such keys -> the keydown binding leaks and the old key keeps firing
      // after a rebind. Passing the event fixes that.
      var _boundKeys = [];
      var _swallow = wrap(function () {});    // blocks PA + does nothing (for keys we own but that are unbound)
      function applyBinds() {
        for (var u = 0; u < _boundKeys.length; u++) { try { Mousetrap.unbind(_boundKeys[u].key, _boundKeys[u].event); } catch (e) {} }
        _boundKeys = [];
        var all = (BA.rebind && BA.rebind.getAll) ? BA.rebind.getAll() : [], n = 0, keys = [], live = {}, claimed = {};
        for (var i = 0; i < all.length; i++) {
          var r = all[i];
          // The mod owns its default-key scheme: every default is "claimed" so that when
          // an action is moved off (or unbound from) its default, that key is SWALLOWED
          // below rather than falling through to PA's native action for it.
          if (r.rebindable && r.defaultKey) claimed[r.defaultKey] = true;
          if (!r.rebindable || !r.run || !r.key) continue;      // skip display-only + unbound
          var ev = r.event || 'keydown';
          try {
            Mousetrap.unbind(r.key, ev);
            Mousetrap.bind(r.key, wrap(r.run), ev);
            _boundKeys.push({ key: r.key, event: ev }); keys.push(r.key); claimed[r.key] = true; live[r.key] = true; n++;
          } catch (e) { BA.err('failed to bind ' + r.key, e); }
        }
        // A claimed key that no action currently occupies gets a no-op that blocks PA,
        // so an unbound key does NOTHING (BAR-faithful) instead of resurfacing PA's
        // native binding. Bound under keydown (matches how we bind everything else).
        var sw = 0;
        for (var ck in claimed) {
          if (live[ck]) continue;
          try { Mousetrap.unbind(ck, 'keydown'); Mousetrap.bind(ck, _swallow, 'keydown'); _boundKeys.push({ key: ck, event: 'keydown' }); sw++; }
          catch (e) {}
        }
        syncBABinds();                       // keep the overlay's key->label current
        BA.log('BAR binds applied (' + n + ' keys + ' + sw + ' swallowed, PA blocked): ' + keys.join(' '));
      }
      applyBinds();

      // Live re-apply when a bind is changed/reset (the rebind panel calls
      // BA.rebind.set/reset -> onChange). pushBarKeybinds is hoisted (declared below).
      try { if (BA.rebind && BA.rebind.onChange) BA.rebind.onChange(function () { applyBinds(); pushBarKeybinds(); }); } catch (e) {}

      try { if (typeof active_dictionary !== 'undefined' && active_dictionary && active_dictionary.subscribe) active_dictionary.subscribe(function () { applyBinds(); }); }
      catch (e) { BA.warn('could not hook active_dictionary: ' + (e && e.message)); }
      try { if (typeof input_maps_reload !== 'undefined' && input_maps_reload && input_maps_reload.progress) input_maps_reload.progress(function () { setTimeout(applyBinds, 0); }); }
      catch (e) {}

      // ---- Native command/orders bar: show BAR keys, not PA's defaults -----
      // PA's action_bar renders model.actionKeybinds() labels (live_game.js:2852+):
      //   commands[] = [move, attack, altFire, assist, repair, reclaim, patrol,
      //                 use, specialMove, unload, load, ping, stop]
      //   orders[]   = [fire, move, energy, build]
      // Our Mousetrap override changes the ACTUAL keys but NOT PA's labels, so the
      // command/orders bar reads stale. Re-push a corrected payload (BAR keys for the
      // indices we rebound) to the action_bar via PA's own channel (live_game.js:2896).
      // Indices we didn't rebind keep PA's own labels. NOTE: these are DISPLAY-array
      // indices (the keybindsForCommandModes list order), NOT setCommandIndex values.
      // actionId -> display slot [arrayName, index]. Badges are computed from each
      // action's LIVE key, so the native bar tracks rebinds; at default keys keyBadge()
      // reproduces today's badges byte-for-byte: commands A D O R E H U J G / orders L ; Y T.
      var BAR_SLOTS = {
        'cmd.attack':  ['commands', 1],
        'cmd.dgun':    ['commands', 2],
        'cmd.guard':   ['commands', 3],
        'cmd.repair':  ['commands', 4],
        'cmd.reclaim': ['commands', 5],
        'cmd.patrol':  ['commands', 6],
        'cmd.unload':  ['commands', 9],
        'cmd.load':    ['commands', 10],
        'cmd.stop':    ['commands', 12],
        'order.fire':   ['orders', 0],
        'order.move':   ['orders', 1],   // orders [fire,move,energy,build-stance]
        'order.energy': ['orders', 2],
        'order.repeat': ['orders', 3]
      };
      // key-string -> a short action-bar badge: uppercase a single base char, keep
      // symbols (';' '\') and multi-char tokens (tab/esc) as-is, prefix modifiers.
      function keyBadge(key) {
        if (!key) return '';
        var seg = String(key).split('+'), b = seg.pop(), pre = '';
        for (var i = 0; i < seg.length; i++) {
          var m = seg[i];
          pre += (m === 'ctrl') ? 'Ctrl+' : (m === 'alt') ? 'Alt+' : (m === 'shift') ? 'Shift+' : (m + '+');
        }
        return pre + ((b.length === 1) ? b.toUpperCase() : b);
      }
      function pushBarKeybinds() {
        try {
          if (!api.panels || !api.panels.action_bar || !api.panels.action_bar.message) return;
          if (typeof model === 'undefined' || !model || !model.actionKeybinds) return;
          var base = model.actionKeybinds() || {};
          var commands = (base.commands || []).slice(), orders = (base.orders || []).slice();
          for (var id in BAR_SLOTS) {
            if (!BAR_SLOTS.hasOwnProperty(id)) continue;
            var key = (BA.rebind && BA.rebind.keyOf) ? BA.rebind.keyOf(id) : '';
            if (!key) continue;                          // unbound -> keep PA's own label
            var slot = BAR_SLOTS[id], badge = keyBadge(key);
            if (slot[0] === 'commands') commands[slot[1]] = badge; else orders[slot[1]] = badge;
          }
          api.panels.action_bar.message('keybinds', { commands: commands, orders: orders });
        } catch (e) { BA.err('pushBarKeybinds failed', e); }
      }
      pushBarKeybinds();
      setTimeout(pushBarKeybinds, 600);    // after the action_bar has queried PA's defaults
      setTimeout(pushBarKeybinds, 2000);
      try { if (model && model.actionKeybinds && model.actionKeybinds.subscribe) model.actionKeybinds.subscribe(function () { setTimeout(pushBarKeybinds, 0); }); } catch (e) {}
      try { if (model && model.selection && model.selection.subscribe) model.selection.subscribe(function () { setTimeout(pushBarKeybinds, 0); }); } catch (e) {}
    }
  });
})();
