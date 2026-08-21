// -------------------------------------------------------------------
// Localizable strings for toasts.
// -------------------------------------------------------------------

/**
 * User-facing strings the controller may render but that aren't supplied per
 * toast: the close-button label and the per-severity words used as the
 * default heading and/or screen-reader prefix. Values are plain words ("Error",
 * not "Error:") — the composed punctuation is added by the core.
 */
export type ToastTexts = Record<
  keyof typeof defaultToastTexts,
  string
>;

/** Guaranteed-complete en-US fallback. */
export const defaultToastTexts = {
  dismiss: "Dismiss notification",
  info: "Information",
  success: "Success",
  warn: "Warning",
  error: "Error",
  loading: "Loading",
};

/**
 * Optional, partial text resolver. Always returns plain strings (localized text
 * is never framework content). Called at render time so new toasts pick
 * up the current locale. Return `undefined` for any key you don't handle and
 * the en-US {@link defaultToastTexts} value is used instead.
 */
export type ToastTextResolver = (
  key: keyof ToastTexts,
) => string | undefined;
