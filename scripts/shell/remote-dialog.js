/**
 * RemoteDialog — renders Chris's Premades dialog descriptors (DialogApp.dialog(title, content, inputs, buttons,
 * config)) as a bottom sheet and returns the same result object CPR's own DialogApp produces:
 *   { buttons: true | false | <button name>, <field name>: value, … }   or null when dismissed.
 *
 * Input descriptor (scripts/applications/dialog.js in CPR): [type, fields, options] with
 *   button       fields {label, name, options:{image, tooltip}}                   → buttons: name
 *   checkbox     fields {label, name, options:{isChecked, image}} opts {totalMax}  → name: boolean
 *   radio        fields {label, name, options:{isChecked, image}} opts {radioName} → radioName: name
 *   selectAmount fields {label, name, options:{minAmount, maxAmount, currentAmount, weight, image}} → name: number
 *   selectOption fields {label, name, options:{options:[{value,label}]|string[], currentValue}}     → name: string
 *   selectMany   fields {label, name, options:{options:[{value,label}], value:[]}}                   → name: string[]
 *   text/number  fields {label, name, options:{currentValue}}                                         → name: value
 *   filePicker   fields {label, name, options:{currentValue}}  (plain text field here)                → name: string
 * `buttons` is one of "yesNo" | "okCancel" | "ok" | "cancel" | undefined (button inputs decide).
 */
import { MODULE_ID } from "../settings.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** CPR's footer button labels, with our own strings when CPR's language file is not loaded. */
const FOOTER = {
  yesNo: [["CHRISPREMADES.Generic.Yes", "POCKET5E.Bridge.Yes", "true", true], ["CHRISPREMADES.Generic.No", "POCKET5E.Bridge.No", "false", false]],
  okCancel: [["CHRISPREMADES.Generic.Ok", "POCKET5E.Bridge.Ok", "true", true], ["CHRISPREMADES.Generic.Cancel", "POCKET5E.Bridge.Cancel", "false", false]],
  ok: [["CHRISPREMADES.Generic.Ok", "POCKET5E.Bridge.Ok", "true", true]],
  cancel: [["CHRISPREMADES.Generic.Cancel", "POCKET5E.Bridge.Cancel", "false", false]]
};

function label(key, fallbackKey) {
  if ( typeof key !== "string" ) return "";
  if ( game.i18n.has(key) ) return game.i18n.localize(key);
  if ( fallbackKey && game.i18n.has(fallbackKey) ) return game.i18n.localize(fallbackKey);
  return key;
}

export class RemoteDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static #queue = Promise.resolve();

  /** Show one dialog at a time (CPR may fire several); resolves with the result object or null. */
  static show(spec) {
    const run = () => new Promise(resolve => {
      const app = new this();
      app.spec = spec;
      app.#resolve = resolve;
      app.render({ force: true });
    });
    const next = this.#queue.then(run, run);
    this.#queue = next.catch(() => {});
    return next;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["pocket5e-app", "pocket5e-drawer", "pocket5e-remote"],
    window: { frame: false, positioned: false },
    actions: {
      close: RemoteDialog.#onDismiss,
      dlgButton: RemoteDialog.#onButton,
      dlgSubmit: RemoteDialog.#onSubmit
    }
  };

  /** @override */
  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/shell/remote-dialog.hbs`, scrollable: [".pocket5e-drawer-body"] }
  };

  spec = {};
  #resolve = null;

  constructor(options={}) {
    super({ id: `pocket5e-remote-${foundry.utils.randomID(6)}`, ...options });
  }

  _insertElement(element) {
    const root = document.getElementById("pocket5e-root") ?? document.body;
    const existing = document.getElementById(element.id);
    if ( existing ) existing.replaceWith(element);
    else root.append(element);
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const { title, content, inputs=[], buttons } = this.spec;
    context.title = label(title) || game.i18n.localize("POCKET5E.Bridge.DialogTitle");
    context.content = typeof content === "string" ? label(content) : "";
    context.groups = inputs.map((entry, i) => this.#group(entry, i)).filter(Boolean);
    context.footer = (FOOTER[buttons] ?? []).map(([key, fallback, value, primary]) => ({ label: label(key, fallback), value, primary }));
    context.hasFooter = context.footer.length > 0;
    return context;
  }

  #group([type, fields=[], opts={}], index) {
    const rows = (fields ?? []).map((f, j) => ({
      id: `i${index}j${j}`,
      label: label(f.label),
      name: f.name,
      image: f.options?.image ? String(f.options.image).split(" (")[0] : "",
      tooltip: f.options?.tooltip ?? "",
      checked: !!f.options?.isChecked,
      value: f.options?.currentValue ?? "",
      min: f.options?.minAmount ?? 0,
      max: f.options?.maxAmount ?? 10,
      current: f.options?.currentAmount ?? 0,
      options: normalizeOptions(f.options?.options, f.options?.currentValue, f.options?.value)
    }));
    const g = { type, rows, radioName: opts?.radioName ?? "radio", totalMax: opts?.totalMax };
    switch ( type ) {
      case "button": g.isButton = true; break;
      case "checkbox": g.isCheckbox = true; break;
      case "radio": g.isRadio = true; break;
      case "selectAmount":
        g.isSelectAmount = true;
        for ( const r of g.rows ) r.amounts = Array.from({ length: Math.max(0, r.max - r.min + 1) }, (_, k) => ({ value: r.min + k, selected: (r.min + k) === r.current }));
        break;
      case "selectOption": g.isSelectOption = true; break;
      case "selectMany": g.isSelectMany = true; break;
      case "number": g.isNumber = true; break;
      case "text": case "filePicker": g.isText = true; break;
      default: return null;
    }
    return g;
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    this.#finish(null);
  }

  #finish(result) {
    const resolve = this.#resolve;
    this.#resolve = null;
    resolve?.(result);
    if ( this.rendered ) this.close();
  }

  /** Read every field back from the DOM into CPR's flat { name: value } shape (then expanded like FormData would be). */
  #collect() {
    const flat = {};
    const root = this.element;
    for ( const el of root.querySelectorAll("[data-field]") ) {
      const name = el.dataset.field;
      switch ( el.dataset.kind ) {
        case "checkbox": flat[name] = el.checked; break;
        case "radio": if ( el.checked ) flat[el.name] = el.value; break;
        case "amount": flat[name] = Number(el.value); break;
        case "number": flat[name] = el.value === "" ? 0 : Number(el.value); break;
        case "select": flat[name] = el.value; break;
        case "multi": flat[name] = Array.from(el.selectedOptions).map(o => o.value); break;
        default: flat[name] = el.value;
      }
    }
    // Radio groups where nothing is checked still need their key present (CPR reads selection.targets etc.).
    for ( const el of root.querySelectorAll("[data-kind=radio]") ) flat[el.name] ??= undefined;
    return foundry.utils.expandObject(flat);
  }

  static #onDismiss() { this.#finish(null); }

  static #onButton(event, target) {
    const result = this.#collect();
    result.buttons = target.dataset.name;
    this.#finish(result);
  }

  static #onSubmit(event, target) {
    if ( target.dataset.value === "false" ) { this.#finish({ buttons: false }); return; }
    const result = this.#collect();
    result.buttons = true;
    this.#finish(result);
  }
}

function normalizeOptions(options, currentValue, selectedValues) {
  if ( !Array.isArray(options) ) return [];
  const selected = new Set(Array.isArray(selectedValues) ? selectedValues : []);
  return options.map(o => {
    const value = (o && typeof o === "object") ? o.value : o;
    const text = (o && typeof o === "object") ? (o.label ?? o.value) : o;
    return { value, label: label(String(text)), selected: (value === currentValue) || selected.has(value) };
  });
}
