/**
 * "Effects" section (under More): every applicable active effect on the actor, with enable/disable and delete.
 */
import { MODULE_ID } from "../settings.js";

const L = key => game.i18n.localize(key);

export function prepareEffects(shell, context) {
  const actor = shell.actor;
  const rows = [];
  for ( const effect of actor.allApplicableEffects() ) rows.push(effectRow(effect));
  rows.sort((a, b) => (a.disabled - b.disabled) || (b.temporary - a.temporary) || a.name.localeCompare(b.name, game.i18n.lang));
  context.temporary = rows.filter(r => r.temporary);
  context.passive = rows.filter(r => !r.temporary);
  context.empty = !rows.length;
}

export function effectRow(effect) {
  let source = "";
  try {
    if ( effect.parent instanceof Item ) source = effect.parent.name;
    else if ( typeof effect.sourceName === "string" && (effect.sourceName !== "Unknown") ) source = effect.sourceName;
  } catch(err) { source = ""; }
  let duration = "";
  try { duration = effect.duration?.label ?? ""; } catch(err) { duration = ""; }
  return {
    uuid: effect.uuid,
    id: effect.id,
    name: effect.name,
    img: effect.img,
    disabled: !!effect.disabled,
    suppressed: !!effect.isSuppressed,
    temporary: !!effect.isTemporary,
    duration,
    source,
    statuses: [...(effect.statuses ?? [])].length
  };
}

/** Effects may live on the actor or on one of its items; resolve by uuid relative to the actor. */
export function effectFromTarget(actor, target) {
  const uuid = target.closest("[data-effect-uuid]")?.dataset.effectUuid;
  if ( !uuid ) return null;
  try { return fromUuidSync(uuid, { relative: actor }) ?? null; } catch(err) { return null; }
}

export async function toggleEffect(effect) {
  return effect.update({ disabled: !effect.disabled });
}

export async function deleteEffectConfirm(effect) {
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: effect.name },
    content: `<p>${game.i18n.format("POCKET5E.Effects.DeleteConfirm", { name: effect.name })}</p>`,
    rejectClose: false,
    modal: true
  });
  if ( confirmed ) return effect.delete();
  return null;
}

void MODULE_ID; void L;
