/**
 * GM relay — runs an item/activity use on the GM's client instead of the phone.
 *
 * Why: the app loads only the core client and dnd5e, never other modules. midi-qol (and DAE, CPR, animations…)
 * wraps Activity#use on the client that *starts* the use, so a use started on the phone produces a plain dnd5e card
 * and midi never sees it. Executed on the GM's client — where those modules live — the full workflow runs: attack and
 * damage rolls, saves for the targets, damage application, effects.
 *
 * Protocol (socket channel "module.<id>", plain game.socket — no socketlib on the phone):
 *   phone → { type: "use", v, id, userId, gmId, actorUuid, itemId, activityId, targetUuids, advantage, disadvantage, rollMode }
 *   GM    → { type: "useResult", id, ok: true }                      accepted (validated, execution started)
 *   GM    → { type: "useResult", id, ok: false, error }              rejected, or failed later during execution
 *
 * Only the designated GM (game.users.activeGM — the same answer on every client) executes, so two GMs never
 * double-cast. The GM validates ownership, resolves the targets on its own canvas and calls
 * MidiQOL.completeActivityUse() when midi is present, plain Activity#use with temporary targets otherwise.
 *
 * Both halves live here; main.js registers the GM side in the regular /game client and the client side in the app.
 */
import { MODULE_ID, SETTINGS, RELAY } from "./settings.js";

export const RELAY_CHANNEL = `module.${MODULE_ID}`;
export const RELAY_VERSION = 1;
/** How long the phone waits for the GM to accept a request. Execution itself may take longer (saves, reactions). */
const ACCEPT_TIMEOUT_MS = 15_000;

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

/** requestId → { resolve, reject, timer } */
const pending = new Map();

export function registerRelayClient() {
  game.socket.on(RELAY_CHANNEL, onClientMessage);
}

function onClientMessage(msg) {
  if ( msg?.type !== "useResult" ) return;
  const entry = pending.get(msg.id);
  if ( entry ) {
    clearTimeout(entry.timer);
    pending.delete(msg.id);
    if ( msg.ok ) entry.resolve(msg);
    else entry.reject(new Error(msg.error || L("POCKET5E.Relay.Failed")));
    return;
  }
  // A failure reported after the request was already accepted (the workflow itself broke): just tell the player.
  if ( (msg.ok === false) && msg.error && (msg.userId === game.user.id) ) ui.notifications.warn(msg.error);
}

/**
 * Ask the designated GM to use `activity` on behalf of this user.
 * Resolves once the GM has accepted the request; the chat card arrives through the normal document sync.
 * @param {Activity} activity
 * @param {object} [options]
 * @param {string[]} [options.targetUuids]   TokenDocument uuids chosen in the app (may be empty).
 * @param {boolean} [options.advantage]
 * @param {boolean} [options.disadvantage]
 * @param {string} [options.rollMode]        Roll visibility for the created messages.
 */
export async function requestUse(activity, { targetUuids=[], advantage=false, disadvantage=false, rollMode }={}) {
  const gm = designatedGM();
  if ( !gm ) throw new Error(L("POCKET5E.Relay.NoGM"));
  const item = activity?.item;
  const actor = item?.actor;
  if ( !actor || !item.isEmbedded ) throw new Error(L("POCKET5E.Relay.NotFound"));

  const id = foundry.utils.randomID();
  const request = {
    type: "use", v: RELAY_VERSION, id,
    userId: game.user.id, gmId: gm.id,
    actorUuid: actor.uuid, itemId: item.id, activityId: activity.id,
    targetUuids: Array.from(targetUuids ?? []),
    advantage: !!advantage, disadvantage: !!disadvantage,
    rollMode: rollMode ?? null
  };
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(game.i18n.format("POCKET5E.Relay.Timeout", { name: gm.name })));
    }, ACCEPT_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
  });
  log("→", item.name, activity.name || activity.type, request.targetUuids.length ? `targets ${request.targetUuids.length}` : "no targets");
  game.socket.emit(RELAY_CHANNEL, request);
  return result;
}

/* -------------------------------------------- */
/*  GM side (regular /game client)              */
/* -------------------------------------------- */

export function registerRelayGM() {
  if ( !game.user.isGM ) return;
  game.socket.on(RELAY_CHANNEL, msg => {
    if ( msg?.type === "use" ) handleUse(msg);
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

  let activity, targets, user;
  try {
    if ( msg.v !== RELAY_VERSION ) throw new Error(`relay protocol v${msg.v} ≠ v${RELAY_VERSION} — update the module on both sides`);
    user = game.users.get(msg.userId);
    if ( !user ) throw new Error(L("POCKET5E.Relay.Denied"));
    const actor = resolveActor(msg.actorUuid);
    if ( !actor?.testUserPermission(user, "OWNER") ) throw new Error(L("POCKET5E.Relay.Denied"));
    const item = actor.items.get(msg.itemId);
    activity = item?.system?.activities?.get(msg.activityId);
    if ( !activity ) throw new Error(L("POCKET5E.Relay.NotFound"));
    targets = resolveTargets(msg.targetUuids ?? []);
    if ( msg.targetUuids?.length && !targets.length ) throw new Error(L("POCKET5E.Relay.SceneMismatch"));
  } catch(err) {
    console.warn(`${MODULE_ID} | relay | rejected:`, err);
    reply({ ok: false, error: err?.message ?? String(err) });
    return;
  }

  reply({ ok: true });
  log("←", user.name, "uses", activity.item.name, activity.name || activity.type, targets.map(t => t.name));

  // The card is authored by the player: it shows up as theirs in chat, and roll visibility follows their choice.
  const message = {
    rollMode: msg.rollMode || undefined,
    data: { author: user.id, flags: { [MODULE_ID]: { relay: { userId: user.id } } } }
  };
  // Dialogs would open on the GM's screen — never ask. Spell level / consumption keep their defaults (see PLAN.md).
  const dialog = { configure: false };

  try {
    if ( globalThis.MidiQOL?.completeActivityUse ) {
      const usage = {
        midiOptions: {
          targetUuids: targets.map(t => t.uuid),
          ignoreUserTargets: true,            // never mix in whatever the GM happens to have targeted
          checkGMstatus: false,
          workflowOptions: {
            advantage: !!msg.advantage,
            disadvantage: !!msg.disadvantage,
            autoRollAttack: true,             // the player already pressed "use" — no attack prompt on the GM's screen
            fastForwardAttack: true,
            fastForwardDamage: true           // damage auto-roll itself follows the GM's midi settings
          }
        }
      };
      await MidiQOL.completeActivityUse(activity, usage, dialog, message);
    }
    else {
      await withTemporaryTargets(targets, () => activity.use({}, dialog, message));
    }
  } catch(err) {
    console.error(`${MODULE_ID} | relay | use failed:`, err);
    reply({ ok: false, error: game.i18n.format("POCKET5E.Relay.Failed", { error: err?.message ?? String(err) }) });
  }
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
