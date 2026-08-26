/**
 * ChatPanel — the slide-up chat drawer inside PocketShell.
 *
 * Own message feed built from the core ChatMessage#renderHTML (so dnd5e chat cards and their buttons work
 * untouched) with the ChatLog behaviours a phone needs: batched history ("load earlier"), roll breakdown
 * toggle, delete, jump-to-bottom, unread badge, a Dice So Nice style dice tray that composes a /r formula in
 * the message field (roll happens on send), and input through ui.chat.processMessage
 * (every chat command: /r, /w, /gmroll …). Core's own ChatLog stays in the hidden sidebar: in v13 its input
 * floats between the sidebar and a notification area depending on UI state, so embedding it is fragile.
 */
import { MODULE_ID } from "../settings.js";

const BATCH = 30;
const QUICK_DICE = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"];
const ROLL_PREFIX = "/r ";

export class ChatPanel {
  constructor(shell) {
    this.shell = shell;
  }

  /** @type {import("./app.js").PocketShell} */
  shell;
  unread = 0;

  #element;
  #log;
  #earlierRow;
  #jump;
  #hooks = [];
  /** Index into the visible-message list of the oldest rendered message. */
  #oldest = 0;
  #atBottom = true;
  /** Dice tray (Dice So Nice style): dice counts, flat modifier, d20 advantage mode. */
  #tray = { counts: Object.fromEntries(QUICK_DICE.map(d => [d, 0])), mod: 0, mode: "normal" };

  static get quickDice() {
    return QUICK_DICE;
  }

  get isOpen() {
    return this.shell.element?.classList.contains("chat-open") ?? false;
  }

  /* -------------------------------------------- */

  /** Called each time the chat part is (re-)rendered. */
  attach(element) {
    this.#element = element;
    this.#log = element.querySelector(".pocket5e-chat-log");
    this.#jump = element.querySelector("[data-chat=jump]");
    this.#earlierRow = document.createElement("li");
    this.#earlierRow.className = "pocket5e-chat-earlier-row";
    this.#earlierRow.innerHTML = `<button type="button" class="pocket5e-btn pocket5e-chat-earlier" data-chat="loadEarlier">${game.i18n.localize("POCKET5E.Chat.LoadEarlier")}</button>`;
    this.#earlierRow.querySelector("button").addEventListener("click", () => this.#loadEarlier());

    element.querySelector("form")?.addEventListener("submit", this.#onSubmit.bind(this));
    element.querySelector(".pocket5e-tray")?.addEventListener("click", event => this.#onTrayClick(event));
    element.querySelector("input[name=trayMod]")?.addEventListener("change", event => {
      this.#tray.mod = Math.trunc(Number(event.currentTarget.value) || 0);
      this.#syncTray();
    });
    this.#syncTray();
    this.#jump?.addEventListener("click", () => this.scrollToBottom());
    this.#log.addEventListener("click", this.#onLogClick.bind(this));
    this.#log.addEventListener("scroll", () => this.#onScroll(), { passive: true });

    if ( !this.#hooks.length ) this.#registerHooks();
    this.#populate();
  }

  detach() {
    for ( const [name, id] of this.#hooks ) Hooks.off(name, id);
    this.#hooks = [];
    this.#element = this.#log = this.#jump = this.#earlierRow = null;
  }

  toggle(force) {
    const open = this.shell.element.classList.toggle("chat-open", force);
    if ( open ) {
      this.unread = 0;
      this.#updateBadge();
      this.scrollToBottom();
    }
  }

  scrollToBottom() {
    const log = this.#log;
    if ( !log ) return;
    requestAnimationFrame(() => {
      log.scrollTop = log.scrollHeight;
      this.#atBottom = true;
      if ( this.#jump ) this.#jump.hidden = true;
    });
  }

  /* -------------------------------------------- */

  /** Visible messages, oldest first. */
  #messages() {
    return game.messages.contents.filter(m => m.visible).sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  }

  async #populate() {
    if ( !this.#log ) return;
    const all = this.#messages();
    this.#oldest = Math.max(0, all.length - BATCH);
    const nodes = [];
    for ( const message of all.slice(this.#oldest) ) nodes.push(await message.renderHTML());
    this.#log.replaceChildren(this.#earlierRow, ...nodes);
    this.#earlierRow.hidden = this.#oldest === 0;
    this.scrollToBottom();
  }

  async #loadEarlier() {
    const log = this.#log;
    if ( !log || this.#oldest === 0 ) return;
    const all = this.#messages();
    const start = Math.max(0, this.#oldest - BATCH);
    const before = log.scrollHeight;
    const nodes = [];
    for ( const message of all.slice(start, this.#oldest) ) nodes.push(await message.renderHTML());
    this.#earlierRow.after(...nodes);
    log.scrollTop += log.scrollHeight - before;   // keep what the reader was looking at in place
    this.#oldest = start;
    this.#earlierRow.hidden = this.#oldest === 0;
  }

  #registerHooks() {
    const on = (name, fn) => this.#hooks.push([name, Hooks.on(name, fn)]);
    on("createChatMessage", message => this.#onCreate(message));
    on("updateChatMessage", message => this.#onUpdate(message));
    on("deleteChatMessage", message => this.#log?.querySelector(`[data-message-id="${message.id}"]`)?.remove());
  }

  async #onCreate(message) {
    if ( !this.#log || !message.visible ) return;
    const own = message.author?.id === game.userId;
    this.#log.append(await message.renderHTML());
    if ( this.isOpen && (this.#atBottom || own) ) this.scrollToBottom();
    else if ( this.isOpen ) { if ( this.#jump ) this.#jump.hidden = false; }
    else if ( !own ) {
      this.unread++;
      this.#updateBadge();
    }
  }

  async #onUpdate(message) {
    if ( !this.#log ) return;
    const existing = this.#log.querySelector(`[data-message-id="${message.id}"]`);
    if ( !existing ) return this.#onCreate(message);
    if ( !message.visible ) return existing.remove();
    const stayAtBottom = this.#atBottom;
    existing.replaceWith(await message.renderHTML());
    if ( stayAtBottom && this.isOpen ) this.scrollToBottom();
  }

  #onLogClick(event) {
    const roll = event.target.closest("[data-action=expandRoll]");
    if ( roll ) {
      roll.classList.toggle("expanded");   // core CSS: .dice-roll.expanded .dice-tooltip { display: block }
      return;
    }
    const del = event.target.closest("[data-action=deleteMessage]");
    if ( del ) {
      event.preventDefault();
      const id = del.closest("[data-message-id]")?.dataset.messageId;
      game.messages.get(id)?.delete().catch(err => ui.notifications.error(err.message));
    }
  }

  #onScroll() {
    const log = this.#log;
    if ( !log ) return;
    this.#atBottom = (log.scrollHeight - log.scrollTop - log.clientHeight) < 48;
    if ( this.#jump ) this.#jump.hidden = this.#atBottom;
  }

  #updateBadge() {
    const badge = this.shell.element?.querySelector(".pocket5e-chat-badge");
    if ( !badge ) return;
    badge.textContent = String(this.unread);
    badge.hidden = !this.unread;
  }

  /* -------------------------------------------- */
  /*  Dice tray                                   */
  /* -------------------------------------------- */

  #onTrayClick(event) {
    const remove = event.target.closest("[data-die-remove]");
    if ( remove ) {
      const die = remove.dataset.dieRemove;
      this.#tray.counts[die] = Math.max(0, (this.#tray.counts[die] ?? 0) - 1);
      return this.#syncTray();
    }
    const die = event.target.closest("[data-die]")?.dataset.die;
    if ( die && QUICK_DICE.includes(die) ) {
      this.#tray.counts[die] = Math.min(99, (this.#tray.counts[die] ?? 0) + 1);
      return this.#syncTray();
    }
    const control = event.target.closest("[data-tray]");
    if ( !control ) return;
    switch ( control.dataset.tray ) {
      case "mode": this.#tray.mode = control.dataset.mode ?? "normal"; break;
      case "mod": this.#tray.mod = Math.trunc(this.#tray.mod + (Number(control.dataset.step) || 0)); break;
      case "clear": this.#resetTray(false); break;
    }
    this.#syncTray();
  }

  /** Roll formula for the tray, e.g. "2d20kh + 1d6 + 3" (advantage doubles the d20 pool and keeps the highest). */
  #formula() {
    const parts = [];
    for ( const die of QUICK_DICE ) {
      const n = this.#tray.counts[die];
      if ( !n ) continue;
      if ( (die === "d20") && (this.#tray.mode !== "normal") ) {
        const keep = this.#tray.mode === "advantage" ? "kh" : "kl";
        parts.push(`${n * 2}d20${keep}${n > 1 ? n : ""}`);
      }
      else parts.push(`${n}${die}`);
    }
    if ( !parts.length ) return "";
    const mod = this.#tray.mod;
    return parts.join(" + ") + (mod ? ` ${mod > 0 ? "+" : "-"} ${Math.abs(mod)}` : "");
  }

  get #trayEmpty() {
    return !QUICK_DICE.some(d => this.#tray.counts[d]);
  }

  /** Reflect tray state in the buttons and write the /r formula into the message field. */
  #syncTray() {
    const el = this.#element;
    if ( !el ) return;
    for ( const button of el.querySelectorAll("[data-die]") ) {
      const n = this.#tray.counts[button.dataset.die] ?? 0;
      button.classList.toggle("has-dice", n > 0);
      const badge = button.querySelector("[data-die-remove]");
      if ( badge ) { badge.textContent = String(n); badge.hidden = !n; }
    }
    for ( const b of el.querySelectorAll("[data-tray=mode]") ) b.classList.toggle("active", b.dataset.mode === this.#tray.mode);
    const modInput = el.querySelector("input[name=trayMod]");
    if ( modInput && (document.activeElement !== modInput) ) modInput.value = String(this.#tray.mod);
    const clear = el.querySelector("[data-tray=clear]");
    if ( clear ) clear.disabled = this.#trayEmpty && !this.#tray.mod;

    const input = el.querySelector("input[name=message]");
    if ( !input ) return;
    const formula = this.#formula();
    const ours = !input.value.trim() || input.value.startsWith(ROLL_PREFIX);
    if ( formula ) { if ( ours ) input.value = `${ROLL_PREFIX}${formula}`; }
    else if ( input.value.startsWith(ROLL_PREFIX) ) input.value = "";
  }

  #resetTray(sync=true) {
    for ( const die of QUICK_DICE ) this.#tray.counts[die] = 0;
    this.#tray.mod = 0;
    this.#tray.mode = "normal";
    if ( sync ) this.#syncTray();
  }

  /* -------------------------------------------- */

  async #onSubmit(event) {
    event.preventDefault();
    const input = event.currentTarget.elements.message;
    const text = input.value.trim();
    if ( !text ) return;
    try {
      await ui.chat.processMessage(text, { speaker: ChatMessage.getSpeaker({ actor: this.shell.actor }) });
      input.value = "";
      this.#resetTray();
    } catch(err) {
      console.error(`${MODULE_ID} |`, err);
      ui.notifications.error(err.message);
    }
  }
}
