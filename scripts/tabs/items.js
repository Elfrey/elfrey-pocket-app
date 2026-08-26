/**
 * Row builders shared by the Actions and Inventory tabs and the item drawer. Pure data.
 */
import { loc, fmtLabel, usesText } from "../actions.js";

const L = key => game.i18n.localize(key);

export const INVENTORY_TYPES = ["weapon", "equipment", "consumable", "tool", "container", "loot"];
export const FEATURE_TYPES = ["feat", "class", "subclass", "race", "background"];

export function byName(a, b) {
  return a.name.localeCompare(b.name, game.i18n.lang);
}

/** action | bonus | reaction | other */
export function activationGroup(type) {
  return ["action", "bonus", "reaction"].includes(type) ? type : "other";
}

/** Cantrips, prepared/always-prepared spells and spells whose method needs no preparation. */
export function isCastableSpell(item) {
  if ( item.type !== "spell" ) return false;
  const s = item.system;
  if ( (s.level ?? 0) === 0 ) return true;
  const method = CONFIG.DND5E.spellcasting?.[s.method];
  if ( method && !method.prepares ) return true;
  return (s.prepared ?? 0) >= 1;
}

/**
 * One usable activity as a list row.
 * @param {Item} item
 * @param {object} activity            dnd5e Activity (pseudo-document)
 * @param {object} [options]
 * @param {boolean} [options.withItemName=true]  Show the item name as the title (activity name as subtitle).
 */
export function activityRow(item, activity, { withItemName=true }={}) {
  const labels = activity.labels ?? {};
  const actName = activity.name?.trim() ?? "";
  const many = (item.system.activities?.size ?? 0) > 1;
  const title = activity.metadata?.title ? L(activity.metadata.title) : "";
  let name = item.name;
  let sub = "";
  if ( withItemName ) sub = (actName && actName !== item.name) ? actName : (many ? title : "");
  else { name = actName || title || item.name; }

  const type = activity.type;
  const hasDamage = (activity.damage?.parts?.length > 0) || ((type === "heal") && !!activity.healing);
  return {
    itemId: item.id,
    activityId: activity.id,
    name,
    sub,
    img: activity.img || item.img,
    group: activationGroup(activity.activation?.type),
    activation: fmtLabel(labels.activation) || loc(CONFIG.DND5E.activityActivationTypes?.[activity.activation?.type]?.label, ""),
    range: fmtLabel(labels.range),
    target: fmtLabel(labels.target),
    toHit: fmtLabel(labels.toHit),
    damage: fmtLabel(labels.damage),
    save: fmtLabel(labels.save),
    uses: usesText(activity) ?? usesText(item.system),
    quantity: ((item.type === "consumable") && (item.system.quantity !== 1)) ? item.system.quantity : null,
    canAttack: (type === "attack") && (typeof activity.rollAttack === "function"),
    canDamage: hasDamage && (typeof activity.rollDamage === "function"),
    canFormula: (type === "utility") && !!activity.roll?.formula && (typeof activity.rollFormula === "function"),
    disabled: activity.canUse === false,
    isSpell: item.type === "spell",
    level: item.system.level ?? null
  };
}

/** An item without activities shown in an activity list (favorites). */
export function itemAsActivityRow(item) {
  return {
    itemId: item.id,
    activityId: null,
    name: item.name,
    sub: "",
    img: item.img,
    group: "other",
    activation: L(CONFIG.Item.typeLabels?.[item.type] ?? item.type),
    uses: usesText(item.system),
    quantity: ((item.type === "consumable") && (item.system.quantity !== 1)) ? item.system.quantity : null,
    canAttack: false, canDamage: false, canFormula: false, disabled: false
  };
}

function weightText(item) {
  const s = item.system;
  let value = s.totalWeight;
  if ( (typeof value !== "number") || !Number.isFinite(value) ) value = s.weight?.value;
  if ( (typeof value !== "number") || !Number.isFinite(value) || !value ) return "";
  const units = loc(CONFIG.DND5E.weightUnits?.[s.weight?.units]?.abbreviation, s.weight?.units ?? "");
  return `${Math.round(value * 10) / 10} ${units}`.trim();
}

function priceText(item) {
  const price = item.system.price;
  if ( !price?.value ) return "";
  return `${price.value} ${loc(CONFIG.DND5E.currencies?.[price.denomination]?.abbreviation, price.denomination ?? "")}`.trim();
}

/**
 * One inventory row; containers include their (sorted) contents when expanded.
 * @param {Item} item
 * @param {object} [options]
 * @param {Set<string>} [options.expanded]  Ids of expanded containers.
 */
export function itemRow(item, { expanded=new Set() }={}) {
  const s = item.system;
  const isContainer = item.type === "container";
  const isExpanded = isContainer && expanded.has(item.id);
  let contents = [];
  if ( isExpanded ) {
    const collection = s.contents;
    const list = (collection && !(collection instanceof Promise)) ? Array.from(collection.values?.() ?? collection) : [];
    contents = list.sort(byName).map(i => itemRow(i, { expanded }));
  }
  return {
    id: item.id,
    name: item.name,
    img: item.img,
    type: item.type,
    typeLabel: L(CONFIG.Item.typeLabels?.[item.type] ?? item.type),
    quantity: s.quantity ?? 1,
    showQuantity: (s.quantity ?? 1) !== 1,
    weight: weightText(item),
    price: priceText(item),
    uses: usesText(s),
    rarity: s.rarity ? loc(CONFIG.DND5E.itemRarity?.[s.rarity], s.rarity) : "",
    equippable: (s.equipped !== undefined) && !isContainer,
    equipped: !!s.equipped,
    canAttune: !!s.attunement,
    attuned: !!s.attuned,
    hasActivities: (s.activities?.size ?? 0) > 0,
    isContainer,
    expanded: isExpanded,
    contents,
    unidentified: s.identified === false
  };
}
