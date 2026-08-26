/**
 * Colour theme: "system" (follows prefers-color-scheme), "dark" or "light".
 * Must stay free of Foundry globals at module level — boot.js applies the theme before foundry.mjs loads,
 * reading the client setting straight from localStorage.
 */
import { MODULE_ID, SETTINGS } from "./settings.js";

export const THEMES = ["system", "dark", "light"];
const STORAGE_KEY = `${MODULE_ID}.${SETTINGS.THEME}`;
const META_COLORS = { dark: "#1b1d24", light: "#f3efe6" };

/** Theme setting as stored by ClientSettings (JSON in localStorage), without needing a Game. */
export function storedTheme() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return THEMES.includes(value) ? value : "system";
  } catch(err) {
    return "system";
  }
}

export function currentTheme() {
  try {
    if ( globalThis.game?.settings?.settings?.has(STORAGE_KEY) ) return game.settings.get(MODULE_ID, SETTINGS.THEME);
  } catch(err) { /* fall through */ }
  return storedTheme();
}

export function resolveTheme(setting=currentTheme()) {
  if ( setting === "light" || setting === "dark" ) return setting;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Apply the theme to the document; returns the resolved "dark" | "light". */
export function applyTheme(setting) {
  const resolved = resolveTheme(setting ?? currentTheme());
  document.documentElement.dataset.pocket5eTheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if ( meta ) meta.content = META_COLORS[resolved];
  globalThis.Hooks?.callAll?.("pocket5e.themeChanged", resolved);   // Hooks is absent before foundry.mjs loads
  return resolved;
}

let watching = false;
/** Re-apply when the OS theme flips while the setting is "system". */
export function watchSystemTheme() {
  if ( watching || !window.matchMedia ) return;
  watching = true;
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if ( currentTheme() === "system" ) applyTheme();
  });
}
