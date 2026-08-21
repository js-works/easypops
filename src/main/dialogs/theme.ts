// -------------------------------------------------------------------
// Dialog theme: the tokens the dialog chrome understands. Build one with
// createDialogTheme() and pass it as `theme` to createDialogsController.
//
// NOTE (interim): tokens are currently applied via `--dialog-*` CSS custom properties
// set on the dialog element (see dialogs/controller.ts + dialogs/styles.ts). That
// mechanism is slated to change — values will be baked straight into the generated
// stylesheet so the core defines no js-gossip custom properties — but the public shape
// here (DialogTheme / defaultDialogTheme / createDialogTheme) is intended to stay.
// -------------------------------------------------------------------

/** Theme tokens for dialogs. Every token is a CSS value string. */
export interface DialogTheme {
  background: string;
  text: string;
  radius: string;
  /** Colour of the divider line between the body and the footer. */
  divider: string;
  primaryText: string;
  primaryBackground: string;
  secondaryText: string;
  secondaryBackground: string;
  secondaryBorder: string;
  dangerText: string;
  dangerBackground: string;
  /** Colour of the (rarely used) success button variant. */
  successAccent: string;
  closeRadius: string;
  actionRadius: string;
  /** Transition (duration + easing) for action-button hover/press state changes. */
  buttonTransition: string;
  /** Scale an action button shrinks to while pressed, e.g. "0.97"; set "1" to disable. */
  buttonActiveScale: string;
}

/**
 * Built-in dialog defaults — dark-mode-aware surface via `light-dark(...)`, with the
 * host design system's `--ui-*` tokens passed through where present.
 */
export const defaultDialogTheme: DialogTheme = {
  background: "light-dark(white, #333)",
  text: "light-dark(black, white)",
  radius: "4px",
  divider: "light-dark(#e5e7eb, rgba(255, 255, 255, 0.12))",
  primaryText: "var(--ui-surface, #ffffff)",
  primaryBackground: "var(--ui-color-primary-500, #007EC6)",
  secondaryText: "var(--ui-text, #1f2430)",
  secondaryBackground: "white",
  secondaryBorder: "#b0b0b0",
  dangerText: "white",
  dangerBackground: "#D03B3B",
  successAccent: "var(--ui-color-success-500, #00883c)",
  closeRadius: "100%",
  actionRadius: "3px",
  buttonTransition: "120ms ease",
  buttonActiveScale: "1",
};

/** Merge partial tokens over {@link defaultDialogTheme} to produce a full DialogTheme. */
export function createDialogTheme(
  overrides?: Partial<DialogTheme>,
): DialogTheme {
  return { ...defaultDialogTheme, ...overrides };
}
