/**
 * PocketShell — the full-screen mobile application (ApplicationV2 + Handlebars parts).
 *
 * Layout (parts are direct children of the app element, laid out by CSS grid):
 *   topbar · [overview | favorites | features | inventory | spells | more] (tabs) · tabbar · chat drawer
 * "More" hosts second-level sections (actions, biography, journal, effects) picked from a popup on the tab bar.
 *
 * Reactivity: document hooks mark parts dirty; a 50 ms debounce re-renders only those parts.
 * UI state that must survive re-renders lives on the instance (tabGroups, rollMode, hpEditor, per-tab
 * state objects) or as classes on the root element (menu-open, chat-open, more-open).
 */
import { MODULE_ID, SETTINGS, MODE } from "../settings.js";
import {
  performRoll, applyHP, setExhaustion, setDeathSaves, toggleCondition, endConcentration, endTurn, actorSummary,
  setRollMode, useItem, rollActivityAttack, rollActivityDamage, rollActivityFormula, toggleEquipped, toggleAttuned,
  changeQuantity, updateCurrency, togglePrepared, setSpellSlot, haptic, getRollMode
} from "../actions.js";
import { relayEnabled, designatedGM, needsTargets, requestUse } from "../relay.js";
import { TargetPicker } from "./target-picker.js";
import { THEMES, currentTheme, resolveTheme } from "../theme.js";
import { prepareOverview, rollPrivacyContext } from "../tabs/overview.js";
import { prepareActions } from "../tabs/actions.js";
import { prepareInventory } from "../tabs/inventory.js";
import { prepareSpells, emptySpellFilters } from "../tabs/spells.js";
import { prepareFavorites } from "../tabs/favorites.js";
import { prepareFeatures } from "../tabs/features.js";
import { prepareBiography, saveBiography } from "../tabs/biography.js";
import { prepareJournal, journalEntries, addEntry, saveEntry, deleteEntryConfirm } from "../tabs/journal.js";
import { prepareEffects, effectFromTarget, toggleEffect, deleteEffectConfirm } from "../tabs/effects.js";
import { ChatPanel } from "./chat.js";
import { ItemDrawer } from "./item-drawer.js";
import { PrepareDrawer } from "./prepare-drawer.js";
import { openFullSheet } from "./full-sheet.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const T = `modules/${MODULE_ID}/templates`;
const TAB = { classes: ["tab", "pocket5e-tab"], scrollable: [""] };
const L = key => game.i18n.localize(key);
const HP_MODE_LABEL = { damage: "POCKET5E.Overview.Damage", heal: "POCKET5E.Overview.Heal", temp: "POCKET5E.Overview.TempHP" };

export class PocketShell extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ actor, onSwitchCharacter, ...options }={}) {
    super(options);
    this.actor = actor;
    this.#onSwitchCharacterCb = onSwitchCharacter;
    this.chat = new ChatPanel(this);
    // Reopen on the tab used last time.
    const last = localStorage.getItem(`${MODULE_ID}.lastTab`);
    if ( PocketShell.TABS.primary.tabs.some(t => t.id === last) ) this.tabGroups.primary = last;
  }

  /** @override */
  changeTab(tab, group, options={}) {
    super.changeTab(tab, group, options);
    if ( group === "primary" ) localStorage.setItem(`${MODULE_ID}.lastTab`, tab);
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "pocket5e-shell",
    classes: ["pocket5e-app", "pocket5e-shell"],
    window: { frame: false, positioned: false },
    actions: {
      toggleMenu: PocketShell.#onToggleMenu,
      toggleChat: PocketShell.#onToggleChat,
      switchCharacter: PocketShell.#onSwitchCharacter,
      fullSheet: PocketShell.#onFullSheet,
      fullClient: PocketShell.#onFullClient,
      logout: PocketShell.#onLogout,
      diagnostics: PocketShell.#onDiagnostics,
      setTheme: PocketShell.#onSetTheme,
      roll: PocketShell.#onRoll,
      rollMode: PocketShell.#onRollMode,
      fastRoll: PocketShell.#onFastRoll,
      rollPrivacy: PocketShell.#onRollPrivacy,
      setRollPrivacy: PocketShell.#onSetRollPrivacy,
      hpMode: PocketShell.#onHpMode,
      hpStep: PocketShell.#onHpStep,
      hpApply: PocketShell.#onHpApply,
      deathPip: PocketShell.#onDeathPip,
      exhaustion: PocketShell.#onExhaustion,
      condition: PocketShell.#onCondition,
      endConcentration: PocketShell.#onEndConcentration,
      endTurn: PocketShell.#onEndTurn,
      openItem: PocketShell.#onOpenItem,
      useItem: PocketShell.#onUseItem,
      attack: PocketShell.#onAttack,
      damage: PocketShell.#onDamage,
      formula: PocketShell.#onFormula,
      toggleEquip: PocketShell.#onToggleEquip,
      toggleAttune: PocketShell.#onToggleAttune,
      quantity: PocketShell.#onQuantity,
      toggleContainer: PocketShell.#onToggleContainer,
      toggleAttunement: PocketShell.#onToggleAttunement,
      editCurrency: PocketShell.#onEditCurrency,
      saveCurrency: PocketShell.#onSaveCurrency,
      cancelCurrency: PocketShell.#onCancelCurrency,
      togglePrepared: PocketShell.#onTogglePrepared,
      spellSlot: PocketShell.#onSpellSlot,
      spellFilter: PocketShell.#onSpellFilter,
      spellFiltersToggle: PocketShell.#onSpellFiltersToggle,
      spellFilterChip: PocketShell.#onSpellFilterChip,
      spellFiltersClear: PocketShell.#onSpellFiltersClear,
      spellPrepareMode: PocketShell.#onSpellPrepareMode,
      moreMenu: PocketShell.#onMoreMenu,
      moreSection: PocketShell.#onMoreSection,
      effectToggle: PocketShell.#onEffectToggle,
      effectDelete: PocketShell.#onEffectDelete,
      bioEdit: PocketShell.#onBioEdit,
      bioSave: PocketShell.#onBioSave,
      bioCancel: PocketShell.#onBioCancel,
      journalAdd: PocketShell.#onJournalAdd,
      journalToggle: PocketShell.#onJournalToggle,
      journalEdit: PocketShell.#onJournalEdit,
      journalSave: PocketShell.#onJournalSave,
      journalCancel: PocketShell.#onJournalCancel,
      journalDelete: PocketShell.#onJournalDelete
    }
  };

  /** @override */
  static TABS = {
    primary: {
      initial: "overview",
      labelPrefix: "POCKET5E.Tabs",
      tabs: [
        { id: "overview",  icon: "fa-solid fa-heart-pulse" },
        { id: "favorites", icon: "fa-solid fa-star" },
        { id: "features",  icon: "fa-solid fa-sparkles" },
        { id: "inventory", icon: "fa-solid fa-suitcase" },
        { id: "spells",    icon: "fa-solid fa-wand-sparkles" },
        { id: "more",      icon: "fa-solid fa-ellipsis" }
      ]
    }
  };

  /** @override */
  static PARTS = {
    topbar:    { template: `${T}/shell/topbar.hbs` },
    overview:  { template: `${T}/tabs/overview.hbs`,  ...TAB },
    favorites: { template: `${T}/tabs/favorites.hbs`, ...TAB },
    features:  { template: `${T}/tabs/features.hbs`,  ...TAB },
    inventory: { template: `${T}/tabs/inventory.hbs`, ...TAB },
    spells:    { template: `${T}/tabs/spells.hbs`,    ...TAB },
    more:      { template: `${T}/tabs/more.hbs`,      ...TAB },
    tabbar:    { template: `${T}/shell/tabbar.hbs` },
    chat:      { template: `${T}/shell/chat.hbs` }
  };

  /** Parts that show actor data and must refresh when it changes. */
  static ACTOR_PARTS = ["topbar", "overview", "favorites", "features", "inventory", "spells", "more"];

  /** Second-level sections reachable from the "More" popup. */
  static SECTIONS = [
    { id: "actions",   icon: "fa-solid fa-hand-fist", label: "POCKET5E.Tabs.actions" },
    { id: "biography", icon: "fa-solid fa-book",      label: "POCKET5E.More.Biography" },
    { id: "journal",   icon: "fa-solid fa-feather",   label: "POCKET5E.More.Journal" },
    { id: "effects",   icon: "fa-solid fa-bolt",      label: "POCKET5E.More.Effects" }
  ];

  /** @type {Actor} */
  actor;
  /** @type {ChatPanel} */
  chat;
  /** One-shot roll modifier for the next roll: "normal" | "advantage" | "disadvantage". */
  rollMode = "normal";
  /** HP editor state; kept here so it survives re-renders. */
  hpEditor = { mode: "damage", amount: 1 };
  /** Inventory tab state. */
  inventoryState = { filter: "", expanded: new Set(), currencyEditing: false, attunementOpen: false };
  /** Spells tab state: ready/all switch (null = auto), search, filter panel, category filters. */
  spellState = { filter: null, search: "", filtersOpen: false, active: emptySpellFilters() };
  /** "More": which second-level section is shown (null = none picked yet). */
  moreState = { section: null };
  /** Biography edit mode. */
  bioState = { editing: false };
  /** Journal: entry being edited, unsaved drafts per entry, expanded entries. */
  journalState = { editing: null, drafts: {}, expanded: new Set() };

  #onSwitchCharacterCb;
  #hooks = [];
  #pending = new Set();
  #flush = foundry.utils.debounce(() => {
    const parts = [...this.#pending];
    this.#pending.clear();
    if ( !this.rendered || !parts.length ) return;
    this.render({ parts });
  }, 50);

  /** Skip roll configuration dialogs (client setting). */
  get fastRoll() {
    return !!game.settings.get(MODULE_ID, SETTINGS.FAST_ROLL);
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** Mount inside the app root instead of document.body. */
  _insertElement(element) {
    const root = document.getElementById("pocket5e-root") ?? document.body;
    root.querySelector(".pocket5e-boot")?.remove();
    const existing = document.getElementById(element.id);
    if ( existing ) existing.replaceWith(element);
    else root.append(element);
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const hp = actor.system.attributes?.hp ?? {};
    const current = this.#currentSection();
    return Object.assign(context, {
      actor,
      system: actor.system,
      user: game.user,
      world: game.world,
      summary: actorSummary(actor),
      hp: { value: hp.value ?? 0, max: hp.max ?? 0, temp: hp.temp || 0, pct: Math.round(hp.pct ?? 0) },
      unread: this.chat.unread,
      moreSections: this.#sectionList(),
      moreIcon: current?.icon ?? null,
      moreLabel: current ? L(current.label) : null,
      themes: THEMES.map(id => ({
        id, label: L(`POCKET5E.Theme.${id}`), active: id === currentTheme(),
        icon: { system: "fa-solid fa-circle-half-stroke", dark: "fa-solid fa-moon", light: "fa-solid fa-sun" }[id]
      }))
    });
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    context.tab = context.tabs?.[partId];
    switch ( partId ) {
      case "overview": prepareOverview(this, context); break;
      case "favorites": prepareFavorites(this, context); break;
      case "features": prepareFeatures(this, context); break;
      case "inventory": prepareInventory(this, context); break;
      case "spells": prepareSpells(this, context); break;
      case "more": await this.#prepareMore(context); break;
      case "chat":
        context.rollPrivacy = rollPrivacyContext();
        context.quickDice = ChatPanel.quickDice;
        context.chatTheme = `theme-${resolveTheme()}`;   // dnd5e cards: parchment in light, denim in dark
        break;
    }
    return context;
  }

  #currentSection() {
    return PocketShell.SECTIONS.find(sec => sec.id === this.moreState.section) ?? null;
  }

  #sectionList() {
    const actor = this.actor;
    let effects = 0;
    try { effects = Array.from(actor.allApplicableEffects()).length; } catch(err) { effects = 0; }
    const counts = {
      actions: actor.items.filter(i => i.system?.activities?.size && (i.type !== "spell")).length,
      journal: journalEntries(actor).length,
      effects,
      biography: 0
    };
    return PocketShell.SECTIONS.map(sec => ({
      ...sec, label: L(sec.label), count: counts[sec.id] || null, active: sec.id === this.moreState.section
    }));
  }

  async #prepareMore(context) {
    const current = this.#currentSection();
    context.sections = context.moreSections;
    context.section = current ? { ...current, label: L(current.label) } : null;
    switch ( current?.id ) {
      case "actions": prepareActions(this, context); break;
      case "biography": await prepareBiography(this, context); break;
      case "journal": await prepareJournal(this, context); break;
      case "effects": prepareEffects(this, context); break;
    }
  }

  /** Load metrics and versions for the ⋮ → Diagnostics dialog. */
  #diagnostics() {
    const P = globalThis.POCKET5E ?? {};
    const ms = (a, b) => (a && b) ? `${Math.round(b - a)} ms` : "—";
    return [
      { label: L("POCKET5E.More.Payload"), value: P.payloadBytes ? `${(P.payloadBytes / 1048576).toFixed(1)} MB` : "—" },
      { label: L("POCKET5E.More.TimeCore"), value: ms(P.t0, P.tSystem) },
      { label: L("POCKET5E.More.TimeWorld"), value: ms(P.tWorld, P.tData) },
      { label: L("POCKET5E.More.TimeReady"), value: ms(P.t0, P.tReady) },
      { label: L("POCKET5E.More.Documents"), value: `${game.actors.size} / ${game.items.size} / ${game.scenes.size} / ${game.messages.size}` },
      { label: L("POCKET5E.More.ModulesSkipped"), value: game.modules.filter(m => m.active && (m.id !== MODULE_ID)).length },
      { label: L("POCKET5E.More.Versions"), value: `Foundry ${game.version} · dnd5e ${game.system.version} · app ${game.modules.get(MODULE_ID)?.version ?? "dev"}` },
      ...(P.payloadBreakdown ?? []).slice(0, 5).map(([key, bytes]) => ({
        label: `${L("POCKET5E.More.Breakdown")}: ${key}`, value: `${(bytes / 1048576).toFixed(1)} MB`
      }))
    ];
  }

  /* -------------------------------------------- */
  /*  Lifecycle                                   */
  /* -------------------------------------------- */

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.#registerHooks();
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const parts = options.parts ?? [];
    if ( parts.includes("chat") ) {
      this.chat.attach(this.element.querySelector(".pocket5e-chat-drawer"));
    }
    if ( parts.includes("inventory") ) {
      for ( const input of this.element.querySelectorAll("input[name^='currency.']") ) {
        input.addEventListener("keydown", event => {
          if ( event.key !== "Enter" ) return;
          event.preventDefault();
          input.blur();
          this.element.querySelector("[data-action=saveCurrency]")?.click();
        });
      }
      const search = this.element.querySelector("input[name=inventoryFilter]");
      search?.addEventListener("input", () => {
        this.inventoryState.filter = search.value;
        this.#applyListFilter("inventory", this.inventoryState.filter);
      });
      this.#applyListFilter("inventory", this.inventoryState.filter);
    }
    if ( parts.includes("spells") ) {
      const search = this.element.querySelector("input[name=spellSearch]");
      search?.addEventListener("input", () => {
        this.spellState.search = search.value;
        this.#applyListFilter("spells", this.spellState.search);
      });
      this.#applyListFilter("spells", this.spellState.search);
    }
    if ( parts.includes("more") ) {
      const editor = this.element.querySelector(".pocket5e-journal-entry.editing textarea[name=entryValue]");
      editor?.addEventListener("input", () => { this.journalState.drafts[this.journalState.editing] = editor.value; });
    }
    if ( parts.includes("overview") ) {
      const input = this.element.querySelector("input[name=hpAmount]");
      input?.addEventListener("change", () => { this.hpEditor.amount = this.#readHpAmount(); });
      input?.addEventListener("keydown", event => {
        if ( event.key !== "Enter" ) return;
        event.preventDefault();
        input.blur();
        this.element.querySelector("[data-action=hpApply]")?.click();
      });
    }
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    this.#unregisterHooks();
    this.chat.detach();
  }

  /** Mark parts dirty; they re-render together after a short debounce. */
  refresh(...parts) {
    for ( const p of parts ) this.#pending.add(p);
    this.#flush();
  }

  #registerHooks() {
    const on = (name, fn) => this.#hooks.push([name, Hooks.on(name, fn)]);
    const isMine = doc => (doc === this.actor) || (doc?.parent === this.actor) || (doc?.parent?.parent === this.actor);
    const partsForItem = item => {
      const type = item.type;
      if ( type === "spell" ) return ["spells", "favorites", "more"];
      if ( ["feat", "class", "subclass", "race", "background"].includes(type) ) return ["features", "more", "favorites", "topbar", "overview"];
      return ["inventory", "more", "favorites", "overview"];
    };

    on("updateActor", actor => { if ( actor === this.actor ) this.refresh(...PocketShell.ACTOR_PARTS); });
    on("deleteActor", actor => { if ( actor === this.actor ) this.#onSwitchCharacterCb?.(); });
    for ( const evt of ["createItem", "updateItem", "deleteItem"] ) {
      on(evt, item => { if ( item.parent === this.actor ) this.refresh(...partsForItem(item)); });
    }
    for ( const evt of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"] ) {
      on(evt, effect => { if ( isMine(effect) ) this.refresh("topbar", "overview", "more", "favorites", "tabbar"); });
    }
    for ( const evt of ["createCombat", "updateCombat", "deleteCombat", "createCombatant", "updateCombatant", "deleteCombatant"] ) {
      on(evt, () => this.refresh("overview"));
    }
    on("dnd5e.restCompleted", actor => { if ( actor === this.actor ) this.refresh("overview", "features", "spells", "more"); });
    on("pocket5e.themeChanged", () => this.refresh("topbar", "chat"));
  }

  #unregisterHooks() {
    for ( const [name, id] of this.#hooks ) Hooks.off(name, id);
    this.#hooks = [];
  }

  #error(err) {
    console.error(`${MODULE_ID} |`, err);
    ui.notifications.error(err?.message ?? String(err));
  }

  /* -------------------------------------------- */
  /*  Roll modifiers shared with other apps       */
  /* -------------------------------------------- */

  /** Options for a roll started by `event`: one-shot advantage/disadvantage plus the fast-roll setting. */
  rollOptions(event) {
    return {
      event,
      advantage: this.rollMode === "advantage",
      disadvantage: this.rollMode === "disadvantage",
      fast: this.fastRoll
    };
  }

  /**
   * Use an activity — through the GM relay when it applies (midi-qol world, GM online), locally otherwise.
   * The relay needs a concrete activity: an item with several and none chosen falls back to the local dnd5e flow.
   * @param {Item5e} item
   * @param {Activity|null} activity
   * @param {Event} [event]
   * @returns {Promise<*>}   null when the player dismissed the target picker.
   */
  async useActivity(item, activity, event) {
    activity ??= (item.system?.activities?.size === 1) ? item.system.activities.contents[0] : null;
    if ( !activity || !relayEnabled() ) return useItem(item, activity);
    if ( !designatedGM() ) {
      ui.notifications.warn(game.i18n.localize("POCKET5E.Relay.NoGM"));
      return useItem(item, activity);
    }
    let targetUuids = [];
    if ( needsTargets(activity) ) {
      const picked = await TargetPicker.pick({ actor: this.actor, activity });
      if ( picked === null ) return null;
      targetUuids = picked;
    }
    const { advantage, disadvantage } = this.rollOptions(event);
    const result = await requestUse(activity, { targetUuids, advantage, disadvantage, rollMode: getRollMode() });
    this.consumeRollMode();
    ui.notifications.info(game.i18n.localize("POCKET5E.Relay.Sent"));
    return result;
  }

  /** The advantage/disadvantage choice applies to one roll only. */
  consumeRollMode() {
    if ( this.rollMode === "normal" ) return;
    this.rollMode = "normal";
    this.#syncRollModeUI();
  }

  /* -------------------------------------------- */
  /*  Imperative UI sync (avoids re-rendering)    */
  /* -------------------------------------------- */

  /** Generic name filter for a tab's `[data-name]` rows and `[data-group-id]` groups. */
  #applyListFilter(tabId, text) {
    const q = (text ?? "").trim().toLowerCase();
    const tab = this.element.querySelector(`.pocket5e-tab[data-tab="${tabId}"]`);
    if ( !tab ) return;
    for ( const row of tab.querySelectorAll(".pocket5e-item[data-name]") ) {
      row.hidden = !!q && !row.dataset.name.toLowerCase().includes(q);
    }
    for ( const group of tab.querySelectorAll("[data-group-id]") ) {
      group.hidden = !!q && !group.querySelector(".pocket5e-item[data-name]:not([hidden])");
    }
  }

  #itemFor(target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    return id ? this.actor.items.get(id) ?? null : null;
  }

  #activityFor(item, target) {
    const id = target.closest("[data-activity-id]")?.dataset.activityId;
    return (item && id) ? item.system.activities?.get(id) ?? null : null;
  }

  async #guard(target, fn) {
    if ( target ) target.disabled = true;
    try {
      await fn();
    } catch(err) {
      this.#error(err);
    } finally {
      if ( target ) target.disabled = false;
    }
  }

  #syncRollModeUI() {
    for ( const b of this.element.querySelectorAll("[data-action=rollMode]") ) {
      b.classList.toggle("active", b.dataset.mode === this.rollMode);
    }
    for ( const b of this.element.querySelectorAll("[data-action=fastRoll]") ) b.classList.toggle("active", this.fastRoll);
  }

  /** Update every roll-privacy control (roll bars, chat header) after the setting changed. */
  #syncPrivacyUI() {
    const { current, isPublic } = rollPrivacyContext();
    for ( const box of this.element.querySelectorAll(".pocket5e-privacy") ) {
      box.classList.remove("open");
      const btn = box.querySelector(".pocket5e-privacy-btn");
      if ( btn && current ) {
        btn.classList.toggle("nonpublic", !isPublic);
        btn.title = `${L("POCKET5E.Overview.RollPrivacy")}: ${current.label}`;
        const icon = btn.querySelector("i");
        if ( icon ) icon.className = current.icon;
      }
      for ( const b of box.querySelectorAll("[data-action=setRollPrivacy]") ) {
        b.classList.toggle("active", b.dataset.mode === current?.id);
      }
    }
  }

  #syncHpEditorUI() {
    const root = this.element;
    for ( const b of root.querySelectorAll("[data-action=hpMode]") ) {
      b.classList.toggle("active", b.dataset.mode === this.hpEditor.mode);
    }
    const editor = root.querySelector(".pocket5e-hp-editor");
    if ( editor ) editor.className = `pocket5e-hp-editor mode-${this.hpEditor.mode}`;
    const apply = root.querySelector("[data-action=hpApply]");
    if ( apply ) apply.textContent = L(HP_MODE_LABEL[this.hpEditor.mode]);
    const input = root.querySelector("input[name=hpAmount]");
    if ( input ) input.value = String(this.hpEditor.amount);
  }

  #readHpAmount() {
    const input = this.element.querySelector("input[name=hpAmount]");
    return Math.max(0, Math.floor(Number(input?.value) || 0));
  }

  closeMenu() {
    this.element.classList.remove("menu-open");
  }

  /* -------------------------------------------- */
  /*  Actions: shell & menu                       */
  /* -------------------------------------------- */

  static #onToggleMenu() {
    this.element.classList.toggle("menu-open");
  }

  static #onToggleChat() {
    this.chat.toggle();
  }

  static #onSwitchCharacter() {
    this.closeMenu();
    this.#onSwitchCharacterCb?.();
  }

  static #onFullSheet() {
    this.closeMenu();
    openFullSheet(this.actor);
  }

  static async #onFullClient() {
    await game.settings.set(MODULE_ID, SETTINGS.MODE, MODE.OFF);
    window.location.href = foundry.utils.getRoute("game");
  }

  static #onLogout() {
    game.logOut();
  }

  static async #onSetTheme(event, target) {
    const theme = target.dataset.theme;
    if ( !THEMES.includes(theme) ) return;
    await game.settings.set(MODULE_ID, SETTINGS.THEME, theme);   // onChange applies it and fires pocket5e.themeChanged
  }

  static async #onDiagnostics() {
    this.closeMenu();
    const rows = this.#diagnostics().map(r => `<dt>${foundry.utils.escapeHTML(r.label)}</dt><dd>${foundry.utils.escapeHTML(String(r.value))}</dd>`).join("");
    await foundry.applications.api.DialogV2.prompt({
      window: { title: L("POCKET5E.More.Diagnostics") },
      classes: ["pocket5e-dialog"],
      content: `<dl class="pocket5e-dl pocket5e-diag">${rows}</dl>`,
      ok: { label: "OK" },
      rejectClose: false
    });
  }

  /* -------------------------------------------- */
  /*  Actions: rolls & overview                   */
  /* -------------------------------------------- */

  static async #onRoll(event, target) {
    haptic();
    await this.#guard(target, () => performRoll(this.actor, target.dataset.roll, this.rollOptions(event)));
    this.consumeRollMode();
  }

  static #onRollMode(event, target) {
    this.rollMode = target.dataset.mode ?? "normal";
    this.#syncRollModeUI();
  }

  static async #onFastRoll() {
    await game.settings.set(MODULE_ID, SETTINGS.FAST_ROLL, !this.fastRoll);
    this.#syncRollModeUI();
  }

  static #onRollPrivacy(event, target) {
    const box = target.closest(".pocket5e-privacy");
    const open = !box?.classList.contains("open");
    for ( const other of this.element.querySelectorAll(".pocket5e-privacy.open") ) other.classList.remove("open");
    if ( open ) box?.classList.add("open");
  }

  static async #onSetRollPrivacy(event, target) {
    try {
      await setRollMode(target.dataset.mode);
    } catch(err) {
      this.#error(err);
    }
    this.#syncPrivacyUI();
  }

  static #onHpMode(event, target) {
    this.hpEditor.mode = target.dataset.mode ?? "damage";
    this.#syncHpEditorUI();
  }

  static #onHpStep(event, target) {
    const step = Number(target.dataset.step) || 0;
    this.hpEditor.amount = Math.max(0, this.#readHpAmount() + step);
    this.#syncHpEditorUI();
  }

  static async #onHpApply(event, target) {
    this.hpEditor.amount = this.#readHpAmount();
    if ( !this.hpEditor.amount ) return;
    await this.#guard(target, () => applyHP(this.actor, this.hpEditor.mode, this.hpEditor.amount));
  }

  static async #onDeathPip(event, target) {
    const kind = target.dataset.kind;
    const index = Number(target.dataset.index) || 0;
    const current = this.actor.system.attributes?.death?.[kind] ?? 0;
    await this.#guard(null, () => setDeathSaves(this.actor, { [kind]: index === current ? index - 1 : index }));
  }

  static async #onExhaustion(event, target) {
    const level = Number(target.dataset.level) || 0;
    const current = this.actor.system.attributes?.exhaustion ?? 0;
    await this.#guard(null, () => setExhaustion(this.actor, level === current ? level - 1 : level));
  }

  static async #onCondition(event, target) {
    await this.#guard(target, () => toggleCondition(this.actor, target.dataset.status));
  }

  static async #onEndConcentration() {
    await this.#guard(null, () => endConcentration(this.actor));
  }

  static async #onEndTurn(event, target) {
    await this.#guard(target, () => endTurn(this.actor));
  }

  /* -------------------------------------------- */
  /*  Actions: "More" popup & sections            */
  /* -------------------------------------------- */

  static #onMoreMenu() {
    this.element.classList.toggle("more-open");
  }

  static #onMoreSection(event, target) {
    this.moreState.section = target.dataset.section ?? null;
    this.element.classList.remove("more-open");
    if ( this.tabGroups.primary !== "more" ) this.changeTab("more", "primary", { force: true });
    this.render({ parts: ["more", "tabbar"] }).then(() => {
      const tab = this.element.querySelector('.pocket5e-tab[data-tab="more"]');
      if ( tab ) tab.scrollTop = 0;
    });
  }

  static async #onEffectToggle(event, target) {
    const effect = effectFromTarget(this.actor, target);
    if ( effect ) await this.#guard(target, () => toggleEffect(effect));
  }

  static async #onEffectDelete(event, target) {
    const effect = effectFromTarget(this.actor, target);
    if ( effect ) await this.#guard(target, () => deleteEffectConfirm(effect));
  }

  static #onBioEdit() {
    this.bioState.editing = true;
    this.render({ parts: ["more"] });
  }

  static #onBioCancel() {
    this.bioState.editing = false;
    this.render({ parts: ["more"] });
  }

  static async #onBioSave(event, target) {
    const form = target.closest("[data-bio-form]");
    const values = {};
    for ( const field of form?.querySelectorAll("input[name], textarea[name], select[name]") ?? [] ) values[field.name] = field.value;
    this.bioState.editing = false;
    await this.#guard(target, () => saveBiography(this.actor, values));
    this.render({ parts: ["more"] });
  }

  static async #onJournalAdd(event, target) {
    let id = null;
    await this.#guard(target, async () => { id = await addEntry(this.actor); });
    if ( id ) {
      this.journalState.editing = id;
      this.journalState.expanded.add(id);
    }
    this.render({ parts: ["more", "tabbar"] });
  }

  static #onJournalToggle(event, target) {
    const key = target.closest("[data-entry-key]")?.dataset.entryKey;
    if ( !key ) return;
    const set = this.journalState.expanded;
    if ( set.has(key) ) set.delete(key);
    else set.add(key);
    this.render({ parts: ["more"] });
  }

  static #onJournalEdit(event, target) {
    const key = target.closest("[data-entry-key]")?.dataset.entryKey;
    if ( !key ) return;
    this.journalState.editing = key;
    delete this.journalState.drafts[key];
    this.render({ parts: ["more"] });
  }

  static #onJournalCancel() {
    delete this.journalState.drafts[this.journalState.editing];
    this.journalState.editing = null;
    this.render({ parts: ["more"] });
  }

  static async #onJournalSave(event, target) {
    const card = target.closest("[data-entry-key]");
    const key = card?.dataset.entryKey;
    if ( !key ) return;
    const title = card.querySelector("input[name=entryTitle]")?.value ?? "";
    const value = card.querySelector("textarea[name=entryValue]")?.value ?? "";
    delete this.journalState.drafts[key];
    this.journalState.editing = null;
    this.journalState.expanded.add(key);
    await this.#guard(target, () => saveEntry(this.actor, key, { title, value }));
    this.render({ parts: ["more"] });
  }

  static async #onJournalDelete(event, target) {
    const card = target.closest("[data-entry-key]");
    const key = card?.dataset.entryKey;
    if ( !key ) return;
    const title = card.querySelector("input[name=entryTitle]")?.value || L("POCKET5E.More.Journal");
    let deleted = false;
    await this.#guard(target, async () => { deleted = !!(await deleteEntryConfirm(this.actor, key, title)); });
    if ( deleted ) {
      delete this.journalState.drafts[key];
      this.journalState.editing = null;
      this.render({ parts: ["more", "tabbar"] });
    }
  }

  /* -------------------------------------------- */
  /*  Actions: items (all tabs)                   */
  /* -------------------------------------------- */

  static #onOpenItem(event, target) {
    const item = this.#itemFor(target);
    if ( item ) ItemDrawer.open(item, this);
  }

  static async #onUseItem(event, target) {
    const item = this.#itemFor(target);
    if ( !item ) return;
    haptic();
    await this.#guard(target, () => this.useActivity(item, this.#activityFor(item, target), event));
  }

  static async #onAttack(event, target) {
    const item = this.#itemFor(target);
    haptic();
    await this.#guard(target, () => rollActivityAttack(this.#activityFor(item, target), this.rollOptions(event)));
    this.consumeRollMode();
  }

  static async #onDamage(event, target) {
    const item = this.#itemFor(target);
    haptic();
    await this.#guard(target, () => rollActivityDamage(this.#activityFor(item, target), this.rollOptions(event)));
  }

  static async #onFormula(event, target) {
    const item = this.#itemFor(target);
    await this.#guard(target, () => rollActivityFormula(this.#activityFor(item, target), this.rollOptions(event)));
  }

  static async #onToggleEquip(event, target) {
    const item = this.#itemFor(target);
    if ( item ) await this.#guard(target, () => toggleEquipped(item));
  }

  static async #onToggleAttune(event, target) {
    const item = this.#itemFor(target);
    if ( item ) await this.#guard(target, () => toggleAttuned(item));
  }

  static async #onQuantity(event, target) {
    const item = this.#itemFor(target);
    if ( item ) await this.#guard(target, () => changeQuantity(item, target.dataset.delta));
  }

  static #onToggleContainer(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    if ( !id ) return;
    const expanded = this.inventoryState.expanded;
    if ( expanded.has(id) ) expanded.delete(id);
    else expanded.add(id);
    this.render({ parts: ["inventory"] });
  }

  static #onToggleAttunement() {
    this.inventoryState.attunementOpen = !this.inventoryState.attunementOpen;
    this.render({ parts: ["inventory"] });
  }

  static #onEditCurrency() {
    this.inventoryState.currencyEditing = true;
    this.render({ parts: ["inventory"] });
  }

  static #onCancelCurrency() {
    this.inventoryState.currencyEditing = false;
    this.render({ parts: ["inventory"] });
  }

  static async #onSaveCurrency(event, target) {
    const values = {};
    for ( const input of this.element.querySelectorAll("input[name^='currency.']") ) {
      values[input.name.slice("currency.".length)] = input.value;
    }
    this.inventoryState.currencyEditing = false;
    await this.#guard(target, () => updateCurrency(this.actor, values));
    this.render({ parts: ["inventory"] });
  }

  /* -------------------------------------------- */
  /*  Actions: spells                             */
  /* -------------------------------------------- */

  static async #onTogglePrepared(event, target) {
    const item = this.#itemFor(target);
    if ( item ) await this.#guard(target, () => togglePrepared(item));
  }

  static async #onSpellSlot(event, target) {
    const key = target.closest("[data-slot]")?.dataset.slot;
    const index = Number(target.dataset.index) || 0;
    const current = this.actor.system.spells?.[key]?.value ?? 0;
    // Tapping a filled pip spends down to it; tapping an empty pip restores up to it.
    const next = index <= current ? index - 1 : index;
    if ( key ) await this.#guard(target, () => setSpellSlot(this.actor, key, next));
  }

  static #onSpellFilter(event, target) {
    this.spellState.filter = target.dataset.filter ?? null;
    this.render({ parts: ["spells"] });
  }

  static #onSpellFiltersToggle() {
    this.spellState.filtersOpen = !this.spellState.filtersOpen;
    this.render({ parts: ["spells"] });
  }

  static #onSpellFilterChip(event, target) {
    const set = this.spellState.active[target.dataset.category];
    const value = target.dataset.value;
    if ( !set || value === undefined ) return;
    if ( set.has(value) ) set.delete(value);
    else set.add(value);
    this.render({ parts: ["spells"] });
  }

  static #onSpellFiltersClear() {
    this.spellState.active = emptySpellFilters();
    this.render({ parts: ["spells"] });
  }

  static #onSpellPrepareMode() {
    PrepareDrawer.open(this.actor);
  }
}
