/**
 * Module constants and client settings.
 *
 * MODULE_ID is the single place the identifier lives in JavaScript. Renaming the module means:
 *   1. this constant, 2. "id" in module.json, 3. the folder name (+ the symlinks in Data/modules).
 * CSS classes (pocket5e-*) and i18n keys (POCKET5E.*) are deliberately NOT derived from the id.
 *
 * All settings here are `client` scope: they live in the browser's localStorage, so a player's
 * phone and desktop can hold different values.
 */
export const MODULE_ID = "elfrey-pocket-app";

/** App page inside the module folder — Foundry v13 serves it as HTML. */
export const APP_PAGE = `modules/${MODULE_ID}/app.html`;
/**
 * App page exposed through Foundry's core `public/` directory (tools/install-v14.*): Foundry v14 serves HTML from
 * the data directory as text/plain, `public/` has no such restriction.
 */
export const PUBLIC_PAGE = "pocket/app.html";
const LS_APP_URL = `${MODULE_ID}.appUrlCache`;

/** Route (relative to the Foundry route prefix) the regular client sends phones to. */
export function appPath() {
  let configured = "";
  try { configured = String(game.settings.get(MODULE_ID, SETTINGS.APP_URL) ?? "").trim(); } catch(err) { /* not registered yet */ }
  if ( configured ) return configured.replace(/^\/+/, "");
  const generation = Number(globalThis.game?.release?.generation ?? 0);
  return generation >= 14 ? PUBLIC_PAGE : APP_PAGE;
}

/** The app path this browser was last sent to — lets the early redirect run before any Game exists. */
export function cachedAppPath() {
  try { return localStorage.getItem(LS_APP_URL) || null; } catch(err) { return null; }
}
export function cacheAppPath(path) {
  try { localStorage.setItem(LS_APP_URL, path); } catch(err) { /* ignore */ }
}

export const SETTINGS = Object.freeze({
  /** "auto" | "on" | "off" — should phones opening the regular /game client be sent to the app. */
  MODE: "mode",
  /** Viewport width (px) at or below which "auto" treats a touch device as a phone. */
  BREAKPOINT: "breakpoint",
  /** Last character chosen in the app (actor id). */
  LAST_ACTOR: "lastActorId",
  /** Skip the dnd5e roll configuration dialog for checks, saves and skills. */
  FAST_ROLL: "fastRoll",
  /** Colour theme: "system" | "dark" | "light". */
  THEME: "theme",
  /** Vibrate briefly on rolls and item use (devices that support it). */
  HAPTICS: "haptics",
  /** World setting (GM): user ids that are always sent to the app when they open /game. */
  FORCED_USERS: "forcedUsers",
  /** World setting (GM): where the app page is served from, relative to the Foundry root (v14 needs a non-Data path). */
  APP_URL: "appUrl",
  /** World setting (GM): "auto" | "on" | "off" — run item/activity use on the GM's client (midi-qol), see relay.js. */
  RELAY: "gmRelay"
});

export const MODE = Object.freeze({ AUTO: "auto", ON: "on", OFF: "off" });
/** GM relay modes: auto = only while midi-qol is active in the world. */
export const RELAY = Object.freeze({ AUTO: "auto", ON: "on", OFF: "off" });

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.MODE, {
    name: "POCKET5E.Settings.Mode.Name",
    hint: "POCKET5E.Settings.Mode.Hint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      [MODE.AUTO]: "POCKET5E.Settings.Mode.Auto",
      [MODE.ON]: "POCKET5E.Settings.Mode.On",
      [MODE.OFF]: "POCKET5E.Settings.Mode.Off"
    },
    default: MODE.AUTO,
    requiresReload: true
  });

  game.settings.register(MODULE_ID, SETTINGS.BREAKPOINT, {
    name: "POCKET5E.Settings.Breakpoint.Name",
    hint: "POCKET5E.Settings.Breakpoint.Hint",
    scope: "client",
    config: true,
    type: Number,
    default: 900,
    requiresReload: true
  });

  game.settings.register(MODULE_ID, SETTINGS.FAST_ROLL, {
    name: "POCKET5E.Settings.FastRoll.Name",
    hint: "POCKET5E.Settings.FastRoll.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, SETTINGS.THEME, {
    name: "POCKET5E.Settings.Theme.Name",
    hint: "POCKET5E.Settings.Theme.Hint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      system: "POCKET5E.Theme.system",
      dark: "POCKET5E.Theme.dark",
      light: "POCKET5E.Theme.light"
    },
    default: "system",
    onChange: () => import("./theme.js").then(m => m.applyTheme())
  });

  game.settings.register(MODULE_ID, SETTINGS.HAPTICS, {
    name: "POCKET5E.Settings.Haptics.Name",
    hint: "POCKET5E.Settings.Haptics.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.APP_URL, {
    name: "POCKET5E.Settings.AppUrl.Name",
    hint: "POCKET5E.Settings.AppUrl.Hint",
    scope: "world",
    config: true,
    type: String,
    default: ""      // empty = automatic: v13 → APP_PAGE, v14 → PUBLIC_PAGE
  });

  game.settings.register(MODULE_ID, SETTINGS.RELAY, {
    name: "POCKET5E.Settings.Relay.Name",
    hint: "POCKET5E.Settings.Relay.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      [RELAY.AUTO]: "POCKET5E.Settings.Relay.Auto",
      [RELAY.ON]: "POCKET5E.Settings.Relay.On",
      [RELAY.OFF]: "POCKET5E.Settings.Relay.Off"
    },
    default: RELAY.AUTO
  });

  game.settings.register(MODULE_ID, SETTINGS.FORCED_USERS, {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  game.settings.register(MODULE_ID, SETTINGS.LAST_ACTOR, {
    scope: "client",
    config: false,
    type: String,
    default: ""
  });
}
