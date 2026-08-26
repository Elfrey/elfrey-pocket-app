/**
 * PrepareDrawer — full-screen spell preparation list: compact rows with checkboxes (no images), grouped by
 * level, per-class counters in the header, search. Tapping a row toggles system.prepared through dnd5e.
 */
import { MODULE_ID } from "../settings.js";
import { togglePrepared, loc, fmtLabel } from "../actions.js";
import { byName } from "../tabs/items.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const L = key => game.i18n.localize(key);

export class PrepareDrawer extends HandlebarsApplicationMixin(ApplicationV2) {
  static #instance = null;

  static open(actor) {
    const app = (this.#instance ??= new this());
    app.actor = actor;
    return app.render({ force: true });
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "pocket5e-prepare",
    classes: ["pocket5e-app", "pocket5e-drawer", "pocket5e-prepare-drawer"],
    window: { frame: false, positioned: false },
    actions: {
      close: PrepareDrawer.#onClose,
      togglePrepared: PrepareDrawer.#onTogglePrepared
    }
  };

  /** @override */
  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/shell/prepare.hbs`, scrollable: [".pocket5e-drawer-body"] }
  };

  /** @type {Actor} */
  actor;
  #search = "";
  #hooks = [];

  _insertElement(element) {
    const root = document.getElementById("pocket5e-root") ?? document.body;
    const existing = document.getElementById(element.id);
    if ( existing ) existing.replaceWith(element);
    else root.append(element);
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const cfgMethods = CONFIG.DND5E.spellcasting ?? {};
    const spells = (actor.itemTypes?.spell ?? []).filter(sp => (sp.system.level > 0) && cfgMethods[sp.system.method]?.prepares);

    const groups = new Map();
    for ( const sp of spells.sort(byName) ) {
      const level = sp.system.level ?? 0;
      if ( !groups.has(level) ) groups.set(level, { level, label: loc(CONFIG.DND5E.spellLevels?.[level], `${level}`), prepared: 0, rows: [] });
      const g = groups.get(level);
      if ( sp.system.prepared >= 1 ) g.prepared++;
      g.rows.push(this.#row(sp));
    }

    const classes = Object.values(actor.spellcastingClasses ?? {})
      .filter(c => c.spellcasting?.preparation?.max)
      .map(c => ({ name: c.name, value: c.spellcasting.preparation.value ?? 0, max: c.spellcasting.preparation.max }));

    return Object.assign(context, {
      actor,
      classes,
      total: spells.filter(sp => sp.system.prepared === 1).length,
      search: this.#search,
      groups: [...groups.values()].sort((a, b) => a.level - b.level),
      empty: !spells.length
    });
  }

  #row(item) {
    const s = item.system;
    const props = s.properties ?? new Set();
    const school = CONFIG.DND5E.spellSchools?.[s.school];
    const tags = [];
    if ( props.has?.("concentration") ) tags.push({ abbr: L("POCKET5E.Spells.TagConcentration"), cls: "conc" });
    if ( props.has?.("ritual") ) tags.push({ abbr: L("POCKET5E.Spells.TagRitual"), cls: "rit" });
    return {
      id: item.id,
      name: item.name,
      prepared: (s.prepared ?? 0) >= 1,
      always: s.prepared === 2,
      school: loc(school?.label, ""),
      components: fmtLabel(item.labels?.components?.vsm),
      tags
    };
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    const on = (name, fn) => this.#hooks.push([name, Hooks.on(name, fn)]);
    on("updateItem", item => { if ( (item.parent === this.actor) && (item.type === "spell") ) this.render(); });
    on("createItem", item => { if ( (item.parent === this.actor) && (item.type === "spell") ) this.render(); });
    on("deleteItem", item => { if ( (item.parent === this.actor) && (item.type === "spell") ) this.render(); });
    on("deleteActor", actor => { if ( actor === this.actor ) this.close(); });
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const input = this.element.querySelector("input[name=prepareSearch]");
    input?.addEventListener("input", () => {
      this.#search = input.value;
      this.#applyFilter();
    });
    this.#applyFilter();
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    for ( const [name, id] of this.#hooks ) Hooks.off(name, id);
    this.#hooks = [];
  }

  #applyFilter() {
    const q = this.#search.trim().toLowerCase();
    for ( const row of this.element.querySelectorAll("[data-name]") ) {
      row.hidden = !!q && !row.dataset.name.toLowerCase().includes(q);
    }
    for ( const group of this.element.querySelectorAll("[data-group-id]") ) {
      group.hidden = !!q && !group.querySelector("[data-name]:not([hidden])");
    }
  }

  static #onClose() { this.close(); }

  static async #onTogglePrepared(event, target) {
    const item = this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if ( !item ) return;
    target.disabled = true;
    try {
      await togglePrepared(item);
    } catch(err) {
      console.error(`${MODULE_ID} |`, err);
      ui.notifications.error(err?.message ?? String(err));
    } finally {
      target.disabled = false;
    }
  }
}
