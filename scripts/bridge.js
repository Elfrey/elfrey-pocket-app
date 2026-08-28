/**
 * Bridge — answers the socketlib requests that midi-qol and Chris's Premades send to the *player's* client.
 *
 * Both modules pick "the active owner of the actor" and call `socketlib.executeAsUser(...)` on them: midi for
 * reaction prompts and player-rolled saves, CPR for its dialogs ("use Cutting Words?", pick a target…) and for
 * rolling an item on the owner's client. With the app open, that owner is the phone — which loads neither module.
 * socketlib itself only answers "unregistered" when it is loaded; without it the request never gets an answer and
 * the GM's workflow hangs. So boot.js loads socketlib (tiny, canvas-free) and this file registers handlers under
 * the two module ids, implementing each request with what the phone has: dnd5e for rolls, our own bottom sheets
 * for the dialogs, and the GM relay (relay.js) whenever an item has to be *used* — that must run where midi is.
 *
 * Contracts come from midi-qol 13.0.64 (src/module/GMAction.ts) and CPR 1.5.44 (scripts/lib/sockets.js,
 * scripts/applications/dialog.js); see PLAN.md phase 10.3.
 */
import { MODULE_ID } from "./settings.js";
import { haptic, configureUsage, serializeUsage } from "./actions.js";
import { requestUse, relayEnabled, designatedGM } from "./relay.js";
import { ReactionPicker } from "./shell/reaction-picker.js";
import { RemoteDialog } from "./shell/remote-dialog.js";

const MIDI = "midi-qol";
const CPR = "chris-premades";
/** midi's own default when the GM has not configured a reaction timeout (utils.ts defaultTimeout). */
const REACTION_TIMEOUT_S = 30;
/** After this long a save/check the player did not answer is rolled without the dialog (midi's clients do the same). */
const SAVE_TIMEOUT_S = 60;

const L = key => game.i18n.localize(key);
const log = (...args) => console.log(`${MODULE_ID} | bridge |`, ...args);

/* -------------------------------------------- */
/*  Registration                                */
/* -------------------------------------------- */

export async function registerBridge() {
  let lib = globalThis.socketlib;
  if ( lib ) log(`using socketlib (${globalThis.POCKET5E?.socketlib ?? "loaded"})`);
  else {
    log(`socketlib unavailable (${globalThis.POCKET5E?.socketlib ?? "unknown"}) — using the built-in compatible transport`);
    lib = { registerModule: moduleId => MiniSocket.for(moduleId) };
  }
  const midi = register(lib, MIDI, { chooseReactions, rollAbility, rollAbilityV2: rollAbility, D20Roll: d20Roll });
  const cpr = register(lib, CPR, {
    dialog: cprDialog, queuedDialog: cprQueuedDialog, rollItem: cprRollItem,
    remoteRoll, remoteDamageRolls, updateTargets: async () => true
  });
  await Promise.all([midi && loadModuleTranslations(MIDI), cpr && loadModuleTranslations(CPR)]);
}

function register(lib, moduleId, handlers) {
  if ( !game.modules.get(moduleId)?.active ) {
    log(`${moduleId} is not active in this world — nothing to answer`);
    return false;
  }
  const socket = lib.registerModule(moduleId);
  if ( !socket ) return false;
  for ( const [name, fn] of Object.entries(handlers) ) socket.register(name, fn);
  log(`answering ${moduleId}: ${Object.keys(handlers).join(", ")}`);
  return true;
}

/* -------------------------------------------- */
/*  Minimal socketlib-compatible responder      */
/* -------------------------------------------- */

/** socketlib 1.1.x wire protocol (src/socketlib.js): message types and recipient codes. */
const SL_TYPE = { COMMAND: 0, REQUEST: 1, RESULT: 3, EXCEPTION: 4, UNREGISTERED: 5 };
const SL_RECIPIENT = { ONE_GM: 0, ALL_GMS: 1, EVERYONE: 2 };

/**
 * Answers requests exactly like a SocketlibSocket would, so the requester's socketlib resolves its promise:
 * { handlerName, args, recipient, id, type } in → { id, result, type: RESULT } out (UNREGISTERED / EXCEPTION on
 * failure). Only the responder half — the app never *sends* requests through it.
 */
class MiniSocket {
  static #instances = new Map();

  static for(moduleId) {
    if ( !this.#instances.has(moduleId) ) this.#instances.set(moduleId, new MiniSocket(moduleId));
    return this.#instances.get(moduleId);
  }

  #functions = new Map();
  socketName;

  constructor(moduleId) {
    this.socketName = `module.${moduleId}`;
    game.socket.on(this.socketName, this.#onReceived.bind(this));
  }

  register(name, fn) {
    if ( typeof fn === "function" ) this.#functions.set(name, fn);
  }

  #onReceived(message, senderId) {
    if ( !message || ![SL_TYPE.COMMAND, SL_TYPE.REQUEST].includes(message.type) ) return;
    const { handlerName, args=[], recipient, id, type } = message;
    if ( Array.isArray(recipient) ) { if ( !recipient.includes(game.userId) ) return; }
    else if ( recipient === SL_RECIPIENT.ONE_GM ) { if ( !game.users.activeGM?.isSelf ) return; }
    else if ( recipient === SL_RECIPIENT.ALL_GMS ) { if ( !game.user.isGM ) return; }
    else if ( recipient !== SL_RECIPIENT.EVERYONE ) return;

    const emit = data => game.socket.emit(this.socketName, data);
    const fn = this.#functions.get(handlerName);
    if ( !fn ) {
      if ( type === SL_TYPE.REQUEST ) emit({ id, type: SL_TYPE.UNREGISTERED, userId: game.userId });
      return;
    }
    const context = { socketdata: { userId: senderId } };
    if ( type === SL_TYPE.COMMAND ) {
      try { fn.call(context, ...args); } catch(err) { console.error(`${MODULE_ID} | bridge | ${handlerName}:`, err); }
      return;
    }
    Promise.resolve().then(() => fn.call(context, ...args))
      .then(result => emit({ id, result, type: SL_TYPE.RESULT }))
      .catch(err => {
        console.error(`${MODULE_ID} | bridge | ${handlerName} failed:`, err);
        emit({ id, type: SL_TYPE.EXCEPTION, userId: game.userId });
      });
  }
}

/** Merge a module's language files (current language, then English) so its dialog labels and keys render. */
async function loadModuleTranslations(moduleId) {
  const languages = Array.from(game.modules.get(moduleId)?.languages ?? []);
  for ( const lang of [game.i18n.lang, "en"] ) {
    const entry = languages.find(l => l.lang === lang);
    if ( !entry ) continue;
    try {
      const json = await foundry.utils.fetchJsonWithTimeout(foundry.utils.getRoute(`modules/${moduleId}/${entry.path}`));
      foundry.utils.mergeObject(game.i18n.translations, json, { overwrite: false });
    } catch(err) {
      console.warn(`${MODULE_ID} | bridge | ${moduleId} ${lang} translations:`, err?.message ?? err);
    }
  }
}

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

/** Actor from an actor or token uuid. */
function actorFromUuid(uuid) {
  const doc = uuid ? fromUuidSync(uuid) : null;
  if ( !doc ) return null;
  return doc.documentName === "Actor" ? doc : (doc.actor ?? null);
}

/** "…Item.X.Activity.Y" → Activity (dnd5e pseudo-document uuids are not resolved by fromUuidSync everywhere). */
function resolveActivity(uuid) {
  if ( typeof uuid !== "string" ) return null;
  const i = uuid.indexOf(".Activity.");
  if ( i < 0 ) return null;
  const item = fromUuidSync(uuid.slice(0, i));
  return item?.system?.activities?.get(uuid.slice(i + ".Activity.".length)) ?? null;
}

/* -------------------------------------------- */
/*  midi-qol                                    */
/* -------------------------------------------- */

/**
 * The GM's workflow asks this player whether their actor reacts (Shield, opportunity attack…). midi expects the
 * chosen reaction to have been *used* before we answer: { name, uuid, itemName, itemUuid }, or { name: "None" }.
 * The use itself goes through the GM relay, since that is where midi runs.
 */
async function chooseReactions({ tokenUuid, reactionActivityList=[], triggerTokenUuid, reactionFlavor="", triggerType, options={} }={}) {
  const none = { name: "None" };
  const actor = actorFromUuid(tokenUuid);
  if ( !actor ) return none;
  const activities = reactionActivityList.map(resolveActivity).filter(Boolean);
  if ( !activities.length ) return none;
  if ( !relayEnabled() || !designatedGM() ) {
    ui.notifications.warn(L("POCKET5E.Bridge.ReactionNoRelay"));
    return none;
  }
  haptic(30);
  const timeout = Number(options.timeout) || REACTION_TIMEOUT_S;
  const choice = await ReactionPicker.pick({ actor, activities, flavor: reactionFlavor, triggerType, timeout });
  if ( !choice ) return none;

  const selfTarget = choice.target?.affects?.type === "self";
  const targetUuids = selfTarget ? [tokenUuid] : (triggerTokenUuid ? [triggerTokenUuid] : []);
  // Same choices a desktop player would get when casting a reaction (slot level, consumption).
  const config = await configureUsage(choice);
  if ( config === null ) return none;
  try {
    await requestUse(choice, { targetUuids, reaction: true, awaitCompletion: true, usage: serializeUsage(config) });
    return { name: choice.name || choice.item.name, uuid: choice.uuid, itemName: choice.item.name, itemUuid: choice.item.uuid };
  } catch(err) {
    console.error(`${MODULE_ID} | bridge | reaction failed:`, err);
    ui.notifications.error(err?.message ?? String(err));
    return none;
  }
}

/**
 * midi asks the player to roll a save / check / skill / tool / death save for their actor. dnd5e is loaded here,
 * so the roll happens on the phone (authored by the player, with the app's bottom-sheet roll dialog).
 * Returns dnd5e's Roll[] — socketlib serialises it the same way midi's own clients do.
 */
async function rollAbility(data={}) {
  const sd = data.saveDetails ?? legacySaveDetails(data);
  const disp = data.displayOptions ?? {};
  const actor = actorFromUuid(sd.actorUuid);
  if ( !actor ) return {};

  let type = sd.rollType ?? "save";
  if ( (type === "abil") || (type === "test") ) type = "check";
  const config = {};
  if ( sd.advantage ) config.advantage = true;
  if ( sd.disadvantage ) config.disadvantage = true;
  if ( sd.rollAbilities?.[0] ) config.ability = sd.rollAbilities[0];
  if ( sd.rollSkills?.[0] ) config.skill = sd.rollSkills[0];
  if ( sd.rollTools?.[0] ) config.tool = sd.rollTools[0];
  if ( (disp.showTargetDC !== false) && sd.rollDC ) config.target = sd.rollDC;
  const dialog = { configure: !disp.fastForward };
  const message = { create: disp.chatMessage !== false };
  if ( disp.rollMode ) message.rollMode = disp.rollMode;

  const roll = () => {
    switch ( type ) {
      case "check":         return actor.rollAbilityCheck(config, dialog, message);
      case "skill":         return actor.rollSkill(config, dialog, message);
      case "tool":          return actor.rollToolCheck(config, dialog, message);
      case "deathSave":     return actor.rollDeathSave(config, dialog, message);
      case "concentration": return actor.rollConcentration(config, dialog, message);
      default:              return actor.rollSavingThrow(config, dialog, message);
    }
  };
  haptic(30);
  if ( dialog.configure ) ui.notifications.info(game.i18n.format("POCKET5E.Bridge.RollRequested", { actor: actor.name }));
  const result = await withDialogTimeout(roll, dialog, SAVE_TIMEOUT_S);
  return result ?? {};
}

/** Pre-13.0.44 flat argument format, kept for older midi builds. */
function legacySaveDetails(data) {
  return {
    actorUuid: data.targetUuid,
    rollType: data.request ?? "save",
    rollAbilities: data.ability ? [data.ability] : [],
    rollSkills: data.skill ? [data.skill] : [],
    rollTools: data.tool ? [data.tool] : [],
    advantage: data.advantage,
    disadvantage: data.disadvantage,
    rollDC: data.rollDC ?? 0
  };
}

/** Run a dnd5e roll; if its configuration dialog is still open after `seconds`, close it and roll without one. */
async function withDialogTimeout(rollFn, dialog, seconds) {
  if ( !dialog.configure ) return rollFn();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; closeRollDialogs(); }, seconds * 1000);
  try {
    const result = await rollFn();
    const empty = !result || (Array.isArray(result) && !result.length);
    if ( empty && timedOut ) {
      dialog.configure = false;
      return rollFn();
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

function closeRollDialogs() {
  const Cls = globalThis.dnd5e?.applications?.dice?.RollConfigurationDialog;
  if ( !Cls ) return;
  for ( const app of foundry.applications.instances.values() ) {
    if ( app instanceof Cls ) app.close();
  }
}

/** Active-defence variant (optional midi rule): roll the given d20 formula for the actor, no dialog. */
async function d20Roll(params={}) {
  const actor = actorFromUuid(params.targetUuid);
  const roll = await new CONFIG.Dice.D20Roll(params.formula ?? "1d20", actor?.getRollData() ?? {}, params.rollOptions ?? {}).roll();
  if ( params.flavor ) {
    await roll.toMessage({ ...(params.messageData ?? {}), flavor: params.flavor }, { rollMode: params.rollMode ?? undefined });
  }
  return roll.toJSON();
}

/* -------------------------------------------- */
/*  Chris's Premades                            */
/* -------------------------------------------- */

/** CPR's DialogApp.dialog(title, content, inputs, buttons, config) rendered as a bottom sheet; same result shape. */
async function cprDialog(title, content, inputs=[], buttons, config={}) {
  haptic(30);
  return RemoteDialog.show({ title, content, inputs, buttons, config });
}

/** CPR's queued confirmation ("use your reaction for X?"): skip when the action is already spent, else yes/no. */
async function cprQueuedDialog(dialogOptions=[], checkOptions={}) {
  const actor = actorFromUuid(checkOptions.actorUuid);
  if ( !actor || !checkOptions.reason ) return false;
  const actions = actor.getFlag(MIDI, "actions") ?? {};
  if ( (checkOptions.reason === "reaction") && ((actions.reactionsUsed ?? 0) >= (actions.reactionsMax ?? 1)) ) return false;
  if ( (checkOptions.reason === "bonusAction") && (actions.bonus || ((actions.bonusActionsUsed ?? 0) >= (actions.bonusActionsMax ?? 1))) ) return false;
  const [title, content, extra] = dialogOptions;
  haptic(30);
  const result = await RemoteDialog.show({ title, content, inputs: [], buttons: extra?.buttons ?? "yesNo" });
  return result?.buttons ?? false;
}

/** CPR wants this player's client to roll an item — it must run where midi is, so hand it to the GM relay. */
async function cprRollItem(itemUuid, config={}, options={}) {
  const item = fromUuidSync(itemUuid);
  if ( !item?.isEmbedded ) return null;
  const usage = serializable(config);
  const dialog = serializable(options);
  await requestUse(null, { item, usage, dialog, awaitCompletion: true });
  return true;
}

/** Drop anything that would not survive the socket (midi puts workflows and documents into these objects). */
function serializable(obj) {
  try { return JSON.parse(JSON.stringify(obj ?? {})); } catch(err) { return {}; }
}

async function remoteRoll(rollJSON) {
  const roll = await Roll.fromData(rollJSON).evaluate();
  return roll.toJSON();
}

async function remoteDamageRolls(rollJSONs=[]) {
  const rolls = rollJSONs.map(j => CONFIG.Dice.DamageRoll.fromData(j));
  for ( const roll of rolls ) await roll.evaluate();
  return rolls.map(r => r.toJSON());
}
