import { MODULE_ID, SETTINGS, MODE, appPath, cacheAppPath } from "./settings.js";

/**
 * Two questions live here:
 *   - are we running inside the standalone app page (app.html)?  → MobileMode.standalone
 *   - if not (regular /game client), does this device look like a phone that should be
 *     redirected to the app?                                       → MobileMode.decide()
 *
 * Plus the canvas switch. Core reads client settings straight from localStorage
 * (ClientSettings → window.localStorage, key "<namespace>.<key>", JSON-encoded) and
 * Canvas#initialize checks core.noCanvas during setupGame — so writing the key before the Game
 * is created is enough, no reload needed. Note the `init` hook fires BEFORE core registers its
 * settings, so game.settings.get("core", "noCanvas") would throw there; hence raw localStorage.
 */
const LS_NO_CANVAS = "core.noCanvas";
const LS_NO_CANVAS_BACKUP = `${MODULE_ID}.noCanvasBackup`;
const LS_MODE = `${MODULE_ID}.${SETTINGS.MODE}`;
const LS_BREAKPOINT = `${MODULE_ID}.${SETTINGS.BREAKPOINT}`;

function readClientSetting(key) {
  try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch(err) { return null; }
}

export class MobileMode {
  /** Whether the mobile UI is active for this session. */
  static active = false;

  /** Human-readable explanation of the decision, for logs and diagnostics. */
  static reason = "";

  /** True when the page was booted by scripts/standalone/boot.js. */
  static get standalone() {
    return globalThis.POCKET5E?.standalone === true;
  }

  /**
   * Early variant of decide() for the regular /game client, run when our module script is evaluated — before
   * Game.create fetches the world and before the other modules finish loading. No Game/settings exist yet, so
   * it reads our client settings straight from localStorage (URL override → setting → device heuristics).
   * The GM role and the world's "forced users" list are unknown this early; init() covers those.
   * @returns {boolean}
   */
  static decideEarly() {
    if ( this.standalone ) return false;
    let mode = readClientSetting(LS_MODE);
    const param = new URLSearchParams(window.location.search).get("mobile");
    if ( param !== null ) {
      mode = ["1", "true", "on", "yes"].includes(param.toLowerCase()) ? MODE.ON : MODE.OFF;
      try { localStorage.setItem(LS_MODE, JSON.stringify(mode)); } catch(err) { /* ignore */ }
      this.reason = `url ?mobile=${param}`;
    }
    if ( mode === MODE.ON ) { this.active = true; this.reason ||= "setting: always on"; }
    else if ( mode === MODE.OFF ) { this.active = false; this.reason ||= "setting: always off"; }
    else {
      const breakpoint = Number(readClientSetting(LS_BREAKPOINT)) || 900;
      const device = this.detectDevice(breakpoint);
      this.active = device.isMobile;
      this.reason = `auto: ${device.details}`;
    }
    return this.active;
  }

  /** Leave for the app page and remember where it lives so the next visit can redirect before the world loads. */
  static goToApp(path=appPath()) {
    cacheAppPath(path);
    window.location.replace(foundry.utils.getRoute(path));
  }

  /**
   * Regular /game client only: URL override → client setting → device heuristics.
   * Must be called from the `init` hook, after registerSettings().
   * @returns {boolean}
   */
  static decide() {
    if ( game.system.id !== "dnd5e" ) {
      this.active = false;
      this.reason = "system is not dnd5e";
      return this.active;
    }

    // GMs and assistants keep the full client even on a tablet — they need the canvas.
    // game.users is not built yet during init, so read the raw user record.
    const role = game.data?.users?.find(u => u._id === game.userId)?.role ?? 0;
    if ( role >= CONST.USER_ROLES.ASSISTANT ) {
      this.active = false;
      this.reason = "user is GM/assistant";
      return this.active;
    }

    // The GM can pin specific players to the app (world setting).
    const forced = game.settings.get(MODULE_ID, SETTINGS.FORCED_USERS);
    if ( Array.isArray(forced) && forced.includes(game.userId) ) {
      this.active = true;
      this.reason = "forced by GM";
      return this.active;
    }

    let mode = game.settings.get(MODULE_ID, SETTINGS.MODE);

    // One-shot override from the URL, e.g. /game?mobile=0 — persisted for the next plain /game load.
    const param = new URLSearchParams(window.location.search).get("mobile");
    if ( param !== null ) {
      mode = ["1", "true", "on", "yes"].includes(param.toLowerCase()) ? MODE.ON : MODE.OFF;
      game.settings.set(MODULE_ID, SETTINGS.MODE, mode);   // client scope → localStorage only
      this.reason = `url ?mobile=${param}`;
    }

    if ( mode === MODE.ON ) {
      this.active = true;
      this.reason ||= "setting: always on";
    }
    else if ( mode === MODE.OFF ) {
      this.active = false;
      this.reason ||= "setting: always off";
    }
    else {
      const breakpoint = Number(game.settings.get(MODULE_ID, SETTINGS.BREAKPOINT)) || 900;
      const device = this.detectDevice(breakpoint);
      this.active = device.isMobile;
      this.reason = `auto: ${device.details}`;
    }
    return this.active;
  }

  /**
   * Heuristic phone/tablet detection.
   * @param {number} breakpoint  Max viewport width considered "mobile".
   * @returns {{isMobile: boolean, details: string}}
   */
  static detectDevice(breakpoint) {
    const width = window.innerWidth;
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const uaMobile = navigator.userAgentData?.mobile
      ?? /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    const isMobile = width <= breakpoint && (coarse || uaMobile);
    return {
      isMobile,
      details: `width=${width}<=${breakpoint}:${width <= breakpoint}, coarsePointer=${coarse}, uaMobile=${uaMobile}`
    };
  }

  /* -------------------------------------------- */

  /** Turn core.noCanvas on, remembering the user's own value to restore later. */
  static forceNoCanvas() {
    const current = localStorage.getItem(LS_NO_CANVAS);
    if ( current === "true" ) return;
    if ( localStorage.getItem(LS_NO_CANVAS_BACKUP) === null ) {
      localStorage.setItem(LS_NO_CANVAS_BACKUP, current ?? "");
    }
    localStorage.setItem(LS_NO_CANVAS, "true");
  }

  /** Undo forceNoCanvas if we were the ones who flipped the switch. */
  static restoreNoCanvas() {
    const backup = localStorage.getItem(LS_NO_CANVAS_BACKUP);
    if ( backup === null ) return;
    if ( backup === "" ) localStorage.removeItem(LS_NO_CANVAS);
    else localStorage.setItem(LS_NO_CANVAS, backup);
    localStorage.removeItem(LS_NO_CANVAS_BACKUP);
  }
}
