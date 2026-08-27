/**
 * Standalone bootstrap — replaces Foundry's /game page for phones.
 *
 * Sequence (mirrors foundry.mjs' own DOMContentLoaded bootstrap, minus everything we don't want):
 *   1. wait for DOMContentLoaded, THEN import /scripts/foundry.mjs — its built-in bootstrap is
 *      registered on DOMContentLoaded and therefore never fires for this page;
 *   2. force core.noCanvas and stub side-effect initialisers (playlist autoplay, A/V, search index);
 *   3. make sure a server session exists (HEAD /game mints the cookie without logging anyone out), connect the
 *      socket — v13 passes the cookie value, v14 keeps it HttpOnly and identifies the session from the handshake;
 *   4. no user on the session → render the login screen (POST /join), reload;
 *   5. load the dnd5e system + our own hooks, request the world, create the Game, initialize.
 *
 * Nothing from other modules is ever downloaded or executed.
 */
import { MODULE_ID } from "../settings.js";
import { MobileMode } from "../mobile-mode.js";
import { applyTheme, watchSystemTheme } from "../theme.js";
import { showLogin } from "./login.js";

/** Route prefix as defined by the page's inline script (same contract as Foundry's own pages). */
const PREFIX = (typeof ROUTE_PREFIX === "string" && ROUTE_PREFIX) ? `/${ROUTE_PREFIX}` : "";
export const route = path => `${PREFIX}/${String(path).replace(/^\/+/, "")}`;

const log = (...args) => console.log(`${MODULE_ID} |`, ...args);

function setStatus(text) {
  const el = document.getElementById("pocket5e-boot-status");
  if ( el ) el.textContent = text;
}

function loadStyle(href) {
  return new Promise(resolve => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}

/** Insert a script; async=false keeps dynamically added scripts executing in insertion order (classic and module). */
function loadScript(src, { module=false }={}) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    if ( module ) el.type = "module";
    el.async = false;
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(el);
  });
}

/**
 * Copy the core stylesheets and vendor scripts from the server's own /join page (served without a session) so the
 * set always matches the running core version — v14 dropped TinyMCE and swapped the KTX2 loader, for example.
 * foundry.mjs itself is skipped here and imported by boot() after everything else has executed.
 */
async function loadCoreAssets() {
  // credentials:"omit" is essential: Foundry's /join handler logs the request's session out of the world, so
  // sending our cookie here would immediately un-login the player we just authenticated. Without the cookie the
  // server acts on a throwaway anonymous session and still returns the same asset list.
  const response = await fetch(route("join"), { credentials: "omit", cache: "no-store" });
  if ( !response.ok ) throw new Error(`join page: HTTP ${response.status}`);
  const doc = new DOMParser().parseFromString(await response.text(), "text/html");

  for ( const link of doc.head.querySelectorAll('link[rel="stylesheet"][href]') ) {
    const el = document.createElement("link");
    el.rel = "stylesheet";
    el.href = link.getAttribute("href");            // relative → resolves against our <base>
    document.head.appendChild(el);
  }
  for ( const style of doc.head.querySelectorAll("style") ) {
    const el = document.createElement("style");
    el.textContent = style.textContent;             // @import layers, core-translation module styles
    document.head.appendChild(el);
  }
  const scripts = Array.from(doc.head.querySelectorAll("script[src]"))
    .map(el => ({ src: el.getAttribute("src"), module: el.getAttribute("type") === "module" }))
    .filter(s => !/scripts\/foundry\.mjs$/.test(s.src));
  await Promise.all(scripts.map(s => loadScript(s.src, s)));
  return scripts.length;
}

/** Neutralise core behaviours that make no sense on a phone-sized companion client. */
function patchCore() {
  // World playlists would start playing through the phone speaker.
  foundry.documents.collections.Playlists.prototype.initialize = async function() {};
  // Never join audio/video conferencing from the companion.
  foundry.av.AVMaster.prototype.connect = async function() { return false; };
  // Full-text document index is only needed by desktop search/autocomplete; skip the CPU burn.
  foundry.helpers.DocumentIndex.prototype.index = async function() {};
}

/**
 * The module's manifest from the world payload if the world has it enabled, else null.
 * The server stamps `active` on every module it sends (world.mjs: active = core.moduleConfiguration[id]); the
 * setting itself is only a fallback for payloads without that flag.
 */
function moduleActiveInPayload(data, id) {
  const P = globalThis.POCKET5E;
  const manifest = (data.modules ?? []).find(m => m.id === id);
  if ( !manifest ) {
    log(`${id}: not installed in this world (payload lists ${(data.modules ?? []).length} modules)`);
    P.socketlib = "not installed";
    return null;
  }
  let active = manifest.active;
  if ( typeof active !== "boolean" ) {
    try {
      const setting = (data.settings ?? []).find(s => s.key === "core.moduleConfiguration");
      const config = (typeof setting?.value === "string") ? JSON.parse(setting.value) : (setting?.value ?? {});
      active = config[id] === true;
    } catch(err) {
      active = false;
    }
  }
  if ( !active ) {
    log(`${id}: installed but not enabled in this world`);
    P.socketlib = "not enabled";
  }
  return active ? manifest : null;
}

function fail(err) {
  console.error(`${MODULE_ID} |`, err);
  const box = document.querySelector(".pocket5e-boot");
  if ( !box ) return;
  const msg = document.createElement("p");
  msg.className = "pocket5e-error";
  msg.textContent = err?.message ?? String(err);
  const link = document.createElement("a");
  link.href = route("join");
  link.textContent = "Foundry VTT →";
  box.append(msg, link);
}

async function boot() {
  const P = globalThis.POCKET5E;
  await P.domReady;
  applyTheme();          // from localStorage — before any Foundry code, so the boot/login screens match
  watchSystemTheme();

  // 1. Core stylesheets + vendor scripts exactly as the server's pages list them, then the client library itself —
  //    a dynamic import after DOMContentLoaded (see file header).
  setStatus("Foundry VTT…");
  P.coreAssets = await loadCoreAssets();
  const core = await import(route("scripts/foundry.mjs"));
  const Game = core.Game ?? foundry.Game;
  log(`core ${game.release?.version ?? foundry.CONST?.vtt ?? ""} loaded in ${Math.round(performance.now() - P.t0)} ms`);

  // 2. No WebGL canvas, no side effects.
  MobileMode.forceNoCanvas();
  patchCore();
  // Mirrors core's bootstrap; PIXI probes WebGL here, which some browsers (headless, restricted WebViews) lack.
  // The app never draws with PIXI, so a failure is only worth a warning.
  try {
    const basePath = PREFIX ? `${window.location.origin}${PREFIX}` : window.location.origin;
    await PIXI.Assets.init({ basePath, preferences: { defaultAutoPlay: false } });
  } catch(err) {
    console.warn(`${MODULE_ID} | PIXI.Assets.init skipped:`, err?.message ?? err);
  }

  // 3. Session + socket.
  //    A session cookie must exist before connecting: on v14 Game.connect() reloads the page if the socket
  //    handshake carries no session. HEAD /game mints (or refreshes) that cookie and — unlike GET /join —
  //    never logs the world session out, so it is safe to call on every load, including after login.
  //    The cookie is HttpOnly on v14 (invisible to scripts, travels with the WebSocket handshake) and readable
  //    on v13, where Game.connect(sessionId) still wants the value.
  setStatus("Connecting…");
  //    redirect:"manual" is essential: when not yet logged in, /game answers 302 → /join; following it would hit
  //    the logout-on-/join handler. The Set-Cookie on that 302 is still applied by the browser, so the cookie is
  //    minted without ever touching /join.
  await fetch(route("game"), { method: "HEAD", credentials: "same-origin", redirect: "manual", cache: "no-store" }).catch(() => {});
  const legacySession = Game.connect.length >= 1;
  let sessionId = Game.getCookies?.().session ?? null;
  const socket = legacySession ? await Game.connect(sessionId) : await Game.connect();
  sessionId ??= socket.session?.sessionId ?? null;

  // 4. Not logged in → login screen; it reloads the page on success.
  if ( !socket.session.userId ) {
    log("no user on session — showing login");
    await showLogin(socket, route);
    return;
  }

  // 5. System, our hooks, world data, Game.
  setStatus("dnd5e…");
  P.tSystem = performance.now();
  await Promise.all([
    loadStyle(route("systems/dnd5e/dnd5e.css")),
    import(route("systems/dnd5e/dnd5e.mjs"))
  ]);
  await import("../main.js");

  setStatus("World…");
  P.tWorld = performance.now();
  const data = await Game.getData(socket, "game");
  P.tData = performance.now();
  P.payloadBytes = JSON.stringify(data).length;
  // Which collections weigh the most — surfaces worlds where a module stuffed megabytes into settings.
  P.payloadBreakdown = Object.entries(data)
    .map(([key, value]) => [key, (() => { try { return JSON.stringify(value)?.length ?? 0; } catch(err) { return 0; } })()])
    .sort((a, b) => b[1] - a[1]);
  log(`world payload ≈ ${(P.payloadBytes / 1048576).toFixed(1)} MB (JSON) in ${Math.round(P.tData - P.tWorld)} ms`,
    P.payloadBreakdown.slice(0, 5).map(([k, n]) => `${k} ${(n / 1048576).toFixed(1)} MB`).join(", "));

  // 6. socketlib — the one foreign module the app loads: midi-qol and Chris's Premades address the player's client
  //    through it (reaction prompts, saves, dialogs) and hang without an answer. Tiny and canvas-free; bridge.js
  //    registers the handlers. Its init hook fires inside game.initialize(), so it must be imported before that.
  const socketlibManifest = moduleActiveInPayload(data, "socketlib");
  if ( socketlibManifest ) {
    const paths = socketlibManifest.esmodules?.length ? socketlibManifest.esmodules : ["src/socketlib.js"];
    for ( const path of paths ) {
      try {
        await import(route(`modules/socketlib/${path}`));
        P.socketlib = `loaded ${socketlibManifest.version ?? ""} (${path})`;
        log(`socketlib ${P.socketlib}`);
      } catch(err) {
        P.socketlib = `import failed: ${err?.message ?? err}`;
        console.warn(`${MODULE_ID} | socketlib not loaded (${path}):`, err?.message ?? err);
      }
    }
  }
  else P.socketlib ??= "skipped";

  globalThis.game = (Game.length >= 4) ? new Game("game", data, sessionId, socket) : new Game("game", data, socket);
  await game.initialize();
  P.tReady = performance.now();
  log(`ready in ${Math.round(P.tReady - P.t0)} ms`);
}

boot().catch(fail);
