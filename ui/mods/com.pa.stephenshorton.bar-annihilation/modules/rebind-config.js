// BAR Annihilation — BA.rebind: the keybind registry (M8, Option B)
// ---------------------------------------------------------------------------
// A plain top-level IIFE (NOT a BA.register module) so window.BarAnnihilation.rebind
// exists — with persisted overrides pre-loaded from localStorage — BEFORE any
// module init() runs. Loaded right after core.js (see modinfo scenes.live_game).
//
// The registry is PURE STATE + NOTIFICATION. It never touches Mousetrap: feature
// modules register their actions here, selection-binds.js owns binding and
// subscribes onChange() to re-apply. See docs/M8-KEYBIND-PLAN.md.
//
// Record (register(id, spec)):
//   { defaultKey, label, category, run, rebindable=true, event='keydown',
//     displayKey?, order? }   // display-only rows: {rebindable:false,label,category,displayKey}
// Persisted (localStorage 'barann.binds'): { v, overrides:{ id: key } }  DELTAS ONLY.
//   key === '' means intentionally UNBOUND. Missing id === default.
// ---------------------------------------------------------------------------
(function () {
  'use strict';
  var BA = window.BarAnnihilation; if (!BA) { return; }
  if (BA.rebind) { return; }                 // idempotent across hot-reload

  var SCHEMA_V = 1;
  var LS_KEY = 'barann.binds';

  var _records = {};     // id -> record (holds run fn)
  var _order = [];       // ids in registration order (stable getAll order)
  var _overrides = {};   // id -> key ('' = unbound); DELTAS ONLY
  var _unknown = {};     // persisted ids not (yet) registered — retained for fwd-compat
  var _listeners = [];

  function log(m) { if (BA.log) BA.log('REBIND ' + m); }

  // --- key normalization (mirrors overlay.js parseKeyStr so overlay + panel agree) ---
  // lowercase; canonical modifier order ctrl,alt,shift; one non-modifier base token.
  function normalizeKey(str) {
    if (str == null) return null;
    var s = String(str).toLowerCase().trim();
    if (s === '') return '';                              // explicit unbind
    var parts = s.split('+'), mods = { ctrl: false, alt: false, shift: false }, base = null, i, p;
    for (i = 0; i < parts.length; i++) {
      p = parts[i].trim(); if (!p) continue;
      if (p === 'ctrl' || p === 'control') mods.ctrl = true;
      else if (p === 'alt' || p === 'option') mods.alt = true;
      else if (p === 'shift') mods.shift = true;
      else if (p === 'cmd' || p === 'meta' || p === 'mod' || p === 'super' || p === 'win') { /* drop */ }
      else base = p;                                      // last non-modifier wins
    }
    if (!base) return null;
    var out = '';
    if (mods.ctrl) out += 'ctrl+';
    if (mods.alt) out += 'alt+';
    if (mods.shift) out += 'shift+';
    return out + base;
  }

  // digit base (bare or any-modifier) is refused: never bind 1-0 (clobbers PA's
  // native doubleTap control-group recall/center).
  function isReserved(key) {
    var k = normalizeKey(key); if (!k) return false;
    var seg = k.split('+'), base = seg[seg.length - 1];
    return /^[0-9]$/.test(base);
  }

  function keyOf(id) {
    var rec = _records[id]; if (!rec) return '';
    if (Object.prototype.hasOwnProperty.call(_overrides, id)) return _overrides[id];
    return rec.defaultKey || '';
  }

  // Live resolved record (drops nothing — holds run fn; host must JSON-project before messaging).
  function resolve(id) {
    var rec = _records[id]; if (!rec) return null;
    return {
      id: id, label: rec.label, category: rec.category, rebindable: rec.rebindable,
      displayKey: rec.displayKey, event: rec.event, run: rec.run,
      defaultKey: rec.defaultKey, key: keyOf(id),
      isOverridden: Object.prototype.hasOwnProperty.call(_overrides, id)
    };
  }

  function persist() {
    try {
      if (!window.localStorage) return;
      var merged = {}, k;
      for (k in _unknown) if (Object.prototype.hasOwnProperty.call(_unknown, k)) merged[k] = _unknown[k];
      for (k in _overrides) if (Object.prototype.hasOwnProperty.call(_overrides, k)) merged[k] = _overrides[k];
      localStorage.setItem(LS_KEY, JSON.stringify({ v: SCHEMA_V, overrides: merged }));
    } catch (e) { log('persist failed: ' + (e && e.message ? e.message : e)); }
  }

  function emit() {
    for (var i = 0; i < _listeners.length; i++) {
      try { _listeners[i](); } catch (e) { log('onChange listener threw: ' + (e && e.message ? e.message : e)); }
    }
  }

  // Load persisted overrides at file top (before any register). Unknown ids are
  // held in _unknown until/unless registered; keyOf is lazy so order is irrelevant.
  (function loadOverrides() {
    try {
      var raw = window.localStorage ? localStorage.getItem(LS_KEY) : null;
      if (!raw) return;
      var obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') { log('stored binds not an object; ignoring'); return; }
      if (typeof obj.v === 'number' && obj.v > SCHEMA_V) { log('stored binds schema v' + obj.v + ' > ' + SCHEMA_V + '; ignoring (keeping defaults)'); return; }
      var ov = obj.overrides || {}, id;
      for (id in ov) {
        if (!Object.prototype.hasOwnProperty.call(ov, id)) continue;
        var k = ov[id];
        if (k !== '' && (typeof k !== 'string' || normalizeKey(k) == null)) continue; // skip junk
        _unknown[id] = (k === '') ? '' : normalizeKey(k);   // promoted to _overrides on register()
      }
    } catch (e) { log('load failed; using defaults: ' + (e && e.message ? e.message : e)); }
  })();

  function findConflict(key, exceptId) {
    var k = normalizeKey(key); if (!k) return null;
    for (var i = 0; i < _order.length; i++) {
      var id = _order[i]; if (id === exceptId) continue;
      var rec = _records[id]; if (!rec || !rec.rebindable) continue;
      var live = keyOf(id);
      if (live && live === k) return id;
    }
    return null;
  }

  BA.rebind = {
    register: function (id, spec) {
      if (!id || !spec) { log('register: bad args'); return; }
      var rec = {
        label: spec.label || id,
        category: spec.category || 'General',
        run: spec.run,
        rebindable: spec.rebindable !== false,
        event: spec.event || 'keydown',
        displayKey: spec.displayKey,
        order: spec.order,
        defaultKey: (spec.defaultKey != null) ? (normalizeKey(spec.defaultKey) || '') : ''
      };
      if (rec.rebindable && rec.defaultKey && isReserved(rec.defaultKey)) {
        if (BA.warn) BA.warn('REBIND default for ' + id + ' is a reserved digit key (' + rec.defaultKey + ')');
      }
      if (!_records[id]) _order.push(id);
      _records[id] = rec;
      // promote a persisted override that arrived before this registration
      if (Object.prototype.hasOwnProperty.call(_unknown, id)) {
        _overrides[id] = _unknown[id]; delete _unknown[id];
      }
    },

    get: function (id) { return resolve(id); },
    getAll: function () {
      var out = [];
      for (var i = 0; i < _order.length; i++) out.push(resolve(_order[i]));
      return out;
    },
    keyOf: keyOf,
    findConflict: findConflict,
    normalizeKey: normalizeKey,
    isReserved: isReserved,

    set: function (id, key, opts) {
      opts = opts || {};
      var rec = _records[id];
      if (!rec) return { ok: false, reason: 'unknown' };
      if (!rec.rebindable) return { ok: false, reason: 'not-rebindable' };
      var k = normalizeKey(key);
      if (k == null) return { ok: false, reason: 'invalid' };
      if (k !== '' && isReserved(k)) return { ok: false, reason: 'reserved' };
      var stole = null;
      if (k !== '') {
        var other = findConflict(k, id);
        if (other) {
          if (!opts.allowConflict) return { ok: false, conflict: other };
          _overrides[other] = '';                          // steal: previous holder -> unbound
          stole = other;
        }
      }
      if (k === (rec.defaultKey || '')) delete _overrides[id];   // back to default -> no delta
      else _overrides[id] = k;
      persist(); emit();
      return { ok: true, stole: stole };
    },

    resetOne: function (id) {
      if (!_records[id]) return false;
      if (Object.prototype.hasOwnProperty.call(_overrides, id)) delete _overrides[id];
      persist(); emit(); return true;
    },
    resetAll: function () { _overrides = {}; persist(); emit(); },

    export: function () { return JSON.stringify({ v: SCHEMA_V, overrides: mergedOverrides() }); },

    import: function (json, opts) {
      opts = opts || {};
      var obj;
      try { obj = (typeof json === 'string') ? JSON.parse(json) : json; }
      catch (e) { return { ok: false, reason: 'parse-error' }; }
      if (!obj || typeof obj !== 'object') return { ok: false, reason: 'not-object' };
      if (typeof obj.v === 'number' && obj.v > SCHEMA_V) return { ok: false, reason: 'newer-schema' };
      var ov = obj.overrides || {}, next = {}, unknown = {}, skipped = [], applied = 0, id;
      for (id in ov) {
        if (!Object.prototype.hasOwnProperty.call(ov, id)) continue;
        var k = ov[id];
        var rec = _records[id];
        if (!rec) { unknown[id] = (k === '') ? '' : (normalizeKey(k) || null); if (unknown[id] === null) delete unknown[id]; continue; }
        if (!rec.rebindable) { skipped.push({ id: id, reason: 'not-rebindable' }); continue; }
        var nk = normalizeKey(k);
        if (nk == null) { skipped.push({ id: id, reason: 'invalid' }); continue; }
        if (nk !== '' && isReserved(nk)) { skipped.push({ id: id, reason: 'reserved' }); continue; }
        if (nk !== (rec.defaultKey || '')) next[id] = nk;   // deltas only
        applied++;
      }
      _overrides = next; _unknown = unknown;
      persist(); emit();
      return { ok: true, applied: applied, skipped: skipped };
    },

    onChange: function (fn) {
      if (typeof fn !== 'function') return function () {};
      _listeners.push(fn);
      return function () { var i = _listeners.indexOf(fn); if (i >= 0) _listeners.splice(i, 1); };
    }
  };

  function mergedOverrides() {
    var merged = {}, k;
    for (k in _unknown) if (Object.prototype.hasOwnProperty.call(_unknown, k)) merged[k] = _unknown[k];
    for (k in _overrides) if (Object.prototype.hasOwnProperty.call(_overrides, k)) merged[k] = _overrides[k];
    return merged;
  }

  log('BA.rebind ready (schema v' + SCHEMA_V + ', ' + Object.keys(_unknown).length + ' pending override(s))');
})();
