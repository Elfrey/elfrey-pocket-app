/**
 * Instant start — the last sheet this phone showed, from the browser, while the world loads (PLAN.md, phase 11).
 *
 * Loading the world payload takes most of the ~25 s to readiness, and a player who opens the app to check their
 * AC waits all of it. The same phone almost always shows the same character to the same player, so the shell as
 * it looked last time is stored locally and put on screen immediately, read-only, then replaced — silently, on
 * the same tab — by the live shell.
 *
 * What is stored is the rendered shell markup, not a render context: our templates call the {{localize}} helper
 * and are registered as named partials, so drawing them again would need game.i18n and the partial registry —
 * exactly the parts of the boot we are skipping. Markup needs nothing but the stylesheet, which app.html already
 * carries. Everything interactive is disabled: there is no Foundry underneath to take an action.
 *
 * Alongside the markup each record carries the item details (description, badges, activities), so tapping a spell
 * or a piece of gear opens its card right away — reading is the reason most players open the app at all.
 *
 * Storage is IndexedDB (localStorage is synchronous and ~5 MB); one record per world+user+actor, with a pointer
 * to the last one in localStorage so the boot can find it before any Foundry code exists.
 */
import { MODULE_ID } from "./settings.js";

/** Bump when the stored markup or record shape changes — older records are then dropped unread. */
const SCHEMA = 3;
const DB_NAME = `${MODULE_ID}.cache`;
const STORE = "snapshots";
const POINTER = `${MODULE_ID}.snapshotKey`;
const NOTICE_OFF = `${MODULE_ID}.snapshotNoticeOff`;
/** A snapshot older than this is not worth showing — the sheet has probably moved on. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const log = (...args) => console.log(`${MODULE_ID} |`, ...args);

export const snapshotKey = (worldId, userId, actorId) => `${worldId}:${userId}:${actorId}`;

/* -------------------------------------------- */
/*  Storage                                     */
/* -------------------------------------------- */

let dbPromise = null;

function openDB() {
  if ( dbPromise ) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if ( !globalThis.indexedDB ) return reject(new Error("IndexedDB unavailable"));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if ( !db.objectStoreNames.contains(STORE) ) db.createObjectStore(STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(err => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function transact(mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    tx.onabort = tx.onerror = () => reject(tx.error);
    if ( request ) request.onsuccess = () => resolve(request.result);
    else tx.oncomplete = () => resolve();
  }));
}

/** Store one snapshot and point the next boot at it. Failures are never fatal — the app just starts as before. */
export async function writeSnapshot(record) {
  try {
    await transact("readwrite", store => store.put({ ...record, schema: SCHEMA }));
    localStorage.setItem(POINTER, record.key);
  } catch(err) {
    console.warn(`${MODULE_ID} | snapshot not stored:`, err?.message ?? err);
  }
}

/** The snapshot the pointer names, if it is still usable. */
export async function readSnapshot() {
  let key;
  try { key = localStorage.getItem(POINTER); } catch(err) { return null; }
  if ( !key ) return null;
  try {
    const record = await transact("readonly", store => store.get(key));
    if ( !record ) return null;
    if ( record.schema !== SCHEMA ) {                       // written by another version of this file
      await dropSnapshot(key);
      return null;
    }
    if ( (Date.now() - (record.savedAt ?? 0)) > MAX_AGE_MS ) return null;
    return record;
  } catch(err) {
    console.warn(`${MODULE_ID} | snapshot not read:`, err?.message ?? err);
    return null;
  }
}

export async function dropSnapshot(key) {
  try {
    await transact("readwrite", store => store.delete(key));
    if ( localStorage.getItem(POINTER) === key ) localStorage.removeItem(POINTER);
  } catch(err) { /* nothing to do */ }
}

/* -------------------------------------------- */
/*  Display                                     */
/* -------------------------------------------- */

const ELEMENT_ID = "pocket5e-snapshot";

/** Is a snapshot on screen right now? */
export function snapshotShown() {
  return !!document.getElementById(ELEMENT_ID);
}

/**
 * Put a stored snapshot on screen: the shell as it was, plus a bar saying how old it is. Tabs still switch;
 * everything else is inert, because there is no game to act on yet.
 * @param {object} record
 * @returns {boolean}   Whether it was shown.
 */
export function showSnapshot(record) {
  const root = document.getElementById("pocket5e-root");
  if ( !root || !record?.html || snapshotShown() ) return false;

  let shell;
  try {
    const parsed = new DOMParser().parseFromString(record.html, "text/html");
    shell = parsed.body.firstElementChild;
  } catch(err) {
    return false;
  }
  if ( !shell ) return false;

  // The live shell will claim these ids when it renders — the snapshot must not answer to them in the meantime.
  shell.removeAttribute("id");
  for ( const el of shell.querySelectorAll("[id]") ) el.id = `snap-${el.id}`;
  // Fields are disabled outright; buttons stay clickable so the tap can be answered — a disabled button fires
  // no event at all, and silence looks like a broken app. Nothing is wired to them: this is detached markup.
  shell.querySelectorAll("input, select, textarea").forEach(el => { el.disabled = true; });

  const wrapper = document.createElement("div");
  wrapper.id = ELEMENT_ID;
  wrapper.className = "pocket5e-snapshot";
  wrapper.append(banner(record), shell);

  root.querySelector(".pocket5e-boot")?.classList.add("pocket5e-hidden");
  root.append(wrapper);
  startClock(wrapper, record.strings?.elapsed ?? "{n} s");
  wireTabs(wrapper, record);
  showNotice(wrapper, record);

  const P = globalThis.POCKET5E;
  if ( P ) {
    P.tCacheShown = performance.now();
    P.snapshotStrings = record.strings ?? null;      // the boot writes its progress with these
  }
  log(`snapshot shown (${Math.round((record.html.length / 1024))} KB, saved ${new Date(record.savedAt).toLocaleString()})`);
  return true;
}

/** Remove the snapshot — the live shell is taking over, or it turned out to belong to somebody else. */
export function hideSnapshot() {
  document.getElementById(ELEMENT_ID)?.remove();
  document.querySelector("#pocket5e-root .pocket5e-boot")?.classList.remove("pocket5e-hidden");
}

/** Mirror the boot's progress into the snapshot bar, so the player sees which step is running. */
export function setSnapshotStatus(text) {
  const el = document.querySelector(`#${ELEMENT_ID} .pocket5e-snapshot-status`);
  if ( el && text ) el.textContent = text;
}

/** The strings stored with the snapshot on screen — the boot uses them for its own status line. */
export function snapshotStrings() {
  return globalThis.POCKET5E?.snapshotStrings ?? null;
}

/**
 * The bar above the cached sheet: how old the data is, which step of the boot is running, and how long it has
 * been running. The progress line is deliberately indeterminate — loading the world is one long step, and a bar
 * frozen at "60%" for twenty seconds says less than an honest "still working".
 */
function banner(record) {
  const strings = record.strings ?? {};
  const time = new Date(record.savedAt ?? Date.now())
    .toLocaleString(record.lang, { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
  const bar = document.createElement("div");
  bar.className = "pocket5e-snapshot-bar";
  bar.innerHTML = `<div class="pocket5e-snapshot-line">`
    + `<i class="fa-solid fa-clock-rotate-left"></i>`
    + `<span class="pocket5e-snapshot-age"></span>`
    + `<span class="pocket5e-snapshot-status"></span>`
    + `<span class="pocket5e-snapshot-elapsed"></span>`
    + `</div><div class="pocket5e-snapshot-progress"><i></i></div>`;
  bar.querySelector(".pocket5e-snapshot-age").textContent = (strings.savedAt ?? "{time}").replace("{time}", time);
  bar.querySelector(".pocket5e-snapshot-status").textContent = strings.stages?.core ?? strings.updating ?? "…";
  return bar;
}

/** Seconds since the page started loading, ticking in the bar. Started once the bar is in the document. */
function startClock(wrapper, format) {
  const started = globalThis.POCKET5E?.t0 ?? performance.now();
  const el = wrapper.querySelector(".pocket5e-snapshot-elapsed");
  if ( !el ) return;
  const tick = () => {
    if ( !el.isConnected ) return clearInterval(timer);   // the live sheet took over
    el.textContent = format.replace("{n}", String(Math.max(0, Math.round((performance.now() - started) / 1000))));
  };
  const timer = setInterval(tick, 1000);
  tick();
}

/**
 * A word about what the player is looking at, once: the sheet is real but frozen, and the buttons come back when
 * the world arrives. Dismissed for good with the checkbox — it is only news the first time.
 */
function showNotice(wrapper, record) {
  const strings = record.strings?.notice;
  if ( !strings ) return;
  try { if ( localStorage.getItem(NOTICE_OFF) === "1" ) return; } catch(err) { /* private mode: just show it */ }

  const notice = document.createElement("div");
  notice.className = "pocket5e-drawer pocket5e-snapshot-notice";
  notice.innerHTML = `<section class="pocket5e-drawer-panel">
    <header class="pocket5e-drawer-head"><div class="pocket5e-row2-info"><strong></strong></div></header>
    <div class="pocket5e-drawer-body">
      <p class="pocket5e-snapshot-notice-text"></p>
      <label class="pocket5e-remote-row"><span class="name"></span><input type="checkbox"></label>
    </div>
    <footer class="pocket5e-targets-foot pocket5e-reaction-foot">
      <button type="button" class="pocket5e-btn pocket5e-btn-primary"></button>
    </footer>
  </section>`;
  notice.querySelector("strong").textContent = strings.title ?? "";
  notice.querySelector(".pocket5e-snapshot-notice-text").textContent = strings.text ?? "";
  notice.querySelector("label .name").textContent = strings.dontShow ?? "";
  const button = notice.querySelector("footer button");
  button.textContent = strings.ok ?? "OK";
  const dismiss = () => {
    if ( notice.querySelector("input[type=checkbox]").checked ) {
      try { localStorage.setItem(NOTICE_OFF, "1"); } catch(err) { /* ignore */ }
    }
    notice.remove();
  };
  button.addEventListener("click", dismiss);
  notice.addEventListener("click", event => { if ( event.target === notice ) dismiss(); });
  wrapper.append(notice);
}

/**
 * Tabs keep working while the snapshot is up — every tab was rendered into the stored markup, so switching is
 * only a class swap. The "More" button has no popup here (its menu is context-driven), so it opens its tab.
 * Any other control flashes the bar instead of doing nothing silently.
 */
function wireTabs(wrapper, record) {
  wrapper.addEventListener("click", event => {
    const button = event.target.closest("[data-tab], [data-action]");
    event.preventDefault();
    if ( button?.dataset?.action === "openItem" ) {
      const id = button.closest("[data-item-id]")?.dataset.itemId;
      if ( showDetails(wrapper, record, id) ) return;
    }
    const tab = button?.dataset?.tab;
    if ( !tab ) return flashBar(wrapper);
    for ( const panel of wrapper.querySelectorAll(".pocket5e-tab[data-tab]") ) {
      panel.classList.toggle("active", panel.dataset.tab === tab);
    }
    for ( const btn of wrapper.querySelectorAll(".pocket5e-tabbtn[data-tab]") ) {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    }
  }, true);
}

/**
 * The item card, read-only, from what was stored with the snapshot: description, badges and the list of
 * activities. Everything that would change the world is left out — there is nothing to change it in yet.
 * @returns {boolean}   Whether a card was opened.
 */
function showDetails(wrapper, record, itemId) {
  const item = record?.details?.[itemId];
  if ( !item ) return false;
  const strings = record.strings ?? {};
  wrapper.querySelector(".pocket5e-snapshot-drawer")?.remove();

  const drawer = document.createElement("div");
  drawer.className = "pocket5e-drawer pocket5e-snapshot-drawer";
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if ( cls ) node.className = cls;
    if ( text !== undefined ) node.textContent = text;
    return node;
  };

  const panel = el("section", "pocket5e-drawer-panel");
  const head = el("header", "pocket5e-drawer-head");
  if ( item.img ) {
    const img = document.createElement("img");
    img.src = item.img;
    img.alt = "";
    head.append(img);
  }
  const info = el("div", "pocket5e-row2-info");
  info.append(el("strong", null, item.name ?? ""), el("small", null, item.subtitle ?? ""));
  const close = el("button", "pocket5e-iconbtn");
  close.type = "button";
  close.innerHTML = `<i class="fa-solid fa-xmark"></i>`;
  close.addEventListener("click", () => drawer.remove());
  head.append(info, close);

  const body = el("div", "pocket5e-drawer-body");
  if ( item.badges?.length ) {
    const badges = el("div", "pocket5e-badges");
    for ( const text of item.badges ) badges.append(el("span", "pocket5e-badge", text));
    body.append(badges);
  }
  if ( item.activities?.length ) {
    const card = el("div", "pocket5e-card");
    card.append(el("h2", null, strings.activities ?? ""));
    const list = el("ul", "pocket5e-snapshot-activities");
    for ( const a of item.activities ) {
      const row = el("li");
      row.append(el("strong", null, a.name ?? ""));
      if ( a.meta ) row.append(el("small", null, a.meta));
      list.append(row);
    }
    card.append(list);
    body.append(card);
  }
  const desc = el("div", "pocket5e-card pocket5e-desc");
  desc.append(el("h2", null, strings.description ?? ""));
  if ( item.description ) {
    const holder = document.createElement("div");
    holder.innerHTML = item.description;          // the player's own world content, as the live card shows it
    desc.append(holder);
  }
  else desc.append(el("p", "pocket5e-muted", "—"));
  body.append(desc);

  panel.append(head, body);
  drawer.append(panel);
  drawer.addEventListener("click", event => { if ( event.target === drawer ) drawer.remove(); });
  wrapper.append(drawer);
  return true;
}

function flashBar(wrapper) {
  const bar = wrapper.querySelector(".pocket5e-snapshot-bar");
  if ( !bar ) return;
  bar.classList.remove("flash");
  void bar.offsetWidth;               // restart the animation
  bar.classList.add("flash");
}
