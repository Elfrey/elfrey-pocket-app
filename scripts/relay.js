/**
 * GM relay — runs an item/activity use on the GM's client instead of the phone.
 *
 * Why: the app loads only the core client and dnd5e, never other modules. midi-qol (and DAE, CPR, animations…)
 * wraps Activity#use on the client that *starts* the use, so a use started on the phone produces a plain dnd5e card
 * and midi never sees it. Executed on the GM's client — where those modules live — the full workflow runs: attack and
 * damage rolls, saves for the targets, damage application, effects.
 *
 * Protocol (socket channel "module.<id>", plain game.socket — no socketlib needed for this part):
 *   phone → { type: "use", v, id, userId, gmId, actorUuid, itemId, activityId|null, targetUuids, advantage,
 *             disadvantage, rollMode, reaction, awaitCompletion, usage?, dialog? }
 *   GM    → { type: "useResult", id, ok: true,  stage: "accepted" }   validated, execution started
 *   GM    → { type: "useResult", id, ok: true,  stage: "done" }       workflow finished (reactions wait for this)
 *   GM    → { type: "useResult", id, ok: false, stage, error }        rejected, or failed during execution
 *   phone → { type: "targets", v, id, userId, gmId, actorUuid, itemId?, activityId? }
 *   GM    → { type: "targetsResult", id, ok, tokens: [{ uuid, name, img, disposition, isSelf, visible, distance,
 *             range: "normal"|"long"|"out"|null }], units, sceneName, hasObserver }
 *           — candidates for the target picker, judged on the GM's canvas: what the character's token can see
 *             (MidiQOL.canSee, else a wall check) and how far / whether within the activity's range
 *             (MidiQOL.checkActivityRange, else dnd5e range fields against the grid measurement).
 *
 * Only the designated GM (game.users.activeGM — the same answer on every client) executes, so two GMs never
 * double-cast. The GM validates ownership, resolves the targets on its own canvas and calls
 * MidiQOL.completeActivityUse() / completeItemUse() when midi is present, plain dnd5e use with temporary targets
 * otherwise.
 *
 * Both halves live here; main.js registers the GM side in the regular /game client and the client side in the app.
 * bridge.js builds on this to answer midi-qol's reaction prompts and CPR's remote item rolls from the phone.
 */
import { MODULE_ID, SETTINGS, RELAY } from "./settings.js";

export const RELAY_CHANNEL = `module.${MODULE_ID}`;
export const RELAY_VERSION = 2;
/** How long the phone waits for the GM to accept a request. */
const ACCEPT_TIMEOUT_MS = 15_000;
/** How long a caller that asked for completion waits for the workflow to finish (saves, reactions of others…). */
const COMPLETE_TIMEOUT_MS = 180_000;

const L = key => game.i18n.localize(key);
const log = (...args) => console.log(`${MODULE_ID} | relay |`, ...args);

/* -------------------------------------------- */
/*  Availability                                */
/* -------------------------------------------- */

export function relayMode() {
  try { return game.settings.get(MODULE_ID, SETTINGS.RELAY) ?? RELAY.AUTO; } catch(err) { return RELAY.AUTO; }
}

/** midi-qol is enabled in the world — the phone knows this without loading it (module config travels with the world). */
export function midiActive() {
  return game.modules.get("midi-qol")?.active === true;
}

/** The GM every client agrees on (core picks the same active GM everywhere); null when no GM is connected. */
export function designatedGM() {
  return game.users?.activeGM ?? null;
}

/** Should uses go through the GM at all (setting + midi presence)? Independent of who is online. */
export function relayEnabled() {
  const mode = relayMode();
  if ( mode === RELAY.OFF ) return false;
  if ( mode === RELAY.ON ) return true;
  return midiActive();
}

/** Does this activity want targets picked before it is used? Self/none → no; anything else, or a template → yes. */
export function needsTargets(activity) {
  const target = activity?.target;
  if ( !target ) return false;
  if ( target.template?.type ) return true;
  const affects = target.affects?.type;
  return !!affects && (affects !== "self");
}

/* -------------------------------------------- */
/*  Phone side                                  */
/* -------------------------------------------- */

/** requestId → { resolve, reject, timer, awaitCompletion } */
const pending = new Map();

export function registerRelayClient() {
  game.socket.on(RELAY_CHANNEL, onClientMessage);
}

function onClientMessage(msg) {
  if ( !["useResult", "targetsResult"].includes(msg?.type) ) return;
  const entry = pending.get(msg.id);
  if ( !entry ) {
    // A failure reported after the request was already answered (the workflow itself broke): just tell the player.
    if ( (msg.type === "useResult") && (msg.ok === false) && msg.error && (msg.userId === game.user.id) ) ui.notifications.warn(msg.error);
    return;
  }
  if ( !msg.ok ) {
    settle(msg.id, entry, () => entry.reject(new Error(msg.error || L("POCKET5E.Relay.Failed"))));
    return;
  }
  if ( (msg.stage === "accepted") && entry.awaitCompletion ) {
    // Keep waiting, but for the workflow now — with the longer budget.
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => settle(msg.id, entry, () => entry.reject(new Error(L("POCKET5E.Relay.CompleteTimeout")))), COMPLETE_TIMEOUT_MS);
    return;
  }
  settle(msg.id, entry, () => entry.resolve(msg));
}

function settle(id, entry, fn) {
  clearTimeout(entry.timer);
  pending.delete(id);
  fn();
}

/**
 * Ask the designated GM to use `activity` (or a whole item) on behalf of this user.
 * Resolves once the GM has accepted the request — or, with `awaitCompletion`, once the workflow finished.
 * The chat card arrives through the normal document sync either way.
 * @param {Activity|null} activity          The activity to use; null with `options.item` for an item-level use.
 * @param {object} [options]
 * @param {Item5e} [options.item]           Item to use when no activity is given (midi picks / asks the GM).
 * @param {string[]} [options.targetUuids]  TokenDocument uuids chosen in the app (may be empty).
 * @param {boolean} [options.advantage]
 * @param {boolean} [options.disadvantage]
 * @param {string} [options.rollMode]       Roll visibility for the created messages.
 * @param {boolean} [options.reaction]      This use is a reaction (midi flags the workflow, no target confirmation).
 * @param {boolean} [options.awaitCompletion]
 * @param {object} [options.usage]          Extra dnd5e/midi usage config merged on the GM (serializable only).
 * @param {object} [options.dialog]         Extra dialog config merged on the GM.
 */
export async function requestUse(activity, { item, targetUuids=[], advantage=false, disadvantage=false, rollMode, reaction=false,
  awaitCompletion=false, usage, dialog }={}) {
  const gm = designatedGM();
  if ( !gm ) throw new Error(L("POCKET5E.Relay.NoGM"));
  item ??= activity?.item;
  const actor = item?.actor;
  if ( !actor || !item.isEmbedded ) throw new Error(L("POCKET5E.Relay.NotFound"));

  const id = foundry.utils.randomID();
  const request = {
    type: "use", v: RELAY_VERSION, id,
    userId: game.user.id, gmId: gm.id,
    actorUuid: actor.uuid, itemId: item.id, activityId: activity?.id ?? null,
    targetUuids: Array.from(targetUuids ?? []),
    advantage: !!advantage, disadvantage: !!disadvantage,
    rollMode: rollMode ?? null,
    reaction: !!reaction, awaitCompletion: !!awaitCompletion
  };
  if ( usage && !foundry.utils.isEmpty(usage) ) request.usage = usage;
  if ( dialog && !foundry.utils.isEmpty(dialog) ) request.dialog = dialog;

  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(game.i18n.format("POCKET5E.Relay.Timeout", { name: gm.name })));
    }, ACCEPT_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer, awaitCompletion: !!awaitCompletion });
  });
  log("→", item.name, activity ? (activity.name || activity.type) : "(item)",
    request.targetUuids.length ? `targets ${request.targetUuids.length}` : "no targets", reaction ? "reaction" : "");
  game.socket.emit(RELAY_CHANNEL, request);
  return result;
}

/**
 * Ask the designated GM which tokens the character can target right now: visibility and range are judged on the
 * GM's canvas (the phone has none). Resolves with the reply, or null when no GM / no answer in time.
 * @param {Actor} actor
 * @param {Activity|null} [activity]
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 */
export async function queryTargets(actor, activity=null, { timeoutMs=4000 }={}) {
  const gm = designatedGM();
  if ( !gm || !actor ) return null;
  const id = foundry.utils.randomID();
  const request = {
    type: "targets", v: RELAY_VERSION, id, userId: game.user.id, gmId: gm.id,
    actorUuid: actor.uuid, itemId: activity?.item?.id ?? null, activityId: activity?.id ?? null
  };
  const result = new Promise(resolve => {
    const timer = setTimeout(() => { pending.delete(id); resolve(null); }, timeoutMs);
    pending.set(id, { resolve, reject: () => { pending.delete(id); clearTimeout(timer); resolve(null); }, timer, awaitCompletion: false });
  });
  game.socket.emit(RELAY_CHANNEL, request);
  const reply = await result;
  if ( reply && (reply.ok === false) ) {
    log("targets query refused:", reply.error);
    return null;
  }
  return reply;
}

/* -------------------------------------------- */
/*  GM side (regular /game client)              */
/* -------------------------------------------- */

export function registerRelayGM() {
  if ( !game.user.isGM ) return;
  game.socket.on(RELAY_CHANNEL, msg => {
    if ( msg?.type === "use" ) handleUse(msg);
    else if ( msg?.type === "targets" ) handleTargets(msg);
  });
  log(`GM handler ready (midi-qol ${globalThis.MidiQOL ? "present" : "absent"})`);
}

/** Is this GM the one that should execute `msg`? The addressee, or the current designated GM if the addressee left. */
function addressedToMe(msg) {
  const me = game.user.id;
  if ( msg.gmId === me ) return true;
  const addressee = game.users.get(msg.gmId);
  return (designatedGM()?.id === me) && !addressee?.active;
}

async function handleUse(msg) {
  if ( !addressedToMe(msg) ) return;
  const reply = data => game.socket.emit(RELAY_CHANNEL, { type: "useResult", id: msg.id, userId: msg.userId, ...data });

  let item, activity, targets, user;
  try {
    if ( msg.v !== RELAY_VERSION ) throw new Error(`relay protocol v${msg.v} ≠ v${RELAY_VERSION} — update the module on both sides`);
    user = game.users.get(msg.userId);
    if ( !user ) throw new Error(L("POCKET5E.Relay.Denied"));
    const actor = resolveActor(msg.actorUuid);
    if ( !actor?.testUserPermission(user, "OWNER") ) throw new Error(L("POCKET5E.Relay.Denied"));
    item = actor.items.get(msg.itemId);
    if ( !item ) throw new Error(L("POCKET5E.Relay.NotFound"));
    if ( msg.activityId ) {
      activity = item.system?.activities?.get(msg.activityId);
      if ( !activity ) throw new Error(L("POCKET5E.Relay.NotFound"));
    }
    targets = resolveTargets(msg.targetUuids ?? []);
    if ( msg.targetUuids?.length && !targets.length ) throw new Error(L("POCKET5E.Relay.SceneMismatch"));
  } catch(err) {
    console.warn(`${MODULE_ID} | relay | rejected:`, err);
    reply({ ok: false, stage: "rejected", error: err?.message ?? String(err) });
    return;
  }

  reply({ ok: true, stage: "accepted" });
  log("←", user.name, msg.reaction ? "reacts with" : "uses", item.name, activity ? (activity.name || activity.type) : "", targets.map(t => t.name));

  // The card is authored by the player: it shows up as theirs in chat, and roll visibility follows their choice.
  const message = {
    rollMode: msg.rollMode || undefined,
    data: { author: user.id, flags: { [MODULE_ID]: { relay: { userId: user.id, reaction: !!msg.reaction } } } }
  };
  // Dialogs would open on the GM's screen — never ask: the player already made those choices on the phone and
  // they travel in msg.usage (spell slot, consumption, concentration — PLAN.md, phase 10.2).
  const dialog = foundry.utils.mergeObject({ configure: false }, msg.dialog ?? {});

  try {
    if ( globalThis.MidiQOL?.completeActivityUse ) {
      const usage = foundry.utils.mergeObject(foundry.utils.deepClone(msg.usage ?? {}), {
        midiOptions: {
          targetUuids: targets.map(t => t.uuid),
          ignoreUserTargets: true,            // never mix in whatever the GM happens to have targeted
          checkGMstatus: false,
          isReaction: !!msg.reaction,
          workflowOptions: {
            advantage: !!msg.advantage,
            disadvantage: !!msg.disadvantage,
            autoRollAttack: true,             // the player already pressed "use" — no attack prompt on the GM's screen
            fastForwardAttack: true,
            fastForwardDamage: true,          // damage auto-roll itself follows the GM's midi settings
            targetConfirmation: "none"        // targets were chosen on the phone; no confirmation window for the GM
          }
        }
      }, { overwrite: false });               // a usage config from the requester (CPR) keeps its own midiOptions
      if ( msg.reaction ) message.systemCard = false;   // as midi's own reaction dialog does
      if ( activity ) await MidiQOL.completeActivityUse(activity, usage, dialog, message);
      else await MidiQOL.completeItemUse(item, usage, dialog, message);
    }
    else {
      await withTemporaryTargets(targets, () => activity ? activity.use(msg.usage ?? {}, dialog, message) : item.use(msg.usage ?? {}, dialog, message));
    }
    reply({ ok: true, stage: "done" });
  } catch(err) {
    console.error(`${MODULE_ID} | relay | use failed:`, err);
    reply({ ok: false, stage: "failed", error: game.i18n.format("POCKET5E.Relay.Failed", { error: err?.message ?? String(err) }) });
  }
}

/**
 * Target candidates for the phone's picker, judged from the character's token on the GM's viewed scene.
 * Hidden tokens are never listed. Without a token of the character on the scene, everything is listed unjudged.
 */
function handleTargets(msg) {
  if ( !addressedToMe(msg) ) return;
  const reply = data => game.socket.emit(RELAY_CHANNEL, { type: "targetsResult", id: msg.id, userId: msg.userId, ...data });
  try {
    const user = game.users.get(msg.userId);
    const actor = resolveActor(msg.actorUuid);
    if ( !user || !actor?.testUserPermission(user, "OWNER") ) throw new Error(L("POCKET5E.Relay.Denied"));
    if ( !canvas?.ready || !canvas.scene ) throw new Error(L("POCKET5E.Relay.NoScene"));
    const item = msg.itemId ? actor.items.get(msg.itemId) : null;
    const activity = (item && msg.activityId) ? (item.system?.activities?.get(msg.activityId) ?? null) : null;
    const observer = canvas.tokens.placeables.find(t => (t.actor === actor) || (t.document.actorId === actor.id)) ?? null;
    const midi = globalThis.MidiQOL;

    const tokens = [];
    for ( const t of canvas.tokens.placeables ) {
      if ( t.document.hidden ) continue;
      const isSelf = t === observer;
      let visible = true, distance = null, range = null;
      if ( observer && !isSelf ) {
        visible = (typeof midi?.canSee === "function") ? !!midi.canSee(observer, t) : hasLineOfSight(observer, t);
        distance = (typeof midi?.computeDistance === "function")
          ? midi.computeDistance(observer, t, { wallsBlock: false })
          : canvas.grid.measurePath([observer.center, t.center]).distance;
        if ( activity && visible ) range = rangeClass(activity, observer, t, midi);
      }
      tokens.push({
        uuid: t.document.uuid, name: playerFacingName(t), img: t.document.texture?.src ?? null,
        disposition: t.document.disposition, isSelf, visible,
        distance: Number.isFinite(distance) && (distance >= 0) ? Math.round(distance * 10) / 10 : null,
        range
      });
    }
    // Players know scenes by their navigation name; the real title may spoil ("Ambush at the bridge").
    const sceneName = canvas.scene.navName || canvas.scene.name;
    reply({ ok: true, sceneName, units: canvas.scene.grid.units || "", hasObserver: !!observer, tokens });
  } catch(err) {
    console.warn(`${MODULE_ID} | relay | targets query rejected:`, err);
    reply({ ok: false, error: err?.message ?? String(err) });
  }
}

/**
 * The token's name as the players see it: Hide NPC Names (game.hnn) and Anonymous (module api) replace NPC names
 * on the canvas and in chat; the picker must not leak the real one. Player-owned actors are never renamed.
 */
function playerFacingName(token) {
  const name = token.document.name;
  const actor = token.actor;
  if ( !actor || actor.hasPlayerOwner ) return name;
  if ( game.modules.get("hide-npc-names")?.active && (typeof game.hnn?.getReplacementInfo === "function") ) {
    try {
      const info = game.hnn.getReplacementInfo(actor, name);
      if ( info?.shouldReplace ) return info.replacementName || name;
    } catch(err) { /* fall through */ }
  }
  const anonymous = game.modules.get("anonymous");
  if ( anonymous?.active && anonymous.api ) {
    try {
      if ( !anonymous.api.playersSeeName(actor) ) return anonymous.api.getName(actor) || name;
    } catch(err) { /* fall through */ }
  }
  return name;
}

/** Sight-blocking walls between two token centres (the vanilla stand-in for midi's canSee). */
function hasLineOfSight(a, b) {
  const backend = CONFIG.Canvas?.polygonBackends?.sight;
  if ( typeof backend?.testCollision !== "function" ) return true;
  try { return !backend.testCollision(a.center, b.center, { type: "sight", mode: "any" }); }
  catch(err) { return true; }
}

/**
 * "normal" | "long" (disadvantage range) | "out" | null (the activity has no range to judge). midi's own check
 * when present — the same verdict the workflow will apply — else dnd5e's range fields against the grid measurement.
 */
function rangeClass(activity, observer, target, midi) {
  if ( typeof midi?.checkActivityRange === "function" ) {
    try {
      const result = midi.checkActivityRange(activity, observer, new Set([target]), false)?.result;
      if ( result === "normal" ) return "normal";
      if ( result === "dis" ) return "long";
      if ( result === "fail" ) return "out";
    } catch(err) { /* fall through to the vanilla check */ }
  }
  const rg = activity.range;
  if ( !rg ) return null;
  let range = Number(rg.value || rg.reach || 0);
  let long = Number(rg.long || 0);
  if ( rg.units === "touch" ) {
    range = Number(activity.item?.system?.range?.reach) || canvas.dimensions?.distance || 5;
    long = 0;
  }
  if ( !range && !long ) return null;                       // self / any / special / unset
  if ( long && (long < range) ) long = range;
  const d = canvas.grid.measurePath([observer.center, target.center]).distance;
  if ( d <= range ) return "normal";
  if ( long && (d <= long) ) return "long";
  return "out";
}

/** "Actor.X" or a token uuid → the Actor. */
function resolveActor(uuid) {
  const doc = fromUuidSync(uuid);
  if ( !doc ) return null;
  return doc.documentName === "Actor" ? doc : (doc.actor ?? null);
}

/**
 * TokenDocuments for the requested uuids that exist on the GM's *viewed* scene — midi and dnd5e need Token
 * objects, which only exist for the scene on the canvas. Tokens on other scenes are dropped (the caller reports it).
 */
function resolveTargets(uuids) {
  const out = [];
  for ( const uuid of uuids ) {
    const doc = fromUuidSync(uuid);
    if ( doc?.documentName !== "Token" ) continue;
    if ( !doc.object || (doc.parent !== canvas?.scene) ) continue;
    out.push(doc);
  }
  return out;
}

/** Vanilla fallback (no midi): target for the GM while the use runs, then put the GM's own targets back. */
async function withTemporaryTargets(targets, fn) {
  const saved = Array.from(game.user.targets ?? []).map(t => t.id);
  setUserTargets(targets.map(t => t.id));
  try { return await fn(); }
  finally { setUserTargets(saved); }
}

/** Replace the local user's targets by token id — TokenLayer#setTargets (v13/v14), with the User-side updater as a guard. */
function setUserTargets(ids) {
  if ( typeof canvas?.tokens?.setTargets === "function" ) return canvas.tokens.setTargets(ids);
  game.user._onUpdateTokenTargets?.(ids);
  game.user.broadcastActivity?.({ targets: ids });
}
