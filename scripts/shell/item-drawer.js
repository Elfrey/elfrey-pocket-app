/**
 * ItemDrawer — bottom sheet with an item's details: badges, controls (quantity, equip, attune, favorite,
 * post to chat, delete), its activities with use/attack/damage buttons, and the enriched description.
 * One instance is reused; it follows updates of the shown item and closes if the item is deleted.
 */
import { MODULE_ID } from "../settings.js";
import { activityRow } from "../tabs/items.js";
import {
  useItem, rollActivityAttack, rollActivityDamage, rollActivityFormula, toggleEquipped, toggleAttuned,
  changeQuantity, toggleFavorite, isFavorite, postItemCard, deleteItemConfirm, usesText, fmtLabel, loc
} from "../actions.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const L = key => game.i18n.localize(key);

export class ItemDrawer extends HandlebarsApplicationMixin(ApplicationV2) {
  static #instance = null;

  /** Show `item`; `shell` supplies roll modifiers (advantage, fast, privacy). */
  static open(item, shell) {
    const app = (this.#instance ??= new this());
    app.item = item;
    app.shell = shell;
    return app.render({ force: true });
  }

  static get instance() {
    return this.#instance;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "pocket5e-item",
    classes: ["pocket5e-app", "pocket5e-drawer", "pocket5e-item-drawer"],
    window: { frame: false, positioned: false },
    actions: {
      close: ItemDrawer.#onClose,
      useItem: ItemDrawer.#onUse,
      attack: ItemDrawer.#onAttack,
      damage: ItemDrawer.#onDamage,
      formula: ItemDrawer.#onFormula,
      toggleEquip: ItemDrawer.#onToggleEquip,
      toggleAttune: ItemDrawer.#onToggleAttune,
      quantity: ItemDrawer.#onQuantity,
      favorite: ItemDrawer.#onFavorite,
      postCard: ItemDrawer.#onPostCard,
      delete: ItemDrawer.#onDelete
    }
  };

  /** @override */
  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/shell/item.hbs`, scrollable: [".pocket5e-drawer-body"] }
  };

  /** @type {Item} */
  item;
  shell;
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
    const item = this.item;
    const s = item.system ?? {};

    let description = s.description?.value ?? "";
    try {
      const TextEditor = foundry.applications.ux.TextEditor.implementation;
      description = await TextEditor.enrichHTML(description, {
        secrets: item.isOwner, rollData: item.getRollData?.() ?? {}, relativeTo: item
      });
    } catch(err) {
      console.warn(`${MODULE_ID} |`, err);
    }

    const weightUnits = loc(CONFIG.DND5E.weightUnits?.[s.weight?.units]?.abbreviation, s.weight?.units ?? "");
    const weightValue = (typeof s.totalWeight === "number") ? s.totalWeight : s.weight?.value;
    const price = s.price?.value
      ? `${s.price.value} ${loc(CONFIG.DND5E.currencies?.[s.price.denomination]?.abbreviation, s.price.denomination ?? "")}`.trim()
      : "";

    return Object.assign(context, {
      item,
      name: item.name,
      img: item.img,
      typeLabel: L(CONFIG.Item.typeLabels?.[item.type] ?? item.type),
      rarity: s.rarity ? loc(CONFIG.DND5E.itemRarity?.[s.rarity], s.rarity) : "",
      spell: (item.type === "spell") ? { level: fmtLabel(item.labels?.level), school: fmtLabel(item.labels?.school) } : null,
      description,
      activities: (s.activities?.contents ?? []).map(a => activityRow(item, a, { withItemName: false })),
      hasQuantity: s.quantity !== undefined,
      quantity: s.quantity ?? 1,
      weight: (typeof weightValue === "number" && weightValue) ? `${Math.round(weightValue * 10) / 10} ${weightUnits}`.trim() : "",
      price,
      uses: usesText(s),
      equippable: (s.equipped !== undefined) && (item.type !== "container"),
      equipped: !!s.equipped,
      canAttune: !!s.attunement,
      attuned: !!s.attuned,
      favorite: isFavorite(item),
      properties: fmtLabel(item.labels?.properties),
      canDelete: item.isOwner
    });
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    const on = (name, fn) => this.#hooks.push([name, Hooks.on(name, fn)]);
    on("updateItem", item => { if ( item === this.item ) this.render(); });
    on("deleteItem", item => { if ( item === this.item ) this.close(); });
    on("updateActor", actor => { if ( actor === this.item?.actor ) this.render(); });   // favorites live on the actor
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    for ( const [name, id] of this.#hooks ) Hooks.off(name, id);
    this.#hooks = [];
  }

  #activity(target) {
    const id = target.closest("[data-activity-id]")?.dataset.activityId;
    return id ? this.item.system.activities?.get(id) ?? null : null;
  }

  async #guard(target, fn) {
    if ( target ) target.disabled = true;
    try {
      await fn();
    } catch(err) {
      console.error(`${MODULE_ID} |`, err);
      ui.notifications.error(err?.message ?? String(err));
    } finally {
      if ( target ) target.disabled = false;
    }
  }

  static #onClose() { this.close(); }

  static async #onUse(event, target) {
    await this.#guard(target, () => this.shell?.useActivity
      ? this.shell.useActivity(this.item, this.#activity(target), event)
      : useItem(this.item, this.#activity(target)));
    this.shell?.consumeRollMode();
  }

  static async #onAttack(event, target) {
    await this.#guard(target, () => rollActivityAttack(this.#activity(target), this.shell?.rollOptions(event) ?? { event }));
    this.shell?.consumeRollMode();
  }

  static async #onDamage(event, target) {
    await this.#guard(target, () => rollActivityDamage(this.#activity(target), this.shell?.rollOptions(event) ?? { event }));
  }

  static async #onFormula(event, target) {
    await this.#guard(target, () => rollActivityFormula(this.#activity(target), this.shell?.rollOptions(event) ?? { event }));
  }

  static async #onToggleEquip(event, target) { await this.#guard(target, () => toggleEquipped(this.item)); }
  static async #onToggleAttune(event, target) { await this.#guard(target, () => toggleAttuned(this.item)); }
  static async #onQuantity(event, target) { await this.#guard(target, () => changeQuantity(this.item, target.dataset.delta)); }
  static async #onFavorite(event, target) { await this.#guard(target, () => toggleFavorite(this.item)); }
  static async #onPostCard(event, target) { await this.#guard(target, () => postItemCard(this.item)); }

  static async #onDelete(event, target) {
    await this.#guard(target, () => deleteItemConfirm(this.item));
  }
}
