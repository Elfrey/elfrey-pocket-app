import { MODULE_ID, SETTINGS } from "./settings.js";

/**
 * Thin wrappers around the dnd5e 5.x API — the single place the shell talks to the system, so a
 * future dnd5e API change is fixed here once.
 *
 * Roll specs are strings: "ability:str", "save:dex", "skill:prc", "tool:thief", "initiative",
 * "deathSave", "concentration", "hitDie", "shortRest", "longRest", "d20".
 */

/* -------------------------------------------- */
/*  Roll privacy (core.rollMode)                */
/* -------------------------------------------- */

const ROLL_MODE_ICONS = {
  publicroll: "fa-solid fa-globe", public: "fa-solid fa-globe",
  gmroll: "fa-solid fa-user-secret", gm: "fa-solid fa-user-secret",
  blindroll: "fa-solid fa-eye-slash", blind: "fa-solid fa-eye-slash",
  selfroll: "fa-solid fa-user", self: "fa-solid fa-user"
};
const VISIBILITY_MODES = new Set(Object.keys(ROLL_MODE_ICONS));

/**
 * v13 keeps roll visibility in the client setting core.rollMode with CONFIG.Dice.rollModes (publicroll/gmroll/…);
 * v14 renamed both to core.messageMode + CONFIG.ChatMessage.modes (public/gm/blind/self) and deprecated the old
 * names. Talk to whichever the running core provides so no compatibility warnings fire.
 */
function rollModeSetting() {
  return game.settings.settings.has("core.messageMode") ? "messageMode" : "rollMode";
}

function rollModesConfig() {
  return CONFIG.ChatMessage?.modes ?? CONFIG.Dice.rollModes;
}

/** Current roll visibility — the same client setting Foundry's own chat privacy buttons write. */
export function getRollMode() {
  return game.settings.get("core", rollModeSetting());
}

export async function setRollMode(mode) {
  if ( !(mode in rollModesConfig()) ) throw new Error(`Unknown roll mode "${mode}"`);
  return game.settings.set("core", rollModeSetting(), mode);
}

export function isPublicRollMode(mode=getRollMode()) {
  return (mode === "publicroll") || (mode === "public");
}

/** The "public" mode id for the running core (v14 renamed it). */
export function publicRollMode() {
  return CONFIG.ChatMessage?.modes ? "public" : "publicroll";
}

/** Visibility modes for a picker: [{id, label, icon, active}]. */
export function rollModeOptions() {
  const current = getRollMode();
  return Object.entries(rollModesConfig())
    .filter(([id]) => VISIBILITY_MODES.has(id))
    .map(([id, cfg]) => ({
      id,
      label: game.i18n.localize(typeof cfg === "string" ? cfg : (cfg?.label ?? id)),
      icon: (typeof cfg === "object" && cfg?.icon) || ROLL_MODE_ICONS[id],
      active: id === current
    }));
}

/**
 * @param {Actor} actor
 * @param {string} spec
 * @param {object} [options]
 * @param {Event} [options.event]         Originating UI event (dnd5e reads keyboard modifiers from it).
 * @param {boolean} [options.advantage]
 * @param {boolean} [options.disadvantage]
 * @param {boolean} [options.fast]        Skip the roll configuration dialog.
 */
export async function performRoll(actor, spec, { event, advantage=false, disadvantage=false, fast=false }={}) {
  const [kind, key] = String(spec ?? "").split(":");
  const config = { event };
  if ( advantage ) config.advantage = true;
  if ( disadvantage ) config.disadvantage = true;
  const dialog = fast ? { configure: false } : {};
  // Without the dialog dnd5e falls back to core.rollMode; pass it explicitly so both paths behave the same.
  const message = { rollMode: getRollMode() };

  switch ( kind ) {
    case "ability":       return actor.rollAbilityCheck({ ...config, ability: key }, dialog, message);
    case "save":          return actor.rollSavingThrow({ ...config, ability: key }, dialog, message);
    case "skill":         return actor.rollSkill({ ...config, skill: key }, dialog, message);
    case "tool":          return actor.rollToolCheck({ ...config, tool: key }, dialog, message);
    case "initiative":    return rollInitiative(actor, { event, advantage, disadvantage, fast });
    case "deathSave":     return actor.rollDeathSave(config, dialog, message);
    case "concentration": return actor.rollConcentration(config, dialog, message);
    case "hitDie":        return actor.rollHitDie({ event }, dialog, message);
    case "shortRest":     return actor.shortRest();
    case "longRest":      return actor.longRest();
    case "d20":           return new Roll("1d20").toMessage({ speaker: ChatMessage.getSpeaker({ actor }) }, { rollMode: message.rollMode });
    default: throw new Error(`Unknown roll spec "${spec}"`);
  }
}

/* -------------------------------------------- */
/*  Combat                                      */
/* -------------------------------------------- */

/** The encounter the player is in: the active one (no canvas → no "viewed scene" to prefer). */
export function activeCombat() {
  return game.combats?.active ?? game.combat ?? null;
}

/** Core and dnd5e resolve `game.combat` through the (hidden) combat tracker — keep it pointed at the right encounter. */
function ensureViewedCombat(combat) {
  if ( ui.combat && (ui.combat.viewed !== combat) ) ui.combat.viewed = combat;
}

/**
 * Roll initiative. Mirrors Actor5e#rollInitiativeDialog (same config, dialog, hooks and cached roll) with two
 * differences needed off-canvas: a combatant is only created when the actor has none — core would otherwise
 * add a duplicate actor-only combatant every time, because getActiveTokens() is empty without a canvas — and
 * an existing initiative is re-rolled instead of silently kept.
 */
export async function rollInitiative(actor, { event, advantage=false, disadvantage=false, fast=false }={}) {
  const combat = activeCombat();
  if ( !combat ) {
    ui.notifications.warn(game.i18n.localize("COMBAT.NoneActive"));
    return null;
  }
  ensureViewedCombat(combat);

  const rollOptions = { event };
  if ( advantage ) rollOptions.advantage = true;
  if ( disadvantage ) rollOptions.disadvantage = true;
  const config = {
    evaluate: false,
    event,
    hookNames: ["initiativeDialog", "abilityCheck", "d20Test"],
    rolls: [actor.getInitiativeRollConfig(rollOptions)],
    subject: actor
  };
  if ( advantage ) config.advantage = true;
  if ( disadvantage ) config.disadvantage = true;
  if ( !config.rolls[0] ) return null;

  const messageOptions = { rollMode: getRollMode() };
  if ( config.rolls[0].options?.fixed === undefined ) {
    const dialogConfig = foundry.utils.mergeObject(
      { options: { title: game.i18n.localize("DND5E.InitiativeRoll") } },
      fast ? { configure: false } : {}
    );
    const rolls = await CONFIG.Dice.D20Roll.build(config, dialogConfig, messageOptions);
    if ( !rolls.length ) return null;
    actor._cachedInitiativeRoll = rolls[0];
  }
  else {
    const { data, options } = config.rolls[0];
    actor._cachedInitiativeRoll = new CONFIG.Dice.BasicRoll(String(options.fixed), data, options);
  }

  const inCombat = combat.combatants.some(c => c.actor === actor);
  return actor.rollInitiative({ createCombatants: !inCombat, rerollInitiative: true, initiativeOptions: { messageOptions } });
}

/** The actor's combatant in the active encounter, if any. */
export function actorCombatant(actor, combat=activeCombat()) {
  return combat?.combatants.find(c => c.actor === actor) ?? null;
}

/** Is it this actor's turn right now? */
export function isActorTurn(actor, combat=activeCombat()) {
  const current = combat?.combatant;
  return !!current && ((current.actor === actor) || (current.actorId === actor.id));
}

/** End the actor's turn. Core lets any user advance the turn; the UI only offers it on the actor's own turn. */
export async function endTurn(actor) {
  const combat = activeCombat();
  if ( !combat || !isActorTurn(actor, combat) ) {
    ui.notifications.warn(game.i18n.localize("POCKET5E.Overview.NotYourTurn"));
    return null;
  }
  ensureViewedCombat(combat);
  return combat.nextTurn();
}

/* -------------------------------------------- */
/*  Hit points                                  */
/* -------------------------------------------- */

/**
 * Change hit points through dnd5e so hooks, resistances and automation fire.
 * @param {Actor} actor
 * @param {"damage"|"heal"|"temp"} mode
 * @param {number} amount
 */
export async function applyHP(actor, mode, amount) {
  amount = Math.max(0, Math.floor(Number(amount) || 0));
  if ( !amount ) return;
  switch ( mode ) {
    case "damage": return actor.applyDamage(amount);
    case "heal":   return actor.applyDamage([{ value: amount, type: "healing" }]);
    case "temp":   return actor.applyTempHP(amount);
    default: throw new Error(`Unknown HP mode "${mode}"`);
  }
}

export async function setExhaustion(actor, level) {
  const max = CONFIG.DND5E.conditionTypes?.exhaustion?.levels ?? 6;
  return actor.update({ "system.attributes.exhaustion": Math.clamp(Number(level) || 0, 0, max) });
}

export async function setDeathSaves(actor, { success, failure }={}) {
  const update = {};
  if ( success !== undefined ) update["system.attributes.death.success"] = Math.clamp(Number(success) || 0, 0, 3);
  if ( failure !== undefined ) update["system.attributes.death.failure"] = Math.clamp(Number(failure) || 0, 0, 3);
  return actor.update(update);
}

export async function toggleCondition(actor, statusId) {
  return actor.toggleStatusEffect(statusId);
}

export async function endConcentration(actor) {
  return actor.endConcentration();
}

/* -------------------------------------------- */
/*  Items & activities                          */
/* -------------------------------------------- */

/**
 * Use an item (or one of its activities). The dnd5e usage dialog is never skipped here — that is where
 * spell level, consumption and targeting choices live.
 */
export async function useItem(item, activity=null) {
  const message = { rollMode: getRollMode() };
  if ( activity ) return activity.use({}, {}, message);
  return item.use({}, {}, message);
}

/**
 * Configuration fields of an ActivityUseConfiguration that describe *what* is being used — the choices the player
 * makes in the dnd5e usage dialog. Everything else (events, workflows, subjects) is local to the client that runs
 * the use and is rebuilt there.
 */
const USAGE_FIELDS = ["spell", "scaling", "consume", "concentration", "create", "cause", "summons",
  "enchantmentProfile", "transform", "building", "subsequentActions", "hasConsumption"];

/**
 * Which activity does a tap on an item mean? One usable activity — that one; several — dnd5e's own choice
 * dialog, here on the phone; none — null, and the caller falls back to the item's chat card.
 * @param {Item5e} item
 * @returns {Promise<Activity|null|undefined>}   null = nothing usable, undefined = the player dismissed the choice.
 */
export async function chooseActivity(item) {
  const usable = item.system?.activities?.filter(a => a.canUse) ?? [];
  if ( !usable.length ) return null;
  if ( usable.length === 1 ) return usable[0];
  const DialogClass = globalThis.dnd5e?.applications?.activity?.ActivityChoiceDialog;
  if ( !DialogClass?.create ) return usable[0];
  return (await DialogClass.create(item)) ?? undefined;
}

/**
 * Build the usage configuration for an activity and, when dnd5e would ask, show its usage dialog here: spell slot
 * (upcasting), resource consumption, concentration, template creation. Nothing is consumed and no message is
 * created — that happens in the actual use, which may run on another client (see relay.js).
 * @param {Activity} activity
 * @returns {Promise<object|null>}   The configuration, or null if the player dismissed the dialog.
 */
export async function configureUsage(activity) {
  const config = activity._prepareUsageConfig({});
  if ( !activity._requiresConfigurationDialog?.(config) ) return config;
  const DialogClass = activity.metadata?.usage?.dialog;
  if ( !DialogClass?.create ) return config;
  try {
    return await DialogClass.create(activity, config, {});
  } catch(err) {
    if ( err ) console.warn(`${MODULE_ID} |`, err);   // dismissing the dialog rejects with nothing
    return null;
  }
}

/** The parts of a usage configuration that can travel over a socket, as plain data. */
export function serializeUsage(config) {
  const out = {};
  for ( const key of USAGE_FIELDS ) {
    if ( !(key in (config ?? {})) ) continue;
    try { out[key] = JSON.parse(JSON.stringify(config[key])); } catch(err) { /* skip what cannot travel */ }
  }
  return out;
}

/** "3rd level" — how the chosen slot differs from the spell's own level, for the "sent to the GM" notice. */
export function usageSummary(activity, config) {
  const slot = config?.spell?.slot;
  if ( !slot || (activity.item?.type !== "spell") ) return "";
  const level = activity.actor?.system?.spells?.[slot]?.level ?? Number(String(slot).replace("spell", ""));
  if ( !Number.isFinite(level) || (level <= (activity.item.system.level ?? 0)) ) return "";
  return loc(CONFIG.DND5E.spellLevels?.[level], `${level}`);
}

export async function rollActivityAttack(activity, { event, advantage=false, disadvantage=false, fast=false }={}) {
  if ( typeof activity?.rollAttack !== "function" ) throw new Error(game.i18n.localize("POCKET5E.Actions.NoAttack"));
  const config = { event };
  if ( advantage ) config.advantage = true;
  if ( disadvantage ) config.disadvantage = true;
  return activity.rollAttack(config, fast ? { configure: false } : {}, { rollMode: getRollMode() });
}

export async function rollActivityDamage(activity, { event, fast=false }={}) {
  if ( typeof activity?.rollDamage !== "function" ) throw new Error(game.i18n.localize("POCKET5E.Actions.NoDamage"));
  return activity.rollDamage({ event }, fast ? { configure: false } : {}, { rollMode: getRollMode() });
}

export async function rollActivityFormula(activity, { event, fast=false }={}) {
  if ( typeof activity?.rollFormula !== "function" ) throw new Error(game.i18n.localize("POCKET5E.Actions.NoDamage"));
  return activity.rollFormula({ event }, fast ? { configure: false } : {}, { rollMode: getRollMode() });
}

export async function toggleEquipped(item) {
  return item.update({ "system.equipped": !item.system.equipped });
}

export async function toggleAttuned(item) {
  return item.update({ "system.attuned": !item.system.attuned });
}

export async function changeQuantity(item, delta) {
  const quantity = Math.max(0, (item.system.quantity ?? 0) + (Number(delta) || 0));
  return item.update({ "system.quantity": quantity });
}

export function isFavorite(item) {
  const actor = item.actor;
  return !!actor?.system?.hasFavorite?.(item.getRelativeUUID(actor));
}

export async function toggleFavorite(item) {
  const actor = item.actor;
  const id = item.getRelativeUUID(actor);
  return actor.system.hasFavorite(id) ? actor.system.removeFavorite(id) : actor.system.addFavorite({ type: "item", id });
}

export async function postItemCard(item) {
  if ( typeof item.displayCard === "function" ) return item.displayCard({ rollMode: getRollMode() });
  return item.use({}, {}, { rollMode: getRollMode() });
}

export async function deleteItemConfirm(item) {
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: item.name },
    content: `<p>${game.i18n.format("POCKET5E.Item.DeleteConfirm", { name: item.name })}</p>`,
    rejectClose: false,
    modal: true
  });
  if ( confirmed ) return item.delete();
  return null;
}

/**
 * Update coins from the editor. Each value is the raw text typed for that denomination:
 *   - "+11" / "-11" add / subtract from the current amount;
 *   - a bare number replaces the amount;
 *   - empty text leaves the denomination untouched.
 * No conversion between denominations; totals are clamped at 0.
 * @param {Actor} actor
 * @param {Record<string, string|number>} values
 */
export async function updateCurrency(actor, values) {
  const update = {};
  const currency = actor.system.currency ?? {};
  for ( const [key, raw] of Object.entries(values) ) {
    if ( !(key in (CONFIG.DND5E.currencies ?? {})) ) continue;
    const text = String(raw ?? "").trim().replace(/\s+/g, "");
    if ( !text ) continue;
    const sign = ["+", "-", "−"].includes(text[0]) ? (text[0] === "+" ? "+" : "-") : null;
    const amount = Math.floor(Number(text.replace(/[^0-9.]/g, "")));
    if ( !Number.isFinite(amount) ) continue;
    const current = Number(currency[key]) || 0;
    let next;
    if ( sign === "+" ) next = current + amount;
    else if ( sign === "-" ) next = current - amount;
    else next = amount;
    next = Math.max(0, next);
    if ( next !== current ) update[`system.currency.${key}`] = next;
  }
  if ( foundry.utils.isEmpty(update) ) return actor;
  return actor.update(update);
}

/* -------------------------------------------- */
/*  Spells                                      */
/* -------------------------------------------- */

/** Prepared ↔ unprepared; "always prepared" (2) is left alone. */
export async function togglePrepared(item) {
  if ( item.system.prepared === 2 ) return item;
  return item.update({ "system.prepared": Number(!item.system.prepared) });
}

/** Set remaining slots for a slot key ("spell3", "pact"), clamped to [0, max]. */
export async function setSpellSlot(actor, key, value) {
  const slot = actor.system.spells?.[key];
  if ( !slot ) throw new Error(`Unknown spell slot "${key}"`);
  const next = Math.clamp(Math.floor(Number(value) || 0), 0, slot.max ?? 0);
  if ( next === slot.value ) return actor;
  return actor.update({ [`system.spells.${key}.value`]: next });
}

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

/** Short vibration on devices that support it (Android); off via the client setting. */
export function haptic(ms=12) {
  try {
    if ( typeof navigator.vibrate !== "function" ) return;
    if ( game.settings.get(MODULE_ID, SETTINGS.HAPTICS) === false ) return;
    navigator.vibrate(ms);
  } catch(err) { /* ignore */ }
}

/** Flatten dnd5e label values (string | string[] | {label, formula}[]) into one display string. */
export function fmtLabel(value) {
  if ( !value ) return "";
  if ( Array.isArray(value) ) {
    return value.map(v => (typeof v === "string") ? v : (v?.label ?? v?.formula ?? "")).filter(Boolean).join(", ");
  }
  if ( typeof value === "object" ) return value.label ?? value.formula ?? "";
  return String(value);
}

/** "2/3" for anything with dnd5e uses ({spent, max, value}); null when unlimited. */
export function usesText(target) {
  const uses = target?.uses;
  const max = Number(uses?.max);
  if ( !uses || !max ) return null;
  const value = Number.isFinite(uses.value) ? uses.value : Math.max(0, max - (Number(uses.spent) || 0));
  return `${value}/${max}`;
}

export function signed(n) {
  n = Number(n) || 0;
  return n >= 0 ? `+${n}` : `${n}`;
}

/** Localize a string that may already be localized (dnd5e pre-localizes most of CONFIG.DND5E). */
export function loc(value, fallback="") {
  if ( typeof value !== "string" ) return fallback;
  return game.i18n.localize(value);
}

/** "Paladin 5 / Rogue 2 · Dwarf" */
export function actorSummary(actor) {
  const parts = [];
  const classes = actor.itemTypes?.class ?? [];
  if ( classes.length ) {
    parts.push(classes.map(c => `${c.name} ${c.system.levels ?? ""}`.trim()).join(" / "));
  }
  const race = actor.system.details?.race;
  const raceName = typeof race === "string" ? race : race?.name;
  if ( raceName ) parts.push(raceName);
  return parts.join(" · ");
}
