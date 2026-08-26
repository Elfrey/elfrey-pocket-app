/**
 * "Favorites" tab — the dnd5e sheet favorites (system.favorites) of every kind:
 * items / activities (use by image), skills & tools (roll), spell slots (pips), effects (toggle).
 */
import { prepareRollBar } from "./overview.js";
import { activityRow, itemAsActivityRow } from "./items.js";
import { loc, signed } from "../actions.js";
import { effectRow } from "./effects.js";

const L = key => game.i18n.localize(key);

export function prepareFavorites(shell, context) {
  prepareRollBar(shell, context);
  const actor = shell.actor;
  const s = actor.system;
  const rows = [];

  for ( const favorite of [...(s.favorites ?? [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)) ) {
    const { type, id } = favorite;
    try {
      switch ( type ) {
        case "item": case "activity": case "effect": {
          const doc = fromUuidSync(id, { relative: actor });
          if ( !doc ) break;
          if ( type === "effect" ) rows.push({ kind: "effect", ...effectRow(doc) });
          else if ( doc instanceof Item ) {
            const activities = doc.system?.activities?.contents ?? [];
            if ( activities.length ) for ( const a of activities ) rows.push({ kind: "activity", ...activityRow(doc, a) });
            else rows.push({ kind: "activity", ...itemAsActivityRow(doc) });
          }
          else if ( doc.item ) rows.push({ kind: "activity", ...activityRow(doc.item, doc) });
          break;
        }
        case "skill": {
          const skill = s.skills?.[id];
          if ( !skill ) break;
          rows.push({
            kind: "roll", spec: `skill:${id}`,
            label: loc(CONFIG.DND5E.skills?.[id]?.label, id),
            sub: loc(CONFIG.DND5E.abilities?.[skill.ability]?.abbreviation, skill.ability ?? ""),
            value: signed(skill.total ?? skill.mod ?? 0), passive: skill.passive ?? "",
            icon: "fa-solid fa-dice-d20"
          });
          break;
        }
        case "tool": {
          const tool = s.tools?.[id];
          if ( !tool ) break;
          let label = id;
          try { label = globalThis.dnd5e?.documents?.Trait?.keyLabel?.(id, { trait: "tool" }) ?? id; } catch(err) { /* keep key */ }
          rows.push({
            kind: "roll", spec: `tool:${id}`, label: (typeof label === "string") ? label : id,
            sub: loc(CONFIG.DND5E.abilities?.[tool.ability]?.abbreviation, tool.ability ?? ""),
            value: signed(tool.total ?? tool.mod ?? 0), passive: "", icon: "fa-solid fa-screwdriver-wrench"
          });
          break;
        }
        case "slots": {
          const slot = s.spells?.[id];
          if ( !slot?.max ) break;
          const level = (id === "pact") ? slot.level : Number(id.replace("spell", ""));
          rows.push({
            kind: "slot", key: id,
            label: (id === "pact") ? `${loc(CONFIG.DND5E.spellcasting?.pact?.label, "Pact")} · ${loc(CONFIG.DND5E.spellLevels?.[level], level)}` : loc(CONFIG.DND5E.spellLevels?.[level], `${level}`),
            value: slot.value ?? 0, max: slot.max,
            pips: Array.from({ length: slot.max }, (_, i) => ({ index: i + 1, filled: i < (slot.value ?? 0) }))
          });
          break;
        }
      }
    } catch(err) {
      console.warn("elfrey-pocket-app | favorite skipped", favorite, err);
    }
  }

  context.rows = rows;
  context.empty = !rows.length;
  context.hint = L("POCKET5E.Favorites.Hint");
}
