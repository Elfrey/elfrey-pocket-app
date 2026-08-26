# Elfrey Pocket App — для разработчика

Пользовательская документация — в [README.md](README.md). Полный план работ, история решений и шпаргалка по API dnd5e — в [PLAN.md](PLAN.md).

## Что это технически

Не встраивание в клиент, а отдельная страница (`app.html`), которую отдаёт сам модуль. Она загружает ядро клиента Foundry и систему dnd5e — **без остальных модулей, без канваса, без стандартного UI** — логинит игрока и рендерит свою оболочку (`PocketShell`, ApplicationV2). Броски, использование предметов, отдых, урон, карточки чата и эффекты идут через штатный API dnd5e, поэтому поведение совпадает с десктопным клиентом, а серверные хуки/автоматизация мира работают как обычно.

Одна кодовая база на обе версии: и v13, и v14 работают на dnd5e 5.3.3.

## Как устроена загрузка (`scripts/standalone/boot.js`)

1. `app.html` задаёт глобальные переменные штатных страниц Foundry (`SIGNED_EULA`, `ROUTE_PREFIX`, `MESSAGES`), `<base>` на корень Foundry и промис `POCKET5E.domReady`.
2. `boot.js` ждёт `DOMContentLoaded`, копирует стили ядра и vendor-скрипты со страницы `/join` самого сервера (чтобы их набор всегда совпадал с версией ядра; запрос с `credentials: "omit"`, иначе `/join` разлогинил бы сессию), **и только потом** импортирует `/scripts/foundry.mjs` — встроенный бутстрап Foundry висит на `DOMContentLoaded`, поэтому здесь не срабатывает.
3. Принудительно `core.noCanvas`; автозапуск плейлистов, A/V и поисковый индекс — заглушки.
4. Сессия: `HEAD /game` ставит cookie сессии, не разлогинивая мир (в отличие от `GET /join`; `redirect: "manual"`, чтобы не уйти по 302 в `/join`), затем `Game.connect()`. Нет пользователя на сессии → экран входа (`getJoinData` + `POST /join`) → перезагрузка.
5. `dnd5e.mjs` + `dnd5e.css`, затем хуки модуля (`scripts/main.js`), затем `Game.getData()` → `new Game()` → `game.initialize()`.

## Различия ядра v13 / v14 (учтены в коде)

| | v13 | v14 |
| --- | --- | --- |
| HTML из папки данных | отдаётся как `text/html` | отдаётся как `text/plain` → страницу отдаём из `public/` (см. `tools/install-v14.*`) |
| cookie сессии | читаемая из JS | `HttpOnly` (не видна `getCookies`, едет с рукопожатием WebSocket) |
| `Game.connect` | `connect(sessionId)` | `connect()` без аргумента |
| конструктор | `new Game(view, data, sessionId, socket)` | `new Game(view, data, socket)` |
| поле логина | `userid` | `userId` (`login.js` шлёт оба) |

Точка входа для редиректа с `/game` выбирается автоматически: v13 → `modules/elfrey-pocket-app/app.html`, v14 → `pocket/app.html`. Переопределяется мировой настройкой «Адрес приложения» (для реверс-прокси и т.п.).

## Структура

```
app.html                     standalone-страница
manifest.webmanifest         PWA
icons/                       иконки (сгенерированы из icon.svg)
scripts/
  settings.js                MODULE_ID, client/world-настройки, appPath()
  mobile-mode.js             определение телефона, core.noCanvas, редирект в приложение
  main.js                    хуки init/ready, ранний редирект, регистрация партиалов
  theme.js                   тема (system/dark/light)
  actions.js                 обёртки над API dnd5e (единственная точка контакта с системой)
  relay.js                   GM-relay: использование предметов на клиенте мастера (midi-qol) — обе стороны протокола
  bridge.js                  ответы на socketlib-запросы midi-qol/CPR к игроку (реакции, броски, диалоги CPR); socketlib грузит boot.js
  standalone/boot.js         бутстрап (см. выше)
  standalone/login.js        экран входа
  shell/                     PocketShell (app.js), chat, item/prepare-drawer, target-picker, reaction-picker, remote-dialog, dialogs, full-sheet, controller, picker, forced-users
  tabs/                      overview, favorites, features, inventory, spells, actions, biography, journal, effects, items
templates/                   Handlebars: shell/, tabs/, parts/, settings/
styles/elfrey-pocket-app.css всё под body.pocket5e-standalone / body.pocket5e-mobile / .pocket5e-app
tools/install-v14.{sh,ps1}   симлинк папки модуля в public/ Foundry (для v14)
```

## Разработка

Модуль лежит в `shared-data/modules/elfrey-pocket-app` и симлинкуется в `data-v13/Data/modules` и `data-v14/Data/modules`. Статические файлы отдаются напрямую — правки в `app.html`, скриптах, стилях и шаблонах подхватываются перезагрузкой браузера (жёсткой, чтобы сбросить кэш).

- Адреса для теста: v13 — `https://<host>/modules/elfrey-pocket-app/app.html`; v14 — `https://<host>/pocket/app.html` (после `tools/install-v14`). Форс режима: `?mobile=1` / `?mobile=0`.
- Диагностика в консоли: `POCKET5E` (тайминги, объём данных мира, разбор по коллекциям), `game.modules.get("elfrey-pocket-app").api.MobileMode`. То же — в приложении: меню ⋮ → Диагностика.
- CSS-классы `pocket5e-*` и ключи локализации `POCKET5E.*` намеренно не зависят от id модуля.

**GM-relay (ветка `feature/midi-relay`, прототип):** мировая настройка «Использовать предметы через клиент мастера» (Авто = пока в мире включён midi-qol). Проверка: мастер в обычном клиенте на сцене с токенами (в консоли `elfrey-pocket-app | relay | GM handler ready`), игрок в приложении жмёт «использовать» у атаки/заклинания → пикер целей → в чате карточка от имени игрока, воркфлоу midi у мастера. Отладка: сообщения `relay | →` (телефон) и `relay | ←` (мастер) в консолях; протокол — в шапке `scripts/relay.js`, дизайн и ограничения — PLAN.md, фаза 10. Bridge: в консоли телефона `bridge | answering midi-qol: …` и `answering chris-premades: …` — значит socketlib загружен и обработчики стоят; без этих строк реакции и CPR-диалоги игрока не работают (проверьте, что socketlib включён в мире).

**Переименование модуля:** `MODULE_ID` в `scripts/settings.js`, `id` в `module.json`, имя папки и симлинки, жёсткие пути в `app.html` и `manifest.webmanifest`.

## Релиз

Отправьте тег `vX.Y.Z` — воркфлоу `.github/workflows/release.yml` проставит версию в `module.json` и приложит `module.zip` к GitHub Release. Manifest-URL: `https://github.com/Elfrey/elfrey-pocket-app/releases/latest/download/module.json`.
