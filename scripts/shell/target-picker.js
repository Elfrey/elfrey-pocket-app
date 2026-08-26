/**
 * TargetPicker — bottom sheet listing the tokens of the current scene so the player can choose targets before a
 * use goes through the GM relay (the phone has no canvas, hence no game.user.targets of its own).
 * Resolves with TokenDocument uuids ([] = deliberately no target) or null when dismissed.
 */
import { MODULE_ID } from "../settings.js";
import { activeCombat, fmtLabel, loc } from "../actions.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const L = key => game.i18n.localize(key);

const DISPOSITION = {
  [-2]: { cls: "secret", key: "Secret" },
  [-1]: { cls: "hostile", key: "Hostile" },
  [0]: { cls: "neutral", key: "Neutral" },
  [1]: { cls: "friendly", key: "Friendly" }
};
/** Enemies first — that is what the player is usually aiming at. */
const ORDER = { hostile: 0, neutral: 1, friendly: 2, secret: 3 };

export class TargetPicker extends HandlebarsApplicationMixin(ApplicationV2) {
  static #instance = null;

  /**
   * @param {object} options
   * @param {Actor} options.actor
   * @param {Activity} options.activity
   * @returns {Promise<string[]|null>}
   */
  static pick({ actor, activity }) {
    this.#instance?.close();
    const app = this.#instance = new this();
    app.actor = actor;
    app.activity = activity;
    const promise = new Promise(resolve => { app.#resolve = resolve; });
    app.render({ force: true });
    return promise;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "pocket5e-targets",
    classes: ["pocket5e-app", "pocket5e-drawer", "pocket5e-targets"],
    window: { frame: false, positioned: false },
    actions: {
      close: TargetPicker.#onCancel,
      toggleTarget: TargetPicker.#onToggle,
      noTargets: TargetPicker.#onNone,
      confirmTargets: TargetPicker.#onConfirm
    }
  };

  /** @override */
  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/shell/targets.hbs`, scrollable: [".pocket5e-drawer-body"] }
  };

  /** @type {Actor} */
  actor;
  /** @type {Activity} */
  activity;
  #selected = new Set();
  #resolve = null;

  _insertElement(element) {
    const root = document.getElementById("pocket5e-root") ?? document.body;
    const existing = document.getElementById(element.id);
    if ( existing ) existing.replaceWith(element);
    else root.append(element);
  }

  /**
   * The scene the fight is on: the active encounter's scene, else the world's active scene, else wherever the
   * character has a token. No canvas here, so "viewed scene" does not exist.
   */
  static sceneFor(actor) {
    const combat = activeCombat();
    return combat?.scene
      ?? game.scenes.active
      ?? game.scenes.find(s => s.tokens.some(t => t.actorId === actor.id))
      ?? null;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const activity = this.activity;
    const scene = TargetPicker.sceneFor(this.actor);
    const target = activity.target ?? {};

    const tokens = (scene?.tokens ?? [])
      .filter(t => !t.hidden || game.user.isGM)
      .map(t => {
        const d = DISPOSITION[t.disposition] ?? DISPOSITION[0];
        return {
          uuid: t.uuid,
          name: t.name,
          img: t.texture?.src || t.actor?.img || "icons/svg/mystery-man.svg",
          disposition: d.cls,
          dispositionLabel: L(`POCKET5E.Targets.${d.key}`),
          isSelf: t.actorId === this.actor.id,
          selected: this.#selected.has(t.uuid)
        };
      })
      .sort((a, b) => (ORDER[a.disposition] - ORDER[b.disposition]) || a.name.localeCompare(b.name, game.i18n.lang));

    const hint = target.template?.type
      ? L("POCKET5E.Targets.Area")
      : (fmtLabel(activity.labels?.target) || loc(CONFIG.DND5E.individualTargetTypes?.[target.affects?.type]?.label, ""));

    context.name = activity.name?.trim() || activity.item.name;
    context.item = activity.item.name;
    context.img = activity.img || activity.item.img;
    context.hint = hint;
    context.scene = scene?.name ?? "";
    context.tokens = tokens;
    context.empty = !tokens.length;
    context.count = this.#selected.size;
    return context;
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    if ( TargetPicker.#instance === this ) TargetPicker.#instance = null;
    this.#finish(null);
  }

  #finish(result) {
    const resolve = this.#resolve;
    this.#resolve = null;
    resolve?.(result);
  }

  static #onCancel() { this.close(); }

  static #onToggle(event, target) {
    const uuid = target.dataset.uuid;
    if ( !uuid ) return;
    if ( this.#selected.has(uuid) ) this.#selected.delete(uuid);
    else this.#selected.add(uuid);
    // Imperative update: keeps the list's scroll position.
    target.classList.toggle("on", this.#selected.has(uuid));
    const icon = target.querySelector("i.check");
    if ( icon ) icon.className = `fa-solid check ${this.#selected.has(uuid) ? "fa-square-check" : "fa-square"}`;
    const confirm = this.element.querySelector("[data-action=confirmTargets]");
    if ( confirm ) {
      confirm.disabled = !this.#selected.size;
      confirm.querySelector("span").textContent = `${L("POCKET5E.Targets.Use")} (${this.#selected.size})`;
    }
  }

  static #onNone() {
    this.#finish([]);
    this.close();
  }

  static #onConfirm() {
    this.#finish(Array.from(this.#selected));
    this.close();
  }
}
