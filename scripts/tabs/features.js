/**
 * "Features" tab: class / subclass / species / background items, then feats grouped by dnd5e feature type,
 * each group ordered action → bonus → reaction → other → passive. Tap the image to use; tap the name for details.
 */
import { byName, activationGroup } from "./items.js";
import { prepareRollBar } from "./overview.js";
import { loc, fmtLabel, usesText } from "../actions.js";

const L = key => game.i18n.localize(key);
const ACTIVATION_ORDER = { action: 0, bonus: 1, reaction: 2, other: 3 };

/** Features with actions first, then bonus actions, reactions, everything else; alphabetical within. */
function byActivationThenName(a, b) {
  const ga = ACTIVATION_ORDER[activationGroup(a.system?.activities?.contents?.[0]?.activation?.type)] ?? 3;
  const gb = ACTIVATION_ORDER[activationGroup(b.system?.activities?.contents?.[0]?.activation?.type)] ?? 3;
  const pa = a.system?.activities?.size ? ga : 4;   // passive features (no activities) go last
  const pb = b.system?.activities?.size ? gb : 4;
  return (pa - pb) || byName(a, b);
}

export function prepareFeatures(shell, context) {
  prepareRollBar(shell, context);
  const actor = shell.actor;
  const it = actor.itemTypes ?? {};

  const character = [
    ...(it.class ?? []).sort(byName).map(c => ({
      ...featureRow(c), sub: [game.i18n.format("POCKET5E.Features.Level", { level: c.system.levels ?? "" }), (it.subclass ?? []).find(sc => sc.system.classIdentifier === c.identifier)?.name].filter(Boolean).join(" · ")
    })),
    ...(it.race ?? []).map(r => ({ ...featureRow(r), sub: L("POCKET5E.Features.Species") })),
    ...(it.background ?? []).map(b => ({ ...featureRow(b), sub: L("POCKET5E.Features.Background") }))
  ];

  const groups = new Map();
  const cfgTypes = CONFIG.DND5E.featureTypes ?? {};
  for ( const feat of (it.feat ?? []).sort(byActivationThenName) ) {
    const type = feat.system.type?.value ?? "";
    const cfg = cfgTypes[type];
    const key = cfg ? type : "other";
    if ( !groups.has(key) ) groups.set(key, { id: key, label: cfg ? loc(cfg.label, type) : L("POCKET5E.Features.Other"), rows: [] });
    const row = featureRow(feat);
    const subtype = cfg?.subtypes?.[feat.system.type?.subtype];
    if ( subtype ) row.sub = loc(subtype, "");
    groups.get(key).rows.push(row);
  }

  context.characterRows = character;
  context.featureGroups = [...groups.values()];
  context.empty = !character.length && !groups.size;
}

export function featureRow(item) {
  const s = item.system ?? {};
  const activities = s.activities?.contents ?? [];
  const first = activities[0];
  return {
    id: item.id,
    name: item.name,
    img: item.img,
    sub: "",
    activation: fmtLabel(first?.labels?.activation),
    uses: usesText(s) ?? usesText(first),
    hasActivities: activities.length > 0,
    disabled: !!first && (first.canUse === false)
  };
}
