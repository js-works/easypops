// -------------------------------------------------------------------
// # Button configs
// -------------------------------------------------------------------

import type { ActionButtonType, ButtonRole } from "../contract/types.js";
import type { TextKey } from "../contract/texts.js";

export type { ButtonRole } from "../contract/types.js";

export interface ButtonConfig {
  /** Result identity. `cancel` resolves the canceled branch; the others map to actions. */
  id: symbol;
  /** Which `config.buttons.*` entry overrides this button's text. */
  overrideKey: ButtonRole;
  type: ActionButtonType;
  text?: string | null;
  defaultTextKey: TextKey;
  /** Whether pressing this button should submit + validate the (optional) form. */
  validate: boolean;
}

export const symbolOk = Symbol("ok");
export const symbolCancel = Symbol("cancel");
export const symbolConfirm = Symbol("confirm");
export const symbolDecline = Symbol("decline");

// All button configurations, built by one small factory: btn(id, overrideKey,
// type, defaultTextKey). Buttons that submit + validate the form are exactly the
// non-secondary ones, so `validate` is derived rather than repeated.
function btn(
  id: symbol,
  overrideKey: ButtonRole,
  type: ActionButtonType,
  defaultTextKey: TextKey,
): ButtonConfig {
  return {
    id,
    overrideKey,
    type,
    defaultTextKey,
    validate: type !== "secondary",
  };
}

export const okBtn = btn(symbolOk, "ok", "primary", "buttonOk");
export const okBtnDanger = btn(symbolOk, "ok", "danger", "buttonOk");
export const confirmBtn = btn(symbolConfirm, "confirm", "primary", "buttonOk");
export const confirmBtnDanger = btn(symbolConfirm, "confirm", "danger", "buttonOk");
export const cancelBtn = btn(symbolCancel, "cancel", "secondary", "buttonCancel");
export const yesBtn = btn(symbolConfirm, "confirm", "primary", "buttonYes");
export const yesBtnDanger = btn(symbolConfirm, "confirm", "danger", "buttonYes");
export const noBtn = btn(symbolDecline, "decline", "secondary", "buttonNo");
