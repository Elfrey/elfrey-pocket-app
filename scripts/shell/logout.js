import { MODULE_ID } from "../settings.js";

/** Log out of the current Foundry session, then return to the companion app's own login screen. */
export async function logoutToLogin() {
  try {
    const response = await fetch(foundry.utils.getRoute("join"), {
      credentials: "same-origin",
      cache: "no-store"
    });
    if ( !response.ok ) throw new Error(`Foundry logout failed (HTTP ${response.status}).`);
    window.location.reload();
  } catch(err) {
    console.error(`${MODULE_ID} | logout failed:`, err);
    ui.notifications.error(err?.message ?? String(err));
  }
}
