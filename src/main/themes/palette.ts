// -------------------------------------------------------------------
// One palette in, both themes out.
// -------------------------------------------------------------------
//
// createToastTheme() and createDialogTheme() take tokens, which means a single idea like
// "our brand is purple" has to be spelled out several times and in two places: a toast's
// infoAccent and loadingAccent, a dialog's primaryBackground, and the readable colour to
// put on top of each. This states it once.
//
// Only what the palette names is overridden — every other token keeps its default, so a
// palette of one colour changes one colour.

import type { DialogTheme } from "../dialogs/contract/theme.js";
import { createDialogTheme } from "../dialogs/contract/theme.js";
import type { ToastTheme } from "../toasts/contract/theme.js";
import { createToastTheme } from "../toasts/contract/theme.js";

/**
 * The colours an application actually thinks in. Each is a CSS colour — a literal, or a
 * `var(--your-token)` if your design system publishes one, in which case the derived
 * values follow it too.
 */
export interface ThemePalette {
  /** Brand colour. Drives a dialog's primary button and a toast's info and loading. */
  primary?: string;
  success?: string;
  /** Toasts only — dialogs have no warning treatment. */
  warning?: string;
  /** Destructive. Drives a dialog's danger button and a toast's error. */
  danger?: string;
  /** Card and dialog background. */
  surface?: string;
  /** Body text on that surface. */
  text?: string;
  /**
   * Text placed on top of a filled accent. Left out, it is derived per accent with
   * `contrast-color()`, which resolves to white or black — whichever contrasts more.
   *
   * Worth setting explicitly for mid-tone brand colours: `contrast-color()` answers a
   * yes/no question, and for something like a medium blue it picks black, which is legible
   * in principle and poor for small text in practice.
   */
  onAccent?: string;
  /** Corner rounding for both surfaces. */
  radius?: string;
}

/**
 * Named rather than a tuple: positions would have to be remembered, and these two have
 * obvious names. Dialogs first, as everywhere else in the package.
 */
export interface Themes {
  dialogTheme: DialogTheme;
  toastTheme: ToastTheme;
}

/**
 * Build both themes from one set of colours.
 *
 * ```ts
 * const { dialogTheme, toastTheme } = createThemes({
 *   primary: "#7c3aed",
 *   danger: "#e11d48",
 * });
 * createDialogsController({ adapter, theme: dialogTheme });
 * createToastController({ adapter, theme: toastTheme });
 * ```
 *
 * For anything the palette does not cover, keep using {@link createToastTheme} and
 * {@link createDialogTheme} — spread a generated theme and override single tokens.
 */
export function createThemes(palette: ThemePalette = {}): Themes {
  const { primary, success, warning, danger, surface, text, onAccent, radius } =
    palette;

  // Only assign what was given: an undefined value would otherwise overwrite a default
  // with `undefined`, which spreads do not treat as "absent".
  const toasts: Partial<ToastTheme> = {};
  if (primary !== undefined) {
    toasts.infoAccent = primary;
    // Same reasoning the default theme documents: a grey spinner reads as disabled rather
    // than busy, and it keeps promise()'s brand -> success a visible change.
    toasts.loadingAccent = primary;
  }
  if (success !== undefined) toasts.successAccent = success;
  if (warning !== undefined) toasts.warnAccent = warning;
  if (danger !== undefined) toasts.errorAccent = danger;
  if (surface !== undefined) toasts.background = surface;
  if (text !== undefined) {
    toasts.text = text;
    toasts.titleColor = text;
  }
  if (radius !== undefined) toasts.radius = radius;
  // Not derived, unlike the dialog buttons below: a toast has ONE solidText token for
  // every severity (see the element's :host([appearance="solid"]) rules) while the fill
  // behind it changes per type. contrast-color() would have to pick a single accent to
  // measure against and would then be wrong for the others — white, or whatever the caller
  // names, is the honest answer until that token is split per severity.
  if (onAccent !== undefined) toasts.solidText = onAccent;

  const dialogs: Partial<DialogTheme> = {};
  if (primary !== undefined) {
    dialogs.primaryBackground = primary;
    dialogs.primaryText = onAccent ?? `contrast-color(${primary})`;
  }
  if (danger !== undefined) {
    dialogs.dangerBackground = danger;
    dialogs.dangerText = onAccent ?? `contrast-color(${danger})`;
  }
  if (success !== undefined) dialogs.successAccent = success;
  if (surface !== undefined) dialogs.background = surface;
  if (text !== undefined) dialogs.text = text;
  if (radius !== undefined) dialogs.radius = radius;

  return {
    dialogTheme: createDialogTheme(dialogs),
    toastTheme: createToastTheme(toasts),
  };
}
