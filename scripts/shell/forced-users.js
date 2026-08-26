/**
 * GM settings menu: pick the players who should always land in the app when they open /game
 * (regardless of device detection). Stored in the world setting "forcedUsers".
 */
import { MODULE_ID, SETTINGS } from "../settings.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ForcedUsersConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: "pocket5e-forced-users",
    tag: "form",
    classes: ["pocket5e-config", "standard-form"],
    window: { title: "POCKET5E.Settings.ForcedUsers.Title", icon: "fa-solid fa-mobile-screen", contentClasses: ["standard-form"] },
    position: { width: 420 },
    form: { handler: ForcedUsersConfig.#onSubmit, closeOnSubmit: true }
  };

  /** @override */
  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/settings/forced-users.hbs` }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const forced = new Set(game.settings.get(MODULE_ID, SETTINGS.FORCED_USERS) ?? []);
    context.users = game.users.filter(u => !u.isGM).sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang))
      .map(u => ({ id: u.id, name: u.name, character: u.character?.name ?? "", checked: forced.has(u.id) }));
    return context;
  }

  static async #onSubmit(event, form, formData) {
    const ids = Object.entries(formData.object).filter(([, v]) => v === true).map(([k]) => k.replace(/^user\./, ""));
    await game.settings.set(MODULE_ID, SETTINGS.FORCED_USERS, ids);
  }
}

export function registerForcedUsersMenu() {
  game.settings.registerMenu(MODULE_ID, "forcedUsersMenu", {
    name: "POCKET5E.Settings.ForcedUsers.Name",
    label: "POCKET5E.Settings.ForcedUsers.Label",
    hint: "POCKET5E.Settings.ForcedUsers.Hint",
    icon: "fa-solid fa-mobile-screen",
    type: ForcedUsersConfig,
    restricted: true
  });
}
