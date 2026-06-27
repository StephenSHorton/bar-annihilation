// BAR Annihilation — action_bar PANEL patch.
//
// Runs in PA's `live_game_action_bar` panel, a SEPARATE Coherent view from the main
// `live_game` scene where the rest of the mod lives (own `api`, `model`, DOM).
//
// PA shows a command's hotkey in TWO places: the always-visible button BADGE
// (`model.keybindsForCommandModes()`, which the live_game side corrects to BAR keys
// via a keybinds push) AND, on hover, the TOOLTIP — which appends a key read from
//   api.settings.value('keyboard', <data-tooltipkey>)   (shared/js/ko_bindings.js:262)
// keyed by action name (command_mode_attack, stop_command, ...). Showing the key in
// BOTH places reads as a doubled label on hover.
//
// We keep the BADGE as the single, BAR-style key hint and SUPPRESS the redundant
// tooltip key. DISPLAY-ONLY: we only short-circuit the 2-arg GET for command tooltip
// lookups to an empty string (-> ko_bindings.js then skips the hotkey span); nothing
// is written or persisted, and every other settings read passes straight through.
// Only command buttons carry a data-tooltipkey (order-stance buttons have none).
(function () {
  'use strict';
  if (typeof api === 'undefined' || !api.settings || typeof api.settings.value !== 'function') return;
  if (api.settings.__barTooltipPatched) return;            // idempotent across reloads
  api.settings.__barTooltipPatched = true;

  var orig = api.settings.value;
  api.settings.value = function (category, key) {
    // Suppress the tooltip hotkey for command buttons; the button badge is the single
    // key indicator. Pass everything else (incl. any 3-arg setter) through untouched.
    if (arguments.length === 2 && category === 'keyboard' && typeof key === 'string' &&
        (key.indexOf('command_mode_') === 0 || key === 'stop_command')) {
      return '';
    }
    return orig.apply(api.settings, arguments);
  };

  try { console.log('[bar-annihilation] action_bar command tooltips: hotkey shown on badge only'); } catch (e) {}
})();
