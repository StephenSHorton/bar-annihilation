// BAR Annihilation — live_game scene entry point
// ---------------------------------------------------------------------------
// Injected into Planetary Annihilation: TITANS' `live_game` UI scene as a
// CLIENT mod (local-only; no server sync, safe in any online game).
//
// Loaded after the scene's own JS (live_game.js:4916), so scene globals
// `model`, `api`, `handlers`, `ko`, `engine`, `Mousetrap`, `active_dictionary`
// and jQuery `$` are available.
//
// NOTE: PA's log captures only the FIRST console.log argument, so all messages
// here are single concatenated strings (see log()/warn()/err()).
//
// Spec : docs/BAR-Control-Scheme-Catalog.md   API : docs/API-MAP.md   Plan : docs/ROADMAP.md
// ---------------------------------------------------------------------------

(function () {
  'use strict';

  var VERSION = '0.0.1';
  var TAG = '[bar-annihilation]';

  function log(msg)  { console.log(TAG + ' ' + msg); }
  function warn(msg) { console.warn(TAG + ' ' + msg); }
  function err(msg, e) { console.error(TAG + ' ' + msg + ' :: ' + (e && e.message ? e.message : e)); }

  if (window.BarAnnihilation) { log('already initialized; skipping duplicate entry'); return; }

  var modules = [], startTimer = null;
  function start() {
    startTimer = null;
    var ready = 0, total = 0;
    for (var i = 0; i < modules.length; i++) {
      var mod = modules[i];
      if (mod.enabled === false || mod._inited) continue;
      total++;
      try { mod.init({ tag: TAG, log: log, warn: warn, err: err }); mod._inited = true; ready++; log('module ready: ' + mod.name); }
      catch (e) { err('module failed: ' + mod.name, e); }
    }
    if (total > 0) log('started ' + ready + '/' + total + ' new module(s)');
  }
  var BarAnnihilation = {
    version: VERSION, log: log, warn: warn, err: err,
    binds: {}, // key-string -> human label, published by feature modules (read by the overlay)
    register: function (mod) { modules.push(mod); if (startTimer) clearTimeout(startTimer); startTimer = setTimeout(start, 0); }
  };
  window.BarAnnihilation = BarAnnihilation;
  log('loaded v' + VERSION + ' into live_game');

  // -------------------------------------------------------------------------
  // Shared helpers
  // -------------------------------------------------------------------------
  function uiBusy() {
    try {
      if (typeof model === 'undefined') return true;
      if (model.chatSelected && model.chatSelected()) return true;
      if (model.showLanding && model.showLanding()) return true;
    } catch (e) {}
    return false;
  }

  function readSelection() {
    if (typeof model === 'undefined' || !model.selection) return null;
    var sel = (typeof model.selection === 'function') ? model.selection() : model.selection;
    if (!sel || !sel.spec_ids) return { raw: sel, types: 0, units: 0, ids: [] };
    var ids = [], types = 0;
    for (var k in sel.spec_ids) {
      if (!sel.spec_ids.hasOwnProperty(k)) continue;
      types++;
      var arr = sel.spec_ids[k];
      if (arr && arr.length) ids = ids.concat(arr);
    }
    return { raw: sel, types: types, units: ids.length, ids: ids };
  }

  BarAnnihilation.util = { uiBusy: uiBusy, readSelection: readSelection };

  // -------------------------------------------------------------------------
  // Reusable drag manager (BarAnnihilation.drag)
  // -------------------------------------------------------------------------
  // Lets any mod panel be repositioned by dragging, with the chosen spot
  // remembered across sessions (localStorage). A small panel can't follow the
  // cursor once it leaves its own rect, so during a drag we reveal a fullscreen,
  // normally-hidden "drag layer" panel that reports mousemove/up in SCREEN
  // coordinates back here; we move the dragged panel to follow. Opt in with
  //   BA.drag.makeDraggable(panelId, storageKey)
  // and have the panel's child escalate a press-and-move into a 'drag:start'
  // query { panel, gx, gy } (gx/gy = grab offset within the panel). See
  // keys_button.html for the child side.
  var DRAG_LAYER_ID  = 'barann-draglayer-panel';
  var DRAG_LAYER_SRC = 'coui://ui/mods/com.pa.stephenshorton.bar-annihilation/drag_layer.html';
  var dragLayerEl = null, dragReg = {}, dragActive = null, dragInited = false, dragWatch = null;

  function dragPosGet(key) { try { var s = window.localStorage && localStorage.getItem('barann.pos.' + key); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function dragPosSet(key, v) { try { if (window.localStorage) localStorage.setItem('barann.pos.' + key, JSON.stringify(v)); } catch (e) {} }
  function dragPosClear(key) { try { if (window.localStorage) localStorage.removeItem('barann.pos.' + key); } catch (e) {} }
  function dragPanelUpdate(id) { try { var p = api.panels[id]; if (p && p.update) p.update(); } catch (e) {} }

  function dragEnsureLayer() {
    if (dragLayerEl && document.getElementById(DRAG_LAYER_ID)) return;
    var stale = document.getElementById(DRAG_LAYER_ID); if (stale) { try { $(stale).remove(); } catch (e) {} }
    dragLayerEl = document.createElement('panel');
    dragLayerEl.id = DRAG_LAYER_ID;
    dragLayerEl.setAttribute('src', DRAG_LAYER_SRC);
    dragLayerEl.setAttribute('no-keyboard', '');
    dragLayerEl.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:5000;display:none;';
    document.body.appendChild(dragLayerEl);
    try { api.Panel.bindElement(dragLayerEl); log('drag layer bound'); } catch (e) { err('drag layer bind failed', e); }
  }
  function dragShowLayer(on) { if (dragLayerEl) { dragLayerEl.style.display = on ? '' : 'none'; dragPanelUpdate(DRAG_LAYER_ID); } }
  function dragClamp(el, L, T) {
    var w = el.offsetWidth || 0, h = el.offsetHeight || 0;
    var sw = window.innerWidth || 1920, sh = window.innerHeight || 1080;
    if (L < 0) L = 0; else if (L > sw - w) L = sw - w;
    if (T < 0) T = 0; else if (T > sh - h) T = sh - h;
    return { L: L, T: T };
  }
  function dragArm() { if (dragWatch) clearTimeout(dragWatch); dragWatch = setTimeout(function () { warn('drag watchdog fired — force-ending stuck drag'); onDragEnd(); }, 12000); }

  function onDragStart(p) {                 // from a draggable child: { panel, gx, gy }
    if (!p || !p.panel) return;
    var el = document.getElementById(p.panel); if (!el) return;
    var r = el.getBoundingClientRect();
    el.style.right = 'auto'; el.style.bottom = 'auto';
    el.style.left = Math.round(r.left) + 'px'; el.style.top = Math.round(r.top) + 'px';   // pin to left/top so we can move freely
    dragActive = { id: p.panel, gx: p.gx || 0, gy: p.gy || 0, key: dragReg[p.panel] && dragReg[p.panel].key };
    dragShowLayer(true); dragArm();
  }
  function onDragMove(p) {                   // from the drag layer: { x, y } screen coords
    if (!dragActive || !p) return;
    var el = document.getElementById(dragActive.id); if (!el) return;
    var c = dragClamp(el, p.x - dragActive.gx, p.y - dragActive.gy);
    el.style.left = c.L + 'px'; el.style.top = c.T + 'px';
    dragArm();
  }
  function onDragEnd() {
    if (dragWatch) { clearTimeout(dragWatch); dragWatch = null; }
    if (!dragActive) return;                 // a backup drag:end from the panel's own child is a no-op
    var el = document.getElementById(dragActive.id);
    if (el && dragActive.key) dragPosSet(dragActive.key, { left: parseInt(el.style.left, 10) || 0, top: parseInt(el.style.top, 10) || 0 });
    dragShowLayer(false); dragActive = null;
  }

  function dragInit() {
    if (dragInited) return; dragInited = true;
    dragEnsureLayer();
    var H = (typeof handlers !== 'undefined' && handlers) ? handlers : (window.handlers || null);
    if (H) { H['drag:start'] = onDragStart; H['drag:move'] = onDragMove; H['drag:end'] = onDragEnd; }
  }
  function makeDraggable(panelId, storageKey) {
    dragInit();
    dragReg[panelId] = { key: storageKey };
    var pos = dragPosGet(storageKey);
    if (pos) {
      var el = document.getElementById(panelId);
      if (el) { el.style.right = 'auto'; el.style.bottom = 'auto'; el.style.left = (pos.left || 0) + 'px'; el.style.top = (pos.top || 0) + 'px'; }
    }
    return { reset: function () { dragPosClear(storageKey); } };
  }
  BarAnnihilation.drag = { makeDraggable: makeDraggable, _init: dragInit, _resetAll: function () { for (var id in dragReg) if (dragReg.hasOwnProperty(id)) dragPosClear(dragReg[id].key); } };
})();
