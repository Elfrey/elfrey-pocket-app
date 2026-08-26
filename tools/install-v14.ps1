<#
Elfrey Pocket App — настройка для Foundry v14 (Windows).

Foundry v14 отдаёт HTML-файлы из папки данных как обычный текст, поэтому страницу приложения нельзя открыть по
адресу modules\elfrey-pocket-app\app.html. Скрипт создаёт junction из каталога public\ внутри Foundry в папку
модуля; в public\ такого ограничения нет. После этого приложение доступно по адресу  https://<ваш-foundry>/pocket/app.html

Запуск (PowerShell):   .\tools\install-v14.ps1 [-Foundry "C:\...\resources\app"]
  -Foundry — папка *программы* Foundry, содержащая public\. Если не указана, скрипт попробует найти её сам,
  а если не найдёт — спросит. Если Foundry установлен в Program Files, запускайте PowerShell «от имени администратора».
Повторяйте после каждого обновления Foundry: обновление заменяет папку программы, и ссылка пропадает.
#>
param([string]$Foundry = "")
$ErrorActionPreference = "Stop"
$Name = "pocket"
$ModuleDir = Split-Path -Parent $PSScriptRoot

# Возвращает путь к public\ внутри переданной папки Foundry, либо $null, если это не она.
function Resolve-Public([string]$dir) {
  if ([string]::IsNullOrWhiteSpace($dir)) { return $null }
  $dir = $dir.Trim().Trim('"')
  if ((Split-Path -Leaf $dir) -ieq "public" -and (Test-Path $dir)) { return $dir }
  if (Test-Path (Join-Path $dir "public")) { return (Join-Path $dir "public") }
  if (Test-Path (Join-Path $dir "resources\app\public")) { return (Join-Path $dir "resources\app\public") }
  return $null
}

$Public = $null

# 1. Путь из параметра.
if ($Foundry) {
  $Public = Resolve-Public $Foundry
  if (-not $Public) {
    Write-Host "Папка Foundry указана неверно: в `"$Foundry`" нет public\ (это должна быть папка программы Foundry, содержащая public\)." -ForegroundColor Red
    exit 1
  }
}

# 2. Автоопределение.
if (-not $Public) {
  foreach ($candidate in @(
    "$env:ProgramFiles\Foundry Virtual Tabletop\resources\app",
    "$env:LOCALAPPDATA\Programs\Foundry Virtual Tabletop\resources\app",
    "C:\FoundryVTT\resources\app", "C:\FoundryVTT")) {
    $p = Resolve-Public $candidate
    if ($p) { $Public = $p; Write-Host "Найдена папка Foundry: $candidate"; break }
  }
}

# 3. Спросить у пользователя (до 5 попыток; пустая строка — отмена).
if (-not $Public) {
  Write-Host "Не удалось найти папку программы Foundry автоматически."
  Write-Host "Укажите путь к папке Foundry (той, что содержит public\). Пустая строка — отмена."
  for ($i = 1; $i -le 5; $i++) {
    $answer = Read-Host "Путь до Foundry"
    if ([string]::IsNullOrWhiteSpace($answer)) { Write-Host "Отменено."; exit 1 }
    $Public = Resolve-Public $answer
    if ($Public) { break }
    Write-Host "  Неверный путь: в `"$answer`" нет public\. Это должна быть папка программы Foundry (например, ...\resources\app)." -ForegroundColor Red
  }
  if (-not $Public) { Write-Host "Слишком много неверных попыток." -ForegroundColor Red; exit 1 }
}

$Target = Join-Path $Public $Name
if (Test-Path $Target) {
  $item = Get-Item $Target -Force
  if ($item.LinkType) { Remove-Item $Target -Force -Recurse:$false }
  else { Write-Host "`"$Target`" уже существует и это не ссылка — удалите вручную и запустите снова." -ForegroundColor Red; exit 1 }
}
try {
  New-Item -ItemType Junction -Path $Target -Target $ModuleDir | Out-Null
} catch {
  Write-Host "Не удалось создать ссылку в `"$Public`". Если Foundry в Program Files, запустите PowerShell от имени администратора." -ForegroundColor Red
  exit 1
}
Write-Host "Готово: $Target -> $ModuleDir"
Write-Host "Ссылка для игроков:  https://<ваш-foundry>/$Name/app.html   (перезапуск Foundry не нужен)"
Write-Host "Не забудьте запустить скрипт снова после обновления Foundry."
