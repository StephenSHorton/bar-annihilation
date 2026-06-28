(function () {
  'use strict';
  var BA = window.BarAnnihilation; if (!BA) { return; }

  // ---------------------------------------------------------------------------
  // DISPLAY DEFAULTS — BAR-faithful view preferences.
  //
  // BAR draws your selection's command queue persistently; PA has the exact same
  // feature (the `ui.show_orders` setting) but ships it as SHIFT — order previews
  // only render while you hold the queue modifier. We flip it to ALWAYS so your
  // army's orders stay drawn without holding Shift. We DON'T touch it if you've
  // deliberately set NEVER, and it's a no-op if you're already on ALWAYS.
  //
  // Applied via api.settings.set (NOT a partial engine.call): PA's setter re-emits
  // the FULL display-settings object to the engine, so this leaves every other
  // display pref (unit icons, stat bars, build previews, ...) untouched. It does
  // persist to your saved PA settings — which is the behavior you opted into.
  //
  // Tip: to also see your WHOLE army's orders with nothing selected, set
  // `ui.order_behavior` to 'SELECTED_OR_ALL' (left alone here — say the word).
  // ---------------------------------------------------------------------------
  BA.register({
    name: 'display-defaults',
    init: function () {
      // Defer briefly so the settings subsystem has finished its own boot-time
      // apply before we write (avoids racing PA's startup updateDisplaySettings).
      setTimeout(function () {
        try {
          if (typeof api === 'undefined' || !api.settings || !api.settings.set) {
            BA.warn('display-defaults: api.settings unavailable — skipping show_orders');
            return;
          }
          var cur = null;
          try { if (api.settings.value) cur = api.settings.value('ui', 'show_orders'); } catch (e) {}
          if (cur === 'NEVER') { BA.log('display-defaults: show_orders=NEVER (your choice) — leaving as-is'); return; }
          if (cur !== 'ALWAYS') api.settings.set('ui', 'show_orders', 'ALWAYS');
          // set() ONLY updates the stored value + observable — it does NOT push to
          // the engine (that's why the lines didn't change live). apply(['ui'])
          // re-emits the full display-settings object (game.updateDisplaySettings)
          // from current values, so it takes effect THIS session without clobbering
          // your other display prefs (icons, stat bars, build previews, ...). We
          // call it every launch (idempotent — re-emits current values, no inputmap
          // reload for the 'ui' group) so the engine flag is guaranteed set even if
          // the stored value was already ALWAYS but PA's startup apply missed it.
          if (api.settings.apply) api.settings.apply(['ui']);
          BA.log('display-defaults: show_orders ' + cur + ' -> ALWAYS + applied to engine (order queues now persist without Shift)');
        } catch (e) { BA.err('display-defaults: failed to set show_orders', e); }
      }, 1200);
    }
  });
})();
