/**
 * CharacterPicker — shown when the player owns several characters (or none).
 */
import { MODULE_ID } from "../settings.js";
import { actorSummary } from "../actions.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class CharacterPicker extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ characters=[], onPick, ...options }={}) {
    super(options);
    this.characters = characters;
    this.#onPickCb = onPick;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "pocket5e-picker",
    classes: ["pocket5e-app", "pocket5e-picker"],
    window: { frame: false, positioned: false },
    actions: {
      pick: CharacterPicker.#onPick,
      fullClient: CharacterPicker.#onFullClient,
      logout: CharacterPicker.#onLogout
    }
  };

  /** @override */
  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/picker.hbs` }
  };

  /** @type {Actor[]} */
  characters;
  #onPickCb;

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
    context.user = game.user;
    context.world = game.world;
    context.characters = this.characters.map(a => ({
      id: a.id,
      name: a.name,
      img: a.img,
      summary: actorSummary(a),
      hp: a.system.attributes?.hp ?? {}
    }));
    return context;
  }

  static #onPick(event, target) {
    const actor = game.actors.get(target.dataset.actorId);
    if ( actor ) this.#onPickCb?.(actor);
  }

  static async #onFullClient() {
    const { SETTINGS, MODE } = await import("../settings.js");
    await game.settings.set(MODULE_ID, SETTINGS.MODE, MODE.OFF);
    window.location.href = foundry.utils.getRoute("game");
  }

  static #onLogout() {
    game.logOut();
  }
}
