/**
 * "Actions" tab: everything the character can use right now, grouped by activation type.
 * Spells appear only when castable (cantrips, prepared…). Favorites have their own tab.
 */
import { prepareRollBar } from "./overview.js";
import { activityRow, isCastableSpell, byName } from "./items.js";

const L = key => game.i18n.localize(key);
const SKIP_TYPES = new Set(["class", "subclass", "race", "background"]);
const GROUPS = [["action", "GroupAction"], ["bonus", "GroupBonus"], ["reaction", "GroupReaction"], ["other", "GroupOther"]];

export function prepareActions(shell, context) {
  prepareRollBar(shell, context);
  const actor = shell.actor;

  const rows = [];
  for ( const item of Array.from(actor.items).sort(byName) ) {
    if ( SKIP_TYPES.has(item.type) ) continue;
    const activities = item.system?.activities?.contents ?? [];
    if ( !activities.length ) continue;
    if ( (item.type === "spell") && !isCastableSpell(item) ) continue;
    for ( const activity of activities ) rows.push(activityRow(item, activity));
  }

  context.actionGroups = GROUPS
    .map(([id, key]) => ({ id, label: L(`POCKET5E.Actions.${key}`), rows: rows.filter(r => r.group === id) }))
    .filter(g => g.rows.length);
  context.empty = !context.actionGroups.length;
}
