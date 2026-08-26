#!/bin/sh
# Elfrey Pocket App — настройка для Foundry v14 (macOS / Linux).
#
# Foundry v14 отдаёт HTML-файлы из папки данных как обычный текст, поэтому страницу приложения нельзя открыть по
# адресу modules/elfrey-pocket-app/app.html. Скрипт связывает папку модуля с каталогом public/ внутри Foundry,
# где такого ограничения нет. После этого приложение доступно по адресу  https://<ваш-foundry>/pocket/app.html
#
# Запуск:  sh tools/install-v14.sh [/путь/до/foundry]
#   Путь — это папка *программы* Foundry, та, что содержит public/
#   (у десктопного приложения на macOS это ".../Foundry Virtual Tabletop.app/Contents/Resources/app",
#    у сборки на Node — распакованная папка).
#   Если путь не указан, скрипт попробует найти папку сам, а если не найдёт — спросит её.
# Повторяйте после каждого обновления Foundry: обновление заменяет папку программы, и ссылка пропадает.
set -eu
NAME="pocket"
MODULE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Печатает путь к public/ внутри переданной папки Foundry, либо ничего, если это не она.
resolve_public() {
  dir="$1"
  [ -n "$dir" ] || return 1
  # разворачиваем ведущую ~
  case "$dir" in "~"|"~/"*) dir="$HOME${dir#~}";; esac
  # если указали сам public/ — поднимаемся на уровень выше
  case "$dir" in */public) [ -d "$dir" ] && { printf '%s\n' "$dir"; return 0; };; esac
  if [ -d "$dir/public" ]; then printf '%s\n' "$dir/public"; return 0; fi
  if [ -d "$dir/resources/app/public" ]; then printf '%s\n' "$dir/resources/app/public"; return 0; fi
  return 1
}

PUBLIC=""

# 1. Путь из аргумента.
if [ "${1:-}" != "" ]; then
  if ! PUBLIC="$(resolve_public "$1")"; then
    echo "Папка Foundry указана неверно: в «$1» нет public/ (это должна быть папка программы Foundry, содержащая public/)." >&2
    exit 1
  fi
fi

# 2. Автоопределение.
if [ -z "$PUBLIC" ]; then
  for candidate in \
    "/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app" \
    "$HOME/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app" \
    "$HOME/foundryvtt" "$HOME/FoundryVTT" "$HOME/foundry" "/opt/foundryvtt" "/opt/foundry"; do
    if PUBLIC="$(resolve_public "$candidate")"; then
      echo "Найдена папка Foundry: $candidate"
      break
    fi
    PUBLIC=""
  done
fi

# 3. Спросить у пользователя (до 5 попыток; пустой ввод — отмена).
if [ -z "$PUBLIC" ]; then
  if [ ! -t 0 ]; then
    echo "Папка программы Foundry не найдена. Запустите:  sh $0 /путь/до/foundry   (папка, содержащая public/)" >&2
    exit 1
  fi
  echo "Не удалось найти папку программы Foundry автоматически."
  echo "Укажите путь к папке Foundry (той, что содержит public/). Пустая строка — отмена."
  i=1
  while [ "$i" -le 5 ]; do
    printf "Путь до Foundry: "
    IFS= read -r answer || answer=""
    [ -n "$answer" ] || { echo "Отменено."; exit 1; }
    if PUBLIC="$(resolve_public "$answer")"; then break; fi
    echo "  Неверный путь: в «$answer» нет public/. Это должна быть папка программы Foundry (например, .../resources/app)." >&2
    PUBLIC=""
    i=$((i + 1))
  done
  [ -n "$PUBLIC" ] || { echo "Слишком много неверных попыток." >&2; exit 1; }
fi

TARGET="$PUBLIC/$NAME"
if [ -L "$TARGET" ]; then rm "$TARGET"
elif [ -e "$TARGET" ]; then echo "«$TARGET» уже существует и это не ссылка — удалите вручную и запустите снова." >&2; exit 1
fi
ln -s "$MODULE_DIR" "$TARGET"
echo "Готово: $TARGET -> $MODULE_DIR"
echo "Ссылка для игроков:  https://<ваш-foundry>/$NAME/app.html   (перезапуск Foundry не нужен)"
echo "Не забудьте запустить скрипт снова после обновления Foundry."
