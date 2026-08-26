/**
 * "Inventory" tab: currency (editable), encumbrance, attunement slots, search, items grouped by type
 * with expandable containers.
 */
import { loc } from "../actions.js";
import { INVENTORY_TYPES, itemRow, byName } from "./items.js";
import { prepareRollBar } from "./overview.js";

const L = key => game.i18n.localize(key);

export function prepareInventory(shell, context) {
  prepareRollBar(shell, context);
  const actor = shell.actor;
  const s = actor.system;
  const state = shell.inventoryState;

  context.currency = Object.entries(CONFIG.DND5E.currencies ?? {}).map(([key, c]) => ({
    key,
    value: s.currency?.[key] ?? 0,
    abbr: loc(c.abbreviation, key),
    label: loc(c.label, key),
    icon: c.icon
  }));
  context.currencyEditing = state.currencyEditing;

  const enc = s.attributes?.encumbrance;
  context.encumbrance = enc?.max ? {
    value: Math.round((enc.value ?? 0) * 10) / 10,
    max: Math.round(enc.max),
    pct: Math.round(enc.pct ?? 0),
    encumbered: !!enc.encumbered
  } : null;
  const att = s.attributes?.attunement;
  const attunedItems = actor.items.filter(i => i.system?.attuned).sort(byName);
  context.attunement = (att?.max || attunedItems.length) ? {
    value: att?.value ?? attunedItems.length,
    max: att?.max ?? "—",
    open: state.attunementOpen,
    items: attunedItems.map(i => itemRow(i, { expanded: new Set() }))
  } : null;

  context.filter = state.filter;
  const items = actor.items.filter(i => INVENTORY_TYPES.includes(i.type));
  context.itemGroups = INVENTORY_TYPES.map(type => ({
    id: type,
    label: L(CONFIG.Item.typeLabels?.[type] ?? type),
    rows: items.filter(i => (i.type === type) && !i.system.container).sort(byName).map(i => itemRow(i, { expanded: state.expanded }))
  })).filter(g => g.rows.length);
  context.empty = !items.length;
}
