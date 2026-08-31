// -------------------------------------------------------------------
// Internal bridge types between the scope/controller and the dialog element.
// The controller produces a DialogSpec (see adapter.ts); the mount layer hands it to the
// bound adapter and gives back a DialogMount. Neither is part of the public API.
// -------------------------------------------------------------------

import type { DialogSpec } from "./adapter.js";
import type { ActionButtonType, ButtonRole } from "./dialog.js";

export interface DialogButtonView {
  role: ButtonRole;
  type: ActionButtonType;
  /** Busy state, owned by the controller so an adapter can build a render descriptor. */
  loading: boolean;
  text: string;
  onClick: () => void;
}

export interface ResolvedNote {
  title?: string;
  message: string;
}

export interface DialogMount {
  /**
   * Put a dialog on screen. Whatever is there already (the spinner placeholder, or the
   * previous dialog of a scope) fades out first and the new one grows in — without ever
   * closing the `<dialog>`, so the modal backdrop stays up for the whole scope.
   */
  show(spec: DialogSpec<any>): void;
  /**
   * Re-render in place: no entrance animation, no focus change. Whether that disturbs the
   * caller's content is the adapter's business — an unchanged slot is diffed, not rebuilt,
   * which is what keeps an <input> the user has typed into intact.
   */
  update(spec: DialogSpec<any>): void;
  close(): Promise<void>;
  /** The form element rendered inside the dialog, if any. */
  getForm(): HTMLFormElement | null;
  /**
   * Move focus to the form's first `aria-invalid="true"` control, falling back to
   * `[autofocus]`. Called when a validator turns a confirm click down; a no-op when the
   * form marks neither.
   */
  focusFirstInvalid(): void;
}
