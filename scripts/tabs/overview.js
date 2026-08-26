/**
 * Context preparation for the "Overview" tab: HP editor, death saves, combat, stats, senses,
 * concentration, abilities, skills, tools, conditions, exhaustion, rest.
 * Pure data — no DOM. Reads shell state (rollMode, hpEditor, fastRoll) to render controls.
 */
import { signed, loc, activeCombat, actorCombatant, isActorTurn, rollModeOptions, isPublicRollMode } from "../actions.js";

const L = key => game.i18n.localize(key);

export function prepareOverview(shell, context) {
  const actor = shell.actor;
  const s = actor.system;
  const attr = s.attributes ?? {};

  prepareRollBar(shell, context);

  // HP editor ------------------------------------------------------------
  const modeLabels = {
    damage: L("POCKET5E.Overview.Damage"),
    heal: L("POCKET5E.Overview.Heal"),
    temp: L("POCKET5E.Overview.TempHP")
  };
  context.hpModes = Object.entries(modeLabels).map(([id, label]) => ({
    id, label, cls: `mode-${id}`, active: id === shell.hpEditor.mode
  }));
  context.hpEditor = { ...shell.hpEditor, applyLabel: modeLabels[shell.hpEditor.mode] };

  // Death saves ----------------------------------------------------------
  const death = attr.death ?? { success: 0, failure: 0 };
  const hp = attr.hp ?? {};
  const pips = (count, filledCount) => Array.from({ length: 3 }, (_, i) => ({ index: i + 1, filled: i < filledCount }));
  context.death = {
    show: (hp.value ?? 0) <= 0 || death.success > 0 || death.failure > 0,
    success: pips(3, death.success ?? 0),
    failure: pips(3, death.failure ?? 0)
  };

  // Combat ---------------------------------------------------------------
  const combat = activeCombat();
  const combatant = actorCombatant(actor, combat);
  const myTurn = isActorTurn(actor, combat);
  let combatText = L("POCKET5E.Overview.NoCombat");
  if ( myTurn ) combatText = L("POCKET5E.Overview.YourTurn");
  else if ( combat ) {
    combatText = game.i18n.format("POCKET5E.Overview.CombatRound", {
      round: combat.round ?? 0,
      status: combatant
        ? game.i18n.format("POCKET5E.Overview.InitiativeValue", { init: combatant.initiative ?? "—" })
        : L("POCKET5E.Overview.NotInCombat")
    });
  }
  context.combat = { active: !!combat, inCombat: !!combatant, myTurn, text: combatText };

  // Stats & senses -------------------------------------------------------
  const units = CONFIG.DND5E.movementUnits?.[attr.movement?.units];
  const unitLabel = loc(units?.abbreviation ?? units, attr.movement?.units ?? "");
  const speeds = ["fly", "swim", "climb", "burrow"]
    .filter(k => attr.movement?.[k] > 0)
    .map(k => `${loc(CONFIG.DND5E.movementTypes?.[k], k)} ${attr.movement[k]}`);
  context.stats = [
    { label: L("POCKET5E.Overview.AC"), value: attr.ac?.value ?? "—" },
    { label: L("POCKET5E.Overview.Init"), value: signed(attr.init?.total ?? 0) },
    { label: L("POCKET5E.Overview.Prof"), value: signed(attr.prof ?? 0) },
    { label: L("POCKET5E.Overview.Speed"), value: `${attr.movement?.walk ?? "—"} ${unitLabel}`.trim(), sub: speeds.join(", ") || null },
    { label: L("POCKET5E.Overview.PassivePerception"), value: s.skills?.prc?.passive ?? "—" },
    { label: L("POCKET5E.Overview.Level"), value: s.details?.level ?? "—" }
  ];
  const senseUnits = loc(CONFIG.DND5E.movementUnits?.[attr.senses?.units]?.abbreviation, attr.senses?.units ?? "");
  const senses = Object.entries(CONFIG.DND5E.senses ?? {})
    .filter(([k]) => attr.senses?.[k] > 0)
    .map(([k, label]) => `${loc(label, k)} ${attr.senses[k]} ${senseUnits}`.trim());
  if ( attr.senses?.special ) senses.push(attr.senses.special);
  context.senses = senses.join(" · ");

  // Concentration --------------------------------------------------------
  const conc = actor.concentration;
  if ( conc?.effects?.size ) {
    const names = [...conc.items].map(i => i.name);
    if ( !names.length ) names.push(...[...conc.effects].map(e => e.name));
    context.concentration = { names: names.join(", ") };
  }

  // Abilities ------------------------------------------------------------
  const cfgAbilities = CONFIG.DND5E.abilities ?? {};
  context.abilities = Object.entries(s.abilities ?? {}).map(([key, a]) => ({
    key,
    label: loc(cfgAbilities[key]?.label, key),
    abbr: loc(cfgAbilities[key]?.abbreviation, key),
    value: a.value,
    mod: signed(a.mod),
    save: signed(a.save?.value ?? a.save),
    proficient: !!a.proficient
  }));

  // Skills ---------------------------------------------------------------
  const profClass = v => (v >= 2) ? "2" : (v >= 1) ? "1" : (v > 0) ? "half" : "0";
  const profLabel = v => loc(CONFIG.DND5E.proficiencyLevels?.[v], "");
  const cfgSkills = CONFIG.DND5E.skills ?? {};
  context.skills = Object.entries(s.skills ?? {}).map(([key, sk]) => ({
    key,
    label: loc(cfgSkills[key]?.label, key),
    ability: loc(cfgAbilities[sk.ability]?.abbreviation, sk.ability ?? ""),
    total: signed(sk.total ?? sk.mod ?? 0),
    passive: sk.passive ?? "",
    profClass: profClass(sk.value ?? 0),
    profLabel: profLabel(sk.value ?? 0)
  })).sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));

  // Tools ----------------------------------------------------------------
  const keyLabel = globalThis.dnd5e?.documents?.Trait?.keyLabel;
  context.tools = Object.entries(s.tools ?? {}).map(([key, tool]) => {
    let label = key;
    try { label = keyLabel?.(key, { trait: "tool" }) ?? key; } catch(err) { /* keep key */ }
    return {
      key,
      label: typeof label === "string" ? label : key,
      ability: loc(cfgAbilities[tool.ability]?.abbreviation, tool.ability ?? ""),
      total: signed(tool.total ?? tool.mod ?? 0),
      profClass: profClass(tool.value ?? 0),
      profLabel: profLabel(tool.value ?? 0)
    };
  }).sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));

  // Conditions & exhaustion ---------------------------------------------
  const statuses = actor.statuses ?? new Set();
  context.conditions = Object.entries(CONFIG.DND5E.conditionTypes ?? {})
    .filter(([id, c]) => !c.pseudo && (id !== "exhaustion"))
    .map(([id, c]) => ({ id, name: loc(c.name, id), img: c.img, active: statuses.has(id) }))
    .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
  const exLevels = CONFIG.DND5E.conditionTypes?.exhaustion?.levels ?? 6;
  const exCurrent = attr.exhaustion ?? 0;
  context.exhaustion = {
    label: loc(CONFIG.DND5E.conditionTypes?.exhaustion?.name, "Exhaustion"),
    level: exCurrent,
    pips: Array.from({ length: exLevels }, (_, i) => ({ level: i + 1, filled: i < exCurrent }))
  };

  // Rest -----------------------------------------------------------------
  context.hitDice = `${attr.hd?.value ?? "—"} / ${attr.hd?.max ?? "—"}`;
  context.hasHitDice = (attr.hd?.value ?? 0) > 0;
}

/** Shared by the overview roll bar and the chat drawer header. */
export function rollPrivacyContext() {
  const modes = rollModeOptions();
  const current = modes.find(m => m.active) ?? modes[0];
  return { modes, current, isPublic: isPublicRollMode(current?.id) };
}

/** Roll modifier bar (advantage/disadvantage, fast rolls, privacy) — shared by Overview, Actions and Spells. */
export function prepareRollBar(shell, context) {
  context.rollModes = [
    { id: "normal", label: L("POCKET5E.Overview.RollNormal"), icon: "fa-solid fa-dice-d20" },
    { id: "advantage", label: L("POCKET5E.Overview.RollAdvantage"), icon: "fa-solid fa-angles-up" },
    { id: "disadvantage", label: L("POCKET5E.Overview.RollDisadvantage"), icon: "fa-solid fa-angles-down" }
  ].map(m => ({ ...m, active: m.id === shell.rollMode }));
  context.fastRoll = shell.fastRoll;
  context.rollPrivacy = rollPrivacyContext();
  return context;
}
