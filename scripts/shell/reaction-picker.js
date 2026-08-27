/**
 * ReactionPicker — "your character may react": the reactions midi-qol offers, with the trigger description and a
 * countdown (midi gives up after its timeout, so an unanswered prompt must not outlive it).
 * Resolves with the chosen Activity, or null for "no reaction" / timeout / dismissed.
 */
import { MODULE_ID } from "../settings.js";
import { fmtLabel, loc } from "../actions.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const L = key => game.i18n.localize(key);

export class ReactionPicker extends HandlebarsApplicationMixin(ApplicationV2) {
  static #instance = null;

  /**
   * @param {object} options
   * @param {Actor} options.actor
   * @param {Activity[]} options.activities
   * @param {string} [options.flavor]       HTML prepared by midi ("X attacks Y with Z…").
   * @param {string} [options.triggerType]
   * @param {number} [options.timeout]      Seconds before the prompt closes as "no reaction".
   * @returns {Promise<Activity|null>}
   */
  static pick({ actor, activities, flavor="", triggerType="", timeout=30 }) {
    this.#instance?.close();
    const app = this.#instance = new this();
    app.actor = actor;
    app.activities = activities;
    app.flavor = flavor;
    app.triggerType = triggerType;
    app.deadline = Date.now() + Math.max(3, timeout) * 1000;
    const promise = new Promise(resolve => { app.#resolve = resolve; });
    app.render({ force: true });
    return promise;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "pocket5e-reaction",
    classes: ["pocket5e-app", "pocket5e-drawer", "pocket5e-reaction"],
    window: { frame: false, positioned: false },
    actions: {
      close: ReactionPicker.#onNone,
      noReaction: ReactionPicker.#onNone,
      react: ReactionPicker.#onReact
    }
  };

  /** @override */
  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/shell/reaction.hbs`, scrollable: [".pocket5e-drawer-body"] }
  };

  actor;
  activities = [];
  flavor = "";
  triggerType = "";
  deadline = 0;
  #resolve = null;
  #timer = null;

  _insertElement(element) {
    const root = document.getElementById("pocket5e-root") ?? document.body;
    const existing = document.getElementById(element.id);
    if ( existing ) existing.replaceWith(element);
    else root.append(element);
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.actorName = this.actor.name;
    context.actorImg = this.actor.img;
    context.flavor = this.flavor;
    context.seconds = this.#secondsLeft();
    context.reactions = this.activities.map(a => ({
      uuid: a.uuid,
      name: a.name?.trim() || a.item.name,
      item: (a.name?.trim() && (a.name.trim() !== a.item.name)) ? a.item.name : "",
      img: a.img || a.item.img,
      meta: [fmtLabel(a.labels?.activation), fmtLabel(a.labels?.range), fmtLabel(a.labels?.target)].filter(Boolean).join(" · "),
      uses: usesOf(a)
    }));
    return context;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    clearInterval(this.#timer);
    this.#timer = setInterval(() => {
      const left = this.#secondsLeft();
      const el = this.element?.querySelector("[data-countdown]");
      if ( el ) el.textContent = game.i18n.format("POCKET5E.Bridge.ReactionCountdown", { seconds: left });
      if ( left <= 0 ) this.#finish(null);
    }, 500);
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    clearInterval(this.#timer);
    if ( ReactionPicker.#instance === this ) ReactionPicker.#instance = null;
    this.#finish(null);
  }

  #secondsLeft() {
    return Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000));
  }

  #finish(result) {
    const resolve = this.#resolve;
    this.#resolve = null;
    resolve?.(result);
    if ( this.rendered ) this.close();
  }

  static #onNone() { this.#finish(null); }

  static #onReact(event, target) {
    const activity = this.activities.find(a => a.uuid === target.dataset.uuid) ?? null;
    this.#finish(activity);
  }
}

function usesOf(activity) {
  const uses = activity.uses?.max ? activity.uses : activity.item.system?.uses;
  const max = Number(uses?.max);
  if ( !uses || !max ) return "";
  const value = Number.isFinite(uses.value) ? uses.value : Math.max(0, max - (Number(uses.spent) || 0));
  return `${value}/${max}`;
}
