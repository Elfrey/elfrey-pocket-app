/**
 * Elfrey Pocket App — hooks entry point.
 *
 * Loaded in two contexts:
 *   - by the standalone page (scripts/standalone/boot.js imports it after the dnd5e system);
 *   - by the regular /game client through module.json "esmodules" — there its only job is to send
 *     phones to the standalone app and otherwise stay out of the way.
 */
import { MODULE_ID, registerSettings, cachedAppPath } from "./settings.js";
import { MobileMode } from "./mobile-mode.js";
import { PocketApp } from "./shell/controller.js";
import { registerFullSheetHooks } from "./shell/full-sheet.js";
import { registerChatCardEnhancements } from "./shell/chat-cards.js";
import { registerDialogAdaptation } from "./shell/dialogs.js";
import { registerForcedUsersMenu } from "./shell/forced-users.js";
import { applyTheme, watchSystemTheme } from "./theme.js";
import { setRollMode, publicRollMode } from "./actions.js";
import { registerRelayGM, registerRelayClient } from "./relay.js";
import { registerBridge } from "./bridge.js";

const T = `modules/${MODULE_ID}/templates`;
/** Handlebars partials shared by several templates; registered under these names. */
const PARTIALS = {
  "pocket5e.rollbar": `${T}/parts/rollbar.hbs`,
  "pocket5e.activityRow": `${T}/parts/activity-row.hbs`,
  "pocket5e.itemRow": `${T}/parts/item-row.hbs`,
  "pocket5e.spellRow": `${T}/parts/spell-row.hbs`,
  "pocket5e.effectRow": `${T}/parts/effect-row.hbs`,
  "pocket5e.featureRow": `${T}/parts/feature-row.hbs`,
  "pocket5e.sectionFeatures": `${T}/parts/section-features.hbs`,
  "pocket5e.sectionActions": `${T}/parts/section-actions.hbs`,
  "pocket5e.sectionBiography": `${T}/parts/section-biography.hbs`,
  "pocket5e.sectionJournal": `${T}/parts/section-journal.hbs`,
  "pocket5e.sectionEffects": `${T}/parts/section-effects.hbs`
};
let partialsReady = Promise.resolve();

const log = (...args) => console.log(`${MODULE_ID} |`, ...args);

// Regular /game client: decide right now, while this script is being evaluated — before Game.create downloads
// the world and before the other modules' scripts finish. The app's URL depends on the core version and a world
// setting, both unknown this early, so the early exit only fires once this browser has been sent there before.
if ( !MobileMode.standalone && MobileMode.decideEarly() ) {
  const cached = cachedAppPath();
  if ( cached ) {
    log(`phone detected on /game → switching to the app (${MobileMode.reason})`);
    MobileMode.goToApp(cached);
  }
  else log(`phone detected on /game (${MobileMode.reason}); switching after init — app URL not known yet on this device`);
}

// Earlier builds registered a service worker under the module folder; make sure none lingers.
navigator.serviceWorker?.getRegistrations?.().then(list => {
  for ( const r of list ) if ( r.scope.includes(`/modules/${MODULE_ID}/`) ) r.unregister();
}).catch(() => {});

Hooks.once("init", () => {
  registerSettings();
  registerForcedUsersMenu();

  if ( MobileMode.standalone ) {
    MobileMode.active = true;
    MobileMode.reason = "standalone app";
    // Core opens the user's config sheet when a player has no assigned character;
    // the app has its own character picker, so close it.
    Hooks.on("renderUserConfig", app => { if ( !app.document?.character ) app.close(); });
    registerFullSheetHooks();
    registerChatCardEnhancements();
    registerDialogAdaptation();
    partialsReady = foundry.applications.handlebars.loadTemplates(PARTIALS);
    installHotReload();
    log("init — standalone app");
    return;
  }

  // Regular /game client (late check: GM role and the world's forced-users list are only known now).
  MobileMode.decide();
  log(`init — /game client, mobile ${MobileMode.active ? "ON → switching to the app" : "off"} (${MobileMode.reason})`);
  if ( MobileMode.active ) {
    MobileMode.goToApp();
    return;
  }
  MobileMode.restoreNoCanvas();   // clean up after the phase-0 prototype, if it ran in this browser
});

Hooks.once("ready", async () => {
  const mod = game.modules.get(MODULE_ID);
  if ( mod ) mod.api = { MobileMode, PocketApp };
  if ( !MobileMode.standalone ) {
    registerRelayGM();     // the GM's desktop client executes item uses sent from phones (relay.js)
    return;
  }

  if ( game.system.id !== "dnd5e" ) {
    ui.notifications.warn(game.i18n.localize("POCKET5E.Notify.NotDnd5e"));
    return;
  }
  document.body.classList.add("pocket5e-mobile");
  applyTheme();
  watchSystemTheme();
  installOfflineOverlay();
  registerRelayClient();
  registerBridge().catch(err => console.warn(`${MODULE_ID} | bridge:`, err));
  log("ready — user:", game.user.name, "character:", game.user.character?.name ?? "(none)");

  // Every app session starts with public rolls; the in-app picker changes it for the session only.
  try { await setRollMode(publicRollMode()); } catch(err) { console.warn(`${MODULE_ID} |`, err); }
  await partialsReady;
  PocketApp.start();
});

/**
 * Foundry's hot reload (options.json "hotReload": true + flags.hotReload in module.json) pushes changed css/hbs/json
 * to every client. Core handles them by path; two of our cases need help: the app page loads the stylesheet through
 * an @import whose path spelling may differ from the server's, and templates registered as named partials
 * (PARTIALS) are cached under the name, not the path.
 */
function installHotReload() {
  Hooks.on("hotReload", data => {
    if ( data?.packageId !== MODULE_ID ) return;
    const file = String(data.path ?? "").split("/").pop();
    if ( data.extension === "css" ) {
      for ( const style of document.querySelectorAll("style") ) {
        if ( !style.textContent.includes(`/${file}`) ) continue;
        style.textContent = style.textContent.replace(/@import\s+"([^"?]+)(?:\?[^"]*)?"/, `@import "$1?${Date.now()}"`);
        log("hot reload — styles");
        return false;   // handled
      }
      return;           // let core try the <link> route
    }
    if ( data.extension === "hbs" ) {
      const path = String(data.path ?? "").replace(/^\//, "");
      const name = Object.entries(PARTIALS).find(([, p]) => p === path)?.[0];
      if ( name ) {
        try { Handlebars.registerPartial(name, Handlebars.compile(data.content)); } catch(err) { console.error(err); }
      }
      log("hot reload — template", path);
    }
  });
}

/** Full-screen notice while the socket is down; core reconnects (and reloads if needed) on its own. */
function installOfflineOverlay() {
  const overlay = document.createElement("div");
  overlay.id = "pocket5e-offline";
  overlay.hidden = true;
  overlay.innerHTML = `<div class="pocket5e-offline-box"><i class="fa-solid fa-plug-circle-xmark"></i>`
    + `<strong>${game.i18n.localize("POCKET5E.Offline.Title")}</strong>`
    + `<span>${game.i18n.localize("POCKET5E.Offline.Text")}</span></div>`;
  document.body.append(overlay);
  game.socket.on("disconnect", () => { overlay.hidden = false; });
  game.socket.on("connect", () => { overlay.hidden = true; });
}
