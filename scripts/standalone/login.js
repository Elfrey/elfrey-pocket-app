/**
 * Minimal login screen for the standalone page.
 *
 * Runs before any Game exists (so no game.i18n) — strings come from a tiny built-in dictionary.
 * Users are fetched with the same socket request Foundry's /join view uses ("getJoinData"), the
 * credentials are posted like JoinGameForm does: POST /join {action:"join", userid|userId, password}.
 */
import { MODULE_ID } from "../settings.js";

const LS_LAST_USER = `${MODULE_ID}.lastUserId`;

const STRINGS = {
  en: {
    player: "Player", password: "Password", login: "Join", active: "online",
    fullClient: "Full Foundry client", noUsers: "No users available — is a world running?",
    "JOIN.ErrorInvalidPassword": "Wrong password.",
    "JOIN.ErrorUserDoesNotExist": "This user does not exist.",
    "JOIN.ErrorBanned": "This user is banned.",
    "JOIN.ErrorMustSelectUser": "Pick a player.",
    generic: "Login failed"
  },
  ru: {
    player: "Игрок", password: "Пароль", login: "Войти", active: "в игре",
    fullClient: "Полный клиент Foundry", noUsers: "Нет пользователей — мир не запущен?",
    "JOIN.ErrorInvalidPassword": "Неверный пароль.",
    "JOIN.ErrorUserDoesNotExist": "Такого пользователя нет.",
    "JOIN.ErrorBanned": "Пользователь заблокирован.",
    "JOIN.ErrorMustSelectUser": "Выберите игрока.",
    generic: "Не удалось войти"
  }
};

function t(key, lang) {
  const dict = STRINGS[lang] ?? STRINGS.en;
  return dict[key] ?? STRINGS.en[key] ?? key;
}

function el(tag, attrs={}, ...children) {
  const node = document.createElement(tag);
  for ( const [k, v] of Object.entries(attrs) ) {
    if ( v === false || v === null || v === undefined ) continue;
    if ( k === "class" ) node.className = v;
    else if ( k === "text" ) node.textContent = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  node.append(...children);
  return node;
}

/**
 * @param {io.Socket} socket   Connected socket with an anonymous session.
 * @param {(path: string) => string} route   Route helper from boot.js.
 */
export async function showLogin(socket, route) {
  const lang = (navigator.language || "en").toLowerCase().startsWith("ru") ? "ru" : "en";
  const data = await new Promise(resolve => socket.emit("getJoinData", resolve));
  const users = [...(data?.users ?? [])].sort((a, b) => a.name.localeCompare(b.name, lang));
  const lastUser = localStorage.getItem(LS_LAST_USER);

  const select = el("select", { name: "userid", required: true, autocomplete: "username" },
    ...users.map(u => el("option", {
      value: u._id,
      selected: u._id === lastUser,
      text: u.active ? `${u.name} · ${t("active", lang)}` : u.name
    }))
  );
  const password = el("input", { type: "password", name: "password", autocomplete: "current-password" });
  const error = el("p", { class: "pocket5e-error", hidden: true });
  const submit = el("button", { type: "submit", class: "pocket5e-btn pocket5e-btn-primary", text: t("login", lang) });

  const form = el("form", { class: "pocket5e-login", autocomplete: "on" },
    el("div", { class: "pocket5e-boot-logo" }, el("i", { class: "fa-solid fa-dice-d20" })),
    el("h1", { text: data?.world?.title ?? "Foundry VTT" }),
    users.length ? el("label", {}, el("span", { text: t("player", lang) }), select)
                 : el("p", { class: "pocket5e-error", text: t("noUsers", lang) }),
    el("label", {}, el("span", { text: t("password", lang) }), password),
    submit,
    error,
    el("p", { class: "pocket5e-login-foot" }, el("a", { href: route("join"), text: t("fullClient", lang) }))
  );

  form.addEventListener("submit", async event => {
    event.preventDefault();
    error.hidden = true;
    if ( !select.value ) {
      error.textContent = t("JOIN.ErrorMustSelectUser", lang);
      error.hidden = false;
      return;
    }
    submit.disabled = true;
    try {
      const response = await fetch(route("join"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        // Foundry v13 reads `userid`, v14 renamed it to `userId`; send both so either core accepts it.
        body: JSON.stringify({ action: "join", userid: select.value, userId: select.value, password: password.value })
      });
      if ( !response.ok ) {
        const key = (await response.text()).trim();
        throw new Error(t(key, lang) === key ? `${t("generic", lang)} (${response.status})` : t(key, lang));
      }
      localStorage.setItem(LS_LAST_USER, select.value);
      // The session cookie is now bound to the user — restart the boot sequence with it.
      window.location.reload();
    } catch(err) {
      error.textContent = err.message;
      error.hidden = false;
      submit.disabled = false;
    }
  });

  const root = document.getElementById("pocket5e-root");
  root.replaceChildren(form);
  (users.length ? password : select).focus?.();
}
