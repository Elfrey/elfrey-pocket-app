/**
 * "Spells" tab: spellcasting summary, slot pips, Ready/All switch, multi-category filters (the Tidy 5e Sheet
 * set: level, school, activation cost, components, misc), search, and spells grouped by level. The
 * "Prepare" button opens the full-screen PrepareDrawer. Tap the image to cast; tap the name for details.
 */
import { prepareRollBar } from "./overview.js";
import { isCastableSpell, byName, activationGroup } from "./items.js";
import { loc, fmtLabel, usesText, signed } from "../actions.js";

const L = key => game.i18n.localize(key);

export const SPELL_FILTER_CATEGORIES = ["level", "school", "activation", "component", "misc"];

/** Fresh, empty filter state. */
export function emptySpellFilters() {
  return Object.fromEntries(SPELL_FILTER_CATEGORIES.map(c => [c, new Set()]));
}

export function prepareSpells(shell, context) {
  prepareRollBar(shell, context);
  const actor = shell.actor;
  const s = actor.system;
  const state = shell.spellState;
  const cfgMethods = CONFIG.DND5E.spellcasting ?? {};
  const spells = actor.itemTypes?.spell ?? [];
  const preparesAny = spells.some(sp => (sp.system.level > 0) && cfgMethods[sp.system.method]?.prepares);

  // Spellcasting summary ------------------------------------------------
  const spellAttr = s.attributes?.spell ?? {};
  const castingClasses = Object.values(actor.spellcastingClasses ?? {});
  context.casting = (castingClasses.length || spells.length) ? {
    classes: castingClasses.map(c => c.name).join(", "),
    // Abbreviation ("Int"), the full label does not fit the stat tile.
    ability: loc(CONFIG.DND5E.abilities?.[s.attributes?.spellcasting]?.abbreviation, spellAttr.abilityLabel ?? ""),
    dc: spellAttr.dc ?? "—",
    attack: Number.isFinite(spellAttr.attack) ? signed(spellAttr.attack) : "—"
  } : null;

  // Slots ---------------------------------------------------------------
  const pips = (value, max) => Array.from({ length: max }, (_, i) => ({ index: i + 1, filled: i < value }));
  const slots = [];
  for ( let n = 1; n <= 9; n++ ) {
    const slot = s.spells?.[`spell${n}`];
    if ( !slot?.max ) continue;
    slots.push({ key: `spell${n}`, label: loc(CONFIG.DND5E.spellLevels?.[n], `${n}`), value: slot.value ?? 0, max: slot.max, pips: pips(slot.value ?? 0, slot.max) });
  }
  const pact = s.spells?.pact;
  if ( pact?.max ) {
    slots.push({
      key: "pact",
      label: `${loc(cfgMethods.pact?.label, "Pact")} · ${loc(CONFIG.DND5E.spellLevels?.[pact.level], pact.level)}`,
      value: pact.value ?? 0, max: pact.max, pips: pips(pact.value ?? 0, pact.max)
    });
  }
  context.slots = slots;

  // Toolbar: ready/all, filters, preparation mode, search ----------------
  const mode = state.filter ?? (preparesAny ? "ready" : "all");
  context.filterModes = [
    { id: "ready", label: L("POCKET5E.Spells.FilterReady") },
    { id: "all", label: L("POCKET5E.Spells.FilterAll") }
  ].map(m => ({ ...m, active: m.id === mode }));
  context.search = state.search;
  context.canPrepare = preparesAny;
  context.filtersOpen = !!state.filtersOpen;
  context.filterGroups = filterGroups(spells, state.active, cfgMethods);
  context.activeFilters = SPELL_FILTER_CATEGORIES.reduce((n, c) => n + state.active[c].size, 0);

  const visible = spells.filter(sp => ((mode === "all") || isCastableSpell(sp)) && matchesFilters(sp, state.active));

  // Rows grouped by level ------------------------------------------------
  const groups = new Map();
  for ( const sp of visible.sort(spellSort) ) {
    const level = sp.system.level ?? 0;
    if ( !groups.has(level) ) groups.set(level, { level, label: loc(CONFIG.DND5E.spellLevels?.[level], `${level}`), rows: [] });
    groups.get(level).rows.push(spellRow(sp, cfgMethods));
  }
  context.spellGroups = [...groups.values()].sort((a, b) => a.level - b.level);
  context.empty = !spells.length;
  context.noneVisible = !!spells.length && !visible.length;
}

/* -------------------------------------------- */

function filterGroups(spells, active, cfgMethods) {
  const chip = (category, value, label) => ({ category, value: String(value), label, active: active[category].has(String(value)) });
  const levels = [...new Set(spells.map(sp => sp.system.level ?? 0))].sort((a, b) => a - b);
  const schools = [...new Set(spells.map(sp => sp.system.school).filter(Boolean))]
    .map(k => [k, loc(CONFIG.DND5E.spellSchools?.[k]?.label, k)])
    .sort((a, b) => a[1].localeCompare(b[1], game.i18n.lang));
  const methods = [...new Set(spells.map(sp => sp.system.method).filter(m => m && (m !== "spell")))];
  const prop = k => loc(CONFIG.DND5E.itemProperties?.[k]?.label, k);
  return [
    { id: "level", label: L("DND5E.SpellLevel"), chips: levels.map(n => chip("level", n, loc(CONFIG.DND5E.spellLevels?.[n], `${n}`))) },
    { id: "school", label: L("DND5E.SpellSchool"), chips: schools.map(([k, label]) => chip("school", k, label)) },
    { id: "activation", label: L("DND5E.ItemActivationCost"), chips: ["action", "bonus", "reaction", "other"].map(k =>
      chip("activation", k, (k === "other") ? L("POCKET5E.Spells.ActivationOther") : loc(CONFIG.DND5E.activityActivationTypes?.[k]?.label, k))) },
    { id: "component", label: L("DND5E.SpellComponents"), chips: ["vocal", "somatic", "material", "ritual", "concentration"].map(k => chip("component", k, prop(k))) },
    { id: "misc", label: L("POCKET5E.Spells.FilterMisc"), chips: [
      chip("misc", "prepared", loc(CONFIG.DND5E.spellPreparationStates?.prepared?.label, "Prepared")),
      chip("misc", "castable", L("POCKET5E.Spells.FilterCastable")),
      ...methods.map(m => chip("misc", `method:${m}`, loc(cfgMethods[m]?.label, m)))
    ] }
  ].filter(g => g.chips.length);
}

/** Selected options within a category are OR-ed, categories are AND-ed (Tidy 5e semantics). */
function matchesFilters(sp, active) {
  const s = sp.system;
  const props = s.properties ?? new Set();
  const activities = s.activities?.contents ?? [];
  const groups = new Set(activities.map(a => activationGroup(a.activation?.type)));
  if ( !activities.length ) groups.add("other");
  const tests = {
    level: v => String(s.level ?? 0) === v,
    school: v => s.school === v,
    activation: v => groups.has(v),
    component: v => !!props.has?.(v),
    misc: v => (v === "prepared") ? ((s.prepared ?? 0) >= 1)
      : (v === "castable") ? isCastableSpell(sp)
      : v.startsWith("method:") ? (s.method === v.slice(7)) : false
  };
  return SPELL_FILTER_CATEGORIES.every(cat => !active[cat].size || [...active[cat]].some(v => tests[cat](v)));
}

function spellSort(a, b) {
  const la = a.system.level ?? 0, lb = b.system.level ?? 0;
  if ( la !== lb ) return la - lb;
  const pa = a.system.prepared ?? 0, pb = b.system.prepared ?? 0;
  if ( pa !== pb ) return pb - pa;
  return byName(a, b);
}

function spellRow(item, cfgMethods) {
  const s = item.system;
  const labels = item.labels ?? {};
  const props = s.properties ?? new Set();
  const method = cfgMethods[s.method];
  const canPrepare = (s.level > 0) && !!method?.prepares && (s.prepared !== 2);
  const activities = s.activities?.contents ?? [];
  const attack = activities.find(a => (a.type === "attack") && (typeof a.rollAttack === "function"));
  const damage = activities.find(a => (typeof a.rollDamage === "function") && ((a.damage?.parts?.length > 0) || ((a.type === "heal") && !!a.healing)));
  const tags = [];
  if ( props.has?.("concentration") ) tags.push({ abbr: L("POCKET5E.Spells.TagConcentration"), title: loc(CONFIG.DND5E.itemProperties?.concentration?.label, "Concentration"), cls: "conc" });
  if ( props.has?.("ritual") ) tags.push({ abbr: L("POCKET5E.Spells.TagRitual"), title: loc(CONFIG.DND5E.itemProperties?.ritual?.label, "Ritual"), cls: "rit" });
  return {
    id: item.id,
    name: item.name,
    img: item.img,
    level: s.level ?? 0,
    school: loc(CONFIG.DND5E.spellSchools?.[s.school]?.label, ""),
    components: fmtLabel(labels.components?.vsm),
    tags,
    activation: fmtLabel(labels.activation),
    range: fmtLabel(labels.range),
    methodLabel: (s.method && (s.method !== "spell")) ? loc(method?.label, s.method) : "",
    prepared: s.prepared ?? 0,
    always: s.prepared === 2,
    canPrepare,
    castable: isCastableSpell(item),
    uses: usesText(s),
    attackId: attack?.id ?? null,
    damageId: damage?.id ?? null,
    hasActivities: activities.length > 0,
    toHit: fmtLabel(attack?.labels?.toHit),
    damage: fmtLabel((damage ?? attack)?.labels?.damage),
    save: fmtLabel(activities.find(a => a.type === "save")?.labels?.save)
  };
}
