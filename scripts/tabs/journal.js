/**
 * "Journal" section (under More). With Tidy 5e Sheet active the entries are Tidy's own journal
 * (flags.tidy5e-sheet.document-journal: { [id]: { id, title, value, sort } }) so both sheets show the same
 * text; otherwise the same shape lives in this module's flags. Plain textarea editing; enriched view.
 */
import { MODULE_ID } from "../settings.js";

const TIDY = "tidy5e-sheet";
const TIDY_KEY = "document-journal";

export function usesTidyJournal() {
  return game.modules.get(TIDY)?.active === true;
}

function flagPath() {
  return usesTidyJournal() ? `flags.${TIDY}.${TIDY_KEY}` : `flags.${MODULE_ID}.journal`;
}

/** Entries in display order: [{key, id, title, value, sort}]. */
export function journalEntries(actor) {
  const source = foundry.utils.getProperty(actor, flagPath()) ?? {};
  return Object.entries(source)
    .filter(([, e]) => e && (typeof e === "object"))
    .map(([key, e]) => ({ key, id: e.id ?? key, title: e.title ?? "", value: e.value ?? "", sort: Number(e.sort) || 0 }))
    .sort((a, b) => a.sort - b.sort);
}

async function enrich(html, actor) {
  if ( !html ) return "";
  if ( !/<[a-z][\s\S]*>/i.test(html) ) html = foundry.utils.escapeHTML(html).replace(/\n/g, "<br>");
  try {
    const TextEditor = foundry.applications.ux.TextEditor.implementation;
    return await TextEditor.enrichHTML(html, { secrets: actor.isOwner, rollData: actor.getRollData?.() ?? {}, relativeTo: actor });
  } catch(err) {
    return html;
  }
}

export async function prepareJournal(shell, context) {
  const actor = shell.actor;
  const state = shell.journalState;
  const entries = journalEntries(actor);
  context.tidy = usesTidyJournal();
  context.entries = [];
  for ( const [i, e] of entries.entries() ) {
    const editing = state.editing === e.key;
    const expanded = editing || state.expanded.has(e.key) || (entries.length === 1);
    context.entries.push({
      ...e,
      title: e.title || game.i18n.format("POCKET5E.Journal.Untitled", { n: i + 1 }),
      rawTitle: e.title,
      editing,
      expanded,
      draft: editing ? (state.drafts[e.key] ?? e.value) : "",
      enriched: (expanded && !editing) ? await enrich(e.value, actor) : "",
      isEmpty: !e.value
    });
  }
  context.empty = !entries.length;
}

export async function addEntry(actor) {
  const entries = journalEntries(actor);
  const id = foundry.utils.randomID();
  const sort = (entries.at(-1)?.sort ?? 0) + CONST.SORT_INTEGER_DENSITY;
  await actor.update({ [`${flagPath()}.${id}`]: { id, title: "", value: "", sort } });
  return id;
}

export async function saveEntry(actor, key, { title, value }) {
  const path = `${flagPath()}.${key}`;
  return actor.update({ [`${path}.title`]: title ?? "", [`${path}.value`]: value ?? "" });
}

export async function deleteEntryConfirm(actor, key, title) {
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title },
    content: `<p>${game.i18n.format("POCKET5E.Journal.DeleteConfirm", { name: title })}</p>`,
    rejectClose: false,
    modal: true
  });
  if ( !confirmed ) return null;
  return actor.update({ [`${flagPath()}.-=${key}`]: null });
}
