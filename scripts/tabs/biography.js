/**
 * "Biography" section (under More): biography and appearance (enriched), personality, characteristics,
 * languages and proficiencies, damage/condition traits — with an edit mode for the free-text fields.
 */
import { loc } from "../actions.js";

const L = key => game.i18n.localize(key);

async function enrich(html, actor) {
  if ( !html ) return "";
  try {
    const TextEditor = foundry.applications.ux.TextEditor.implementation;
    return await TextEditor.enrichHTML(html, { secrets: actor.isOwner, rollData: actor.getRollData?.() ?? {}, relativeTo: actor });
  } catch(err) {
    return html;
  }
}

const text = v => (v && typeof v === "object") ? (v.value ?? "") : (v ?? "");

/** Data path of a details field, following the actor's actual shape (some fields are {value, units}). */
function detailPath(details, key) {
  const v = details?.[key];
  return (v && typeof v === "object" && ("value" in v)) ? `system.details.${key}.value` : `system.details.${key}`;
}

const CHARACTERISTICS = ["gender", "age", "height", "weight", "eyes", "skin", "hair", "faith"];
const PERSONALITY = [["trait", "Traits"], ["ideal", "Ideals"], ["bond", "Bonds"], ["flaw", "Flaws"]];

function traitList(values, labeler) {
  const out = [];
  for ( const v of values ?? [] ) {
    try { out.push(labeler(v)); } catch(err) { out.push(String(v)); }
  }
  return out.filter(Boolean);
}

export async function prepareBiography(shell, context) {
  const actor = shell.actor;
  const s = actor.system;
  const d = s.details ?? {};
  const state = shell.bioState;
  context.canEdit = actor.isOwner;
  context.editing = !!state.editing;

  if ( state.editing ) {
    context.edit = {
      alignmentPath: "system.details.alignment",
      alignment: d.alignment ?? "",
      alignments: Object.entries(CONFIG.DND5E.alignments ?? {}).map(([k, v]) => ({ key: k, label: loc(v, k), selected: k === d.alignment })),
      characteristics: CHARACTERISTICS.map(k => ({ path: detailPath(d, k), label: L(`POCKET5E.Biography.${cap(k)}`), value: text(d[k]) })),
      personality: PERSONALITY.map(([k, key]) => ({ path: `system.details.${k}`, label: L(`POCKET5E.Biography.${key}`), value: text(d[k]) })),
      appearancePath: detailPath(d, "appearance"),
      appearance: text(d.appearance),
      biographyPath: "system.details.biography.value",
      biography: text(d.biography)
    };
    return;
  }

  context.biography = await enrich(text(d.biography), actor);
  context.appearance = await enrich(text(d.appearance), actor);
  context.personality = PERSONALITY.map(([k, key]) => [key, text(d[k])]).filter(([, v]) => v)
    .map(([key, v]) => ({ label: L(`POCKET5E.Biography.${key}`), value: v }));

  const dim = k => { const v = d[k]; return (v && typeof v === "object") ? [v.value, v.units].filter(Boolean).join(" ") : (v ?? ""); };
  context.characteristics = [
    ["Alignment", loc(CONFIG.DND5E.alignments?.[d.alignment], d.alignment ?? "")],
    ...CHARACTERISTICS.map(k => [cap(k), (k === "height" || k === "weight") ? dim(k) : text(d[k])]),
    ["XP", d.xp?.max ? `${d.xp.value ?? 0} / ${d.xp.max}` : (d.xp?.value ?? "")]
  ].filter(([, v]) => v !== "" && v !== null && v !== undefined).map(([k, v]) => ({ label: L(`POCKET5E.Biography.${k}`), value: v }));

  const t = s.traits ?? {};
  const keyLabel = globalThis.dnd5e?.documents?.Trait?.keyLabel;
  const trait = (key, kind) => (typeof keyLabel === "function" ? keyLabel(key, { trait: kind }) : null) || key;
  const withCustom = (list, custom) => [...list, ...String(custom ?? "").split(";").map(x => x.trim()).filter(Boolean)];
  const damage = k => loc(CONFIG.DND5E.damageTypes?.[k]?.label, k);
  context.proficiencies = [
    ["Languages", withCustom(traitList(t.languages?.value, k => trait(k, "languages")), t.languages?.custom)],
    ["Armor", withCustom(traitList(t.armorProf?.value, k => trait(k, "armor")), t.armorProf?.custom)],
    ["Weapons", withCustom(traitList(t.weaponProf?.value, k => trait(k, "weapon")), t.weaponProf?.custom)],
    ["Tools", Object.keys(s.tools ?? {}).map(k => trait(k, "tool"))],
    ["Resistances", withCustom(traitList(t.dr?.value, damage), t.dr?.custom)],
    ["Immunities", withCustom(traitList(t.di?.value, damage), t.di?.custom)],
    ["Vulnerabilities", withCustom(traitList(t.dv?.value, damage), t.dv?.custom)],
    ["ConditionImmunities", withCustom(traitList(t.ci?.value, k => loc(CONFIG.DND5E.conditionTypes?.[k]?.name, k)), t.ci?.custom)]
  ].filter(([, list]) => list.length).map(([k, list]) => ({ label: L(`POCKET5E.Biography.${k}`), value: list.join(", ") }));

  context.empty = !context.biography && !context.appearance && !context.personality.length && !context.characteristics.length && !context.proficiencies.length;
}

function cap(k) {
  return k.charAt(0).toUpperCase() + k.slice(1);
}

/** Plain text typed on the phone becomes paragraphs; existing HTML is stored as-is. */
function toHTML(value) {
  const v = String(value ?? "").trim();
  if ( !v || /<[a-z][\s\S]*>/i.test(v) ) return v;
  return v.split(/\n{2,}/).map(p => `<p>${foundry.utils.escapeHTML(p).replace(/\n/g, "<br>")}</p>`).join("");
}

/**
 * @param {Actor} actor
 * @param {Record<string, string>} values   Data paths → typed values (from the edit form).
 */
export async function saveBiography(actor, values) {
  const update = {};
  for ( const [path, raw] of Object.entries(values) ) {
    if ( !path.startsWith("system.details.") ) continue;
    const isRich = path.endsWith("biography.value") || path.startsWith("system.details.appearance");
    update[path] = isRich ? toHTML(raw) : String(raw ?? "").trim();
  }
  if ( foundry.utils.isEmpty(update) ) return actor;
  return actor.update(update);
}
