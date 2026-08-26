/**
 * PocketApp — decides what is on screen: the character picker or the shell for one actor.
 */
import { MODULE_ID, SETTINGS } from "../settings.js";
import { PocketShell } from "./app.js";
import { CharacterPicker } from "./picker.js";

export class PocketApp {
  /** @type {PocketShell|null} */
  static shell = null;
  /** @type {CharacterPicker|null} */
  static picker = null;

  /** Characters this user may play: owned "character" actors plus the assigned one, whatever its type. */
  static ownedCharacters() {
    const assigned = game.user.character;
    return game.actors
      .filter(a => a.isOwner && ((a.type === "character") || (a === assigned)))
      .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
  }

  static start() {
    const characters = this.ownedCharacters();
    const lastId = game.settings.get(MODULE_ID, SETTINGS.LAST_ACTOR);
    const actor = characters.find(a => a.id === lastId)
      ?? (characters.includes(game.user.character) ? game.user.character : null)
      ?? (characters.length === 1 ? characters[0] : null);
    return actor ? this.openShell(actor) : this.openPicker();
  }

  static async openShell(actor) {
    await this.picker?.close();
    this.picker = null;
    await this.shell?.close();
    game.settings.set(MODULE_ID, SETTINGS.LAST_ACTOR, actor.id);
    this.shell = new PocketShell({ actor, onSwitchCharacter: () => this.openPicker() });
    return this.shell.render({ force: true });
  }

  static async openPicker() {
    await this.shell?.close();
    this.shell = null;
    await this.picker?.close();
    this.picker = new CharacterPicker({
      characters: this.ownedCharacters(),
      onPick: actor => this.openShell(actor)
    });
    return this.picker.render({ force: true });
  }
}
