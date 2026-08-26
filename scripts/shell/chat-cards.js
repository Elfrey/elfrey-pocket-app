/**
 * Chat card enhancements for the phone. dnd5e only renders its damage-application tray for GMs
 * (targets/selected tokens); players on the app have neither, so every message with damage or healing
 * rolls gets an "apply to me" bar that runs the same dnd5e pipeline: aggregateDamageRolls → Actor#applyDamage
 * (resistances, immunities, temp HP and healing types are all handled by the system).
 */
import { MODULE_ID } from "../settings.js";
import { PocketApp } from "./controller.js";

const L = key => game.i18n.localize(key);

export function registerChatCardEnhancements() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    try {
      addApplyBar(message, html);
    } catch(err) {
      console.warn(`${MODULE_ID} |`, err);
    }
  });
}

function damageRolls(message) {
  const DamageRoll = CONFIG.Dice?.DamageRoll;
  if ( !DamageRoll ) return [];
  return (message.rolls ?? []).filter(r => r instanceof DamageRoll);
}

/** Same construction dnd5e uses for its own damage-application element. */
export function damagesFromMessage(message) {
  const rolls = damageRolls(message);
  if ( !rolls.length ) return [];
  const aggregate = globalThis.dnd5e?.dice?.aggregateDamageRolls;
  const grouped = (typeof aggregate === "function") ? aggregate(rolls, { respectProperties: true }) : rolls;
  return grouped.map(roll => ({
    value: Math.max(0, roll.total ?? 0),
    type: roll.options?.type,
    properties: new Set(roll.options?.properties ?? [])
  }));
}

function addApplyBar(message, html) {
  if ( !html || html.querySelector(".pocket5e-apply") ) return;
  const damages = damagesFromMessage(message);
  if ( !damages.length ) return;
  const total = damages.reduce((n, d) => n + d.value, 0);
  const healing = damages.every(d => ["healing", "temphp"].includes(d.type));

  const bar = document.createElement("div");
  bar.className = `pocket5e-apply${healing ? " healing" : ""}`;
  const label = document.createElement("span");
  label.className = "pocket5e-apply-label";
  label.innerHTML = `<i class="fa-solid ${healing ? "fa-heart" : "fa-heart-crack"}"></i> ${L(healing ? "POCKET5E.Chat.HealMe" : "POCKET5E.Chat.ApplyToMe")} <b>${total}</b>`;
  bar.appendChild(label);
  for ( const [multiplier, text] of [[0.5, "½"], [1, "×1"], [2, "×2"]] ) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.multiplier = String(multiplier);
    button.textContent = text;
    button.title = `${L("POCKET5E.Chat.Multiplier")} ${text}`;
    bar.appendChild(button);
  }

  bar.addEventListener("click", async event => {
    const button = event.target.closest("[data-multiplier]");
    if ( !button ) return;
    const actor = PocketApp.shell?.actor;
    if ( !actor ) return;
    button.disabled = true;
    try {
      await actor.applyDamage(damages, { multiplier: Number(button.dataset.multiplier) });
    } catch(err) {
      console.error(`${MODULE_ID} |`, err);
      ui.notifications.error(err.message);
    } finally {
      button.disabled = false;
    }
  });

  (html.querySelector(".message-content") ?? html).appendChild(bar);
}
