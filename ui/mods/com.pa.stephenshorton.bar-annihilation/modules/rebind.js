(function () {
  'use strict';
  var BA = window.BarAnnihilation; if (!BA) { return; }

  // ---------------------------------------------------------------------------
  // M8 — In-game rebind PANEL host controller (Phase 2-B).
  //
  // Paired like overlay.js <-> kb_overlay.html: this HOST module owns ALL state
  // and keyboard capture; rebind-panel.html is a dumb renderer. The panel is a
  // Coherent child <panel> VIEW (the live_game host DOM never paints body), created
  // no-keyboard (keys stay on the host so our capture-phase handler can drive the
  // rebind + suppress PA that frame) but NOT no-input (it needs clicks).
  //
  // State lives in BA.rebind (modules/rebind-config.js). This module:
  //   * ensures/shows/hides the panel (.update() to beat the ~1s hidden poll),
  //   * exposes BA.rebindToggle + registers an (unbound) ui.openRebind action,
  //   * runs a capture-phase keydown state machine
  //       hidden        -> passthrough (don't touch PA)
  //       open + idle    -> modal: swallow every key; Esc closes the panel
  //       capturing      -> resolve combo (keyCode->Mousetrap token + canonical
  //                         ctrl+alt+shift); reject digit bases; findConflict ->
  //                         conflict prompt or BA.rebind.set; Esc cancels
  //       conflict       -> Esc / Cancel returns to capturing; Overwrite steals+sets
  //       io             -> export/import textarea; Esc dismisses
  //   * pushes rebind.list / rebind.state to the panel (JSON-safe: getAll() records
  //     hold a run fn -> projected out) and handles panel->host queries.
  //
  // Child->host uses api.Panel.query(parentId, type, payload) (dispatched to the
  // shared handlers[type] via the scene's onQuery); host->child uses p.message().
  // See docs/M8-KEYBIND-PLAN.md section 5.
  // ---------------------------------------------------------------------------
  BA.register({
    name: 'rebind-panel',
    init: function () {
      var PANEL_ID = 'barann-rebind-panel';
      var SRC = 'coui://ui/mods/com.pa.stephenshorton.bar-annihilation/rebind-panel.html';

      var visible = false, el = null, pushTimer = null;
      var lastList = null, lastState = null;

      // capture state machine
      var mode = 'idle';         // 'idle' | 'capturing' | 'conflict' | 'io'
      var capId = null;          // action id being (re)bound
      var pendingKey = null;     // normalized combo awaiting conflict resolution
      var pendingOther = null;   // id currently holding pendingKey
      var captureError = null;   // transient error shown in the capture sub-panel
      var ioState = null;        // { mode:'io', io:'export'|'import', text, error }
      var capMods = { ctrl: false, alt: false, shift: false };

      // --- keyCode -> Mousetrap token (only the tokens Mousetrap itself uses) ---
      var KEYCODE_TO_TOKEN = (function () {
        var m = {
          8: 'backspace', 9: 'tab', 13: 'enter', 20: 'capslock', 27: 'esc', 32: 'space',
          33: 'pageup', 34: 'pagedown', 35: 'end', 36: 'home',
          37: 'left', 38: 'up', 39: 'right', 40: 'down', 45: 'ins', 46: 'del',
          186: ';', 187: '=', 188: ',', 189: '-', 190: '.', 191: '/', 192: '`',
          219: '[', 220: '\\', 221: ']', 222: '\''
        }, i;
        for (i = 48; i <= 57; i++) m[i] = String.fromCharCode(i);          // 0-9
        for (i = 65; i <= 90; i++) m[i] = String.fromCharCode(i + 32);     // a-z
        for (i = 112; i <= 123; i++) m[i] = 'f' + (i - 111);               // f1-f12
        return m;
      })();

      function isMod(w) { return w === 16 || w === 17 || w === 18; }
      function updCapMods(e) { capMods.ctrl = !!e.ctrlKey; capMods.alt = !!e.altKey; capMods.shift = !!e.shiftKey; }

      // --- key -> human display (mirrors kb_overlay capitalization) ------------
      var CAP = {
        tab: 'Tab', esc: 'Esc', space: 'Space', enter: 'Enter', backspace: 'Bksp',
        capslock: 'Caps', up: '↑', down: '↓', left: '←', right: '→',
        ins: 'Ins', del: 'Del', home: 'Home', end: 'End', pageup: 'PgUp', pagedown: 'PgDn'
      };
      function capToken(t) {
        if (!t) return '';
        if (CAP[t]) return CAP[t];
        if (t.length === 1) return t.toUpperCase();
        if (/^f\d+$/.test(t)) return t.toUpperCase();
        return t;
      }
      function pretty(key) {
        if (key == null || key === '') return 'Unbound';
        var parts = String(key).split('+'), out = [], i, p;
        for (i = 0; i < parts.length; i++) {
          p = parts[i];
          if (p === 'ctrl') out.push('Ctrl');
          else if (p === 'alt') out.push('Alt');
          else if (p === 'shift') out.push('Shift');
          else out.push(capToken(p));
        }
        return out.join(' + ');
      }
      function currentPreview() {
        var a = [];
        if (capMods.ctrl) a.push('Ctrl');
        if (capMods.alt) a.push('Alt');
        if (capMods.shift) a.push('Shift');
        return a.length ? a.join(' + ') + ' + …' : 'Press a key…';
      }

      // --- panel lifecycle -----------------------------------------------------
      function ensurePanel() {
        if (el && document.getElementById(PANEL_ID)) return el;
        var stale = document.getElementById(PANEL_ID);
        if (stale) { try { $(stale).remove(); } catch (e) {} }
        el = document.createElement('panel');                // MUST be <panel>, not <div>
        el.id = PANEL_ID;
        el.setAttribute('src', SRC);
        el.setAttribute('fit', 'dock');
        el.setAttribute('no-keyboard', '');                  // keys stay on host (our capture drives it)
        el.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:1600;';
        el.style.display = 'none';                            // created hidden; show() reveals + forces update
        document.body.appendChild(el);
        try { api.Panel.bindElement(el); BA.log('rebind panel bound: ' + PANEL_ID); }
        catch (e) { BA.err('rebind panel bind failed', e); }
        return el;
      }
      function forceUpdate() { var p = api.panels[PANEL_ID]; if (p && p.update) { try { p.update(); } catch (e) {} } }

      // --- push (JSON-safe) ----------------------------------------------------
      function pushList() {
        var p = api.panels[PANEL_ID];
        if (!p || p.id === undefined || p.id < 0) return;    // wait until panel.create resolved
        var all = [];
        try { all = BA.rebind.getAll(); } catch (e) { BA.warn('rebind getAll failed: ' + (e && e.message)); return; }
        var tabs = [], seen = {}, actions = [], i, r;
        for (i = 0; i < all.length; i++) {
          r = all[i]; if (!r) continue;
          if (!seen[r.category]) { seen[r.category] = true; tabs.push(r.category); }
          actions.push({                                     // drop run/event -> JSON-safe
            id: r.id, label: r.label, category: r.category, rebindable: !!r.rebindable,
            key: r.key, isOverridden: !!r.isOverridden,
            comboDisplay: r.rebindable ? pretty(r.key) : (r.displayKey || pretty(r.key)),
            defaultDisplay: pretty(r.defaultKey)
          });
        }
        var payload = { tabs: tabs, actions: actions };
        var s = JSON.stringify(payload);
        if (s === lastList) return;                           // dedupe -> no flicker
        lastList = s;
        try { p.message('rebind.list', payload); } catch (e) { BA.warn('rebind list push failed: ' + (e && e.message)); }
      }
      function pushState() {
        var p = api.panels[PANEL_ID];
        if (!p || p.id === undefined || p.id < 0) return;
        var st;
        if (mode === 'capturing') {
          var r = capId ? BA.rebind.get(capId) : null;
          st = { mode: 'capturing', id: capId, label: r ? r.label : '', preview: currentPreview(), error: captureError || null };
        } else if (mode === 'conflict') {
          var r2 = capId ? BA.rebind.get(capId) : null, o = pendingOther ? BA.rebind.get(pendingOther) : null;
          st = { mode: 'conflict', id: capId, label: r2 ? r2.label : '', key: pendingKey, keyDisplay: pretty(pendingKey), other: pendingOther, otherLabel: o ? o.label : pendingOther };
        } else if (mode === 'io' && ioState) {
          st = ioState;
        } else {
          st = { mode: 'idle' };
        }
        var s = JSON.stringify(st);
        if (s === lastState) return;
        lastState = s;
        try { p.message('rebind.state', st); } catch (e) { BA.warn('rebind state push failed: ' + (e && e.message)); }
      }

      function show() {
        ensurePanel();
        if (el) el.style.display = '';
        visible = true;
        mode = 'idle'; capId = null; pendingKey = null; pendingOther = null; captureError = null; ioState = null;
        capMods.ctrl = capMods.alt = capMods.shift = false;
        lastList = null; lastState = null;                    // force a fresh push
        forceUpdate();                                        // beat the ~1s hidden-panel poll
        pushList(); pushState();
        if (pushTimer) clearInterval(pushTimer);
        pushTimer = setInterval(function () { if (visible) { pushList(); pushState(); } else { clearInterval(pushTimer); pushTimer = null; } }, 300);
        BA.log('rebind -> shown (panel view)');
      }
      function hide() {
        visible = false; mode = 'idle'; capId = null; pendingKey = null; pendingOther = null; captureError = null; ioState = null;
        if (el) el.style.display = 'none';
        if (pushTimer) { clearInterval(pushTimer); pushTimer = null; }
        BA.log('rebind -> hidden');
      }

      var toggleLock = false;
      function toggle() {
        if (toggleLock) return;                              // collapse double-dispatch
        toggleLock = true; setTimeout(function () { toggleLock = false; }, 0);
        if (visible) hide();
        else { if (BA.overlayHide) { try { BA.overlayHide(); } catch (e) {} } show(); }
      }
      BA.rebindToggle = toggle;

      // --- capture-phase key handling (the crux) -------------------------------
      function consume(e) { e.preventDefault(); e.stopImmediatePropagation(); }
      function toIdle() {
        mode = 'idle'; capId = null; pendingKey = null; pendingOther = null; captureError = null; ioState = null;
        capMods.ctrl = capMods.alt = capMods.shift = false;
        lastState = null; pushState();
      }
      function startCapture(id) {
        var rec = null; try { rec = BA.rebind.get(id); } catch (e) {}
        if (!rec || !rec.rebindable) return;
        mode = 'capturing'; capId = id; pendingKey = null; pendingOther = null; captureError = null;
        capMods.ctrl = capMods.alt = capMods.shift = false;
        lastState = null; pushState();
      }
      function applyCapture(e) {
        updCapMods(e);
        var w = e.which, base = KEYCODE_TO_TOKEN[w];
        if (!base) { captureError = 'Unsupported key'; lastState = null; pushState(); return; }
        if (/^[0-9]$/.test(base)) { captureError = 'Digits 1–0 are reserved (control groups)'; lastState = null; pushState(); return; }
        var combo = '';
        if (e.ctrlKey) combo += 'ctrl+';
        if (e.altKey) combo += 'alt+';
        if (e.shiftKey) combo += 'shift+';
        combo += base;
        var norm = BA.rebind.normalizeKey(combo);
        if (norm == null) { captureError = 'Unrecognized key'; lastState = null; pushState(); return; }
        if (BA.rebind.isReserved(norm)) { captureError = 'That key is reserved'; lastState = null; pushState(); return; }
        var other = BA.rebind.findConflict(norm, capId);
        if (other) { mode = 'conflict'; pendingKey = norm; pendingOther = other; captureError = null; lastState = null; pushState(); return; }
        var res = BA.rebind.set(capId, norm);
        if (res && res.ok) toIdle();
        else if (res && res.conflict) { mode = 'conflict'; pendingKey = norm; pendingOther = res.conflict; captureError = null; lastState = null; pushState(); }
        else { captureError = 'Could not set (' + ((res && res.reason) || 'error') + ')'; lastState = null; pushState(); }
      }
      function onKeyDownCap(e) {
        if (!visible) return;                                // hidden -> passthrough (don't touch PA)
        if (mode === 'capturing') {
          var w = e.which;
          if (w === 27) { toIdle(); consume(e); return false; }          // Esc cancels
          if (isMod(w)) { updCapMods(e); captureError = null; lastState = null; pushState(); consume(e); return false; }  // preview
          applyCapture(e);
          consume(e); return false;                          // always swallow while capturing
        }
        if (mode === 'conflict') {
          if (e.which === 27) cancelConflict();              // back to capturing
          consume(e); return false;
        }
        if (mode === 'io') {
          if (e.which === 27) toIdle();                      // dismiss export/import
          consume(e); return false;
        }
        // idle (open): modal — swallow every key; Esc closes the panel
        if (e.which === 27) hide();
        consume(e); return false;
      }
      function onKeyUpCap(e) {
        if (!visible) return;
        if (mode === 'capturing' && isMod(e.which)) { updCapMods(e); lastState = null; pushState(); }
        consume(e); return false;                            // modal: swallow keyups while visible
      }
      document.addEventListener('keydown', onKeyDownCap, true);
      document.addEventListener('keyup', onKeyUpCap, true);

      // --- conflict / io actions ----------------------------------------------
      function confirmConflict() {
        if (mode !== 'conflict' || !capId || pendingKey == null) return;
        var res = BA.rebind.set(capId, pendingKey, { allowConflict: true });
        if (res && res.ok) toIdle();
        else { captureError = 'Could not set (' + ((res && res.reason) || 'error') + ')'; mode = 'capturing'; pendingKey = null; pendingOther = null; lastState = null; pushState(); }
      }
      function cancelConflict() {                            // return to capturing (pick another key)
        if (mode !== 'conflict') return;
        pendingKey = null; pendingOther = null; captureError = null; mode = 'capturing'; lastState = null; pushState();
      }
      function openIO(kind, text, error) {
        mode = 'io'; capId = null;
        ioState = { mode: 'io', io: kind, text: (text != null ? text : ''), error: error || null };
        lastState = null; pushState();
      }
      function doExport() {
        var json; try { json = BA.rebind.export(); } catch (e) { json = '{}'; }
        openIO('export', json, null);
      }
      function doImport(p) {
        if (!p || typeof p.json !== 'string') { openIO('import', ''); return; }   // footer Import -> open the paste box
        var res; try { res = BA.rebind.import(p.json); } catch (e) { res = { ok: false, reason: 'error' }; }
        if (res && res.ok) {
          mode = 'idle'; ioState = null; lastState = null; pushState(); pushList();
          BA.log('rebind import: applied ' + res.applied + ', skipped ' + (res.skipped ? res.skipped.length : 0));
        } else {
          openIO('import', p.json, 'Import failed' + (res && res.reason ? ' (' + res.reason + ')' : ''));
        }
      }

      // re-push list after any registry change (set/reset/import) while visible
      try { BA.rebind.onChange(function () { if (visible) pushList(); }); }
      catch (e) { BA.warn('rebind: onChange subscribe failed: ' + (e && e.message)); }

      // --- panel -> host handlers (shared scene handlers map) -------------------
      var H = (typeof handlers !== 'undefined' && handlers) ? handlers : (window.handlers || null);
      if (H) {
        H['rebind.start'] = function (p) { if (p && p.id) startCapture(p.id); };
        H['rebind.reset'] = function (p) { if (p && p.id) { BA.rebind.resetOne(p.id); pushList(); } };
        H['rebind.resetAll'] = function () { BA.rebind.resetAll(); pushList(); };
        H['rebind.confirm'] = function () { confirmConflict(); };
        H['rebind.cancelConflict'] = function () { cancelConflict(); };
        H['rebind.cancelCapture'] = function () { toIdle(); };           // also dismisses the io box
        H['rebind.export'] = function () { doExport(); };
        H['rebind.import'] = function (p) { doImport(p); };
        H['rebind.close'] = function () { hide(); };
        // Handoff from the kb_overlay footer button: hide the overlay first so
        // exactly one capture handler is active, then show the rebind panel.
        H['overlay:rebind'] = function () { if (BA.overlayHide) { try { BA.overlayHide(); } catch (e) {} } show(); };
      } else BA.warn('rebind: no handlers map — panel clicks will not route');

      // Register an (UNBOUND by default) action so the user can assign a direct
      // hotkey from within the panel; the entry point is the overlay footer button.
      // run is guarded (defers while typing / on landing); selection-binds' applyBinds
      // binds it via Mousetrap once the user gives it a key (onChange -> re-apply).
      try {
        BA.rebind.register('ui.openRebind', {
          label: 'Open rebind panel', category: 'UI', defaultKey: '',
          run: function () { if (BA.util && BA.util.uiBusy && BA.util.uiBusy()) return; toggle(); }
        });
      } catch (e) { BA.warn('rebind: register ui.openRebind failed: ' + (e && e.message)); }

      ensurePanel();   // pre-create hidden so the first open is instant
      BA.log('rebind panel ready (M8) — open via the kb_overlay "Rebind Keys" button or a bound ui.openRebind');
    }
  });
})();
