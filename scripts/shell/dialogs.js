/**
 * Mobile adaptation of the ApplicationV2 windows we reuse as-is: dnd5e roll configuration, activity usage,
 * activity choice, rests, and core DialogV2 (confirm/prompt). They become bottom sheets (CSS keyed on the
 * class added here), sit above the on-screen keyboard, and get touch-sized controls.
 * Our own apps (.pocket5e-app), full sheets (.pocket5e-fullsheet) and the hidden core UI are left alone.
 */
import { MobileMode } from "../mobile-mode.js";

export const DIALOG_CLASS = "pocket5e-sheet-dialog";

export function registerDialogAdaptation() {
  Hooks.on("renderApplicationV2", (app, element) => {
    if ( !MobileMode.standalone ) return;
    if ( !isDialogLike(app, element) ) return;
    element.classList.add(DIALOG_CLASS);
  });
  trackKeyboard();
}

function isDialogLike(app, element) {
  if ( !element || !element.classList?.contains("application") ) return false;
  if ( element.classList.contains("pocket5e-app") || element.classList.contains("pocket5e-fullsheet") ) return false;
  if ( element.closest("#interface") ) return false;                                  // hidden core UI (sidebar, hotbar…)
  if ( ["Actor", "Item"].includes(app.document?.documentName) ) return false;        // handled by full-sheet.js
  return true;
}

/**
 * Publish the on-screen keyboard height as --pocket5e-kb so bottom sheets and drawers shrink above it
 * instead of hiding the focused input behind the keyboard (iOS Safari does not resize the layout viewport).
 */
function trackKeyboard() {
  const vv = window.visualViewport;
  if ( !vv ) return;
  const root = document.documentElement;
  const update = () => {
    const layoutHeight = root.clientHeight || window.innerHeight;
    const keyboard = Math.max(0, Math.round(layoutHeight - vv.height - vv.offsetTop));
    root.style.setProperty("--pocket5e-kb", `${keyboard < 80 ? 0 : keyboard}px`);   // ignore browser chrome jitter
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
}
