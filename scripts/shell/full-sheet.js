/**
 * "Full sheet" fallback: open the native dnd5e actor (or item) sheet and scale it to the phone.
 * The sheet keeps its desktop layout width and is shrunk with a CSS transform (position.scale),
 * so nothing inside reflows or breaks — the same trick theripper93's mobile-sheet used.
 */
import { MobileMode } from "../mobile-mode.js";

const FIT_CLASS = "pocket5e-fullsheet";

export function openFullSheet(actor) {
  return actor.sheet.render({ force: true });
}

/** Register once (init) in standalone mode. */
export function registerFullSheetHooks() {
  Hooks.on("renderApplicationV2", app => {
    if ( !MobileMode.standalone ) return;
    if ( !["Actor", "Item"].includes(app.document?.documentName) ) return;
    fitToScreen(app);
  });
  window.addEventListener("resize", foundry.utils.debounce(() => {
    for ( const app of foundry.applications.instances.values() ) {
      if ( app.element?.classList.contains(FIT_CLASS) ) fitToScreen(app);
    }
  }, 150));
}

export function fitToScreen(app) {
  const element = app.element;
  if ( !element || element.classList.contains("pocket5e-app") ) return;
  element.classList.add(FIT_CLASS);
  const width = (typeof app.position.width === "number") ? app.position.width : (element.offsetWidth || 800);
  const scale = Math.min(1, window.innerWidth / width);
  app.setPosition({ left: 0, top: 0, width, height: Math.round(window.innerHeight / scale), scale });
}
