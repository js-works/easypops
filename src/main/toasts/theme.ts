// -------------------------------------------------------------------
// Toast theme: the tokens the toast cards understand. Build one with createToastTheme()
// and pass it as `theme` to createToastController.
//
// NOTE (interim): tokens are currently applied via CSS custom properties set on the
// stack container (see toasts/controller.ts + the shadow styles in toasts/element.ts).
// That mechanism is slated to change — values baked into the generated stylesheet rather
// than handed over at runtime — but the public shape here (ToastTheme / defaultToastTheme
// / createToastTheme) is intended to stay.
// -------------------------------------------------------------------

/**
 * Theme tokens for toasts. Every token is a CSS value string. The three override-only
 * tokens are optional — omitted, each falls back to the per-severity accent rather than
 * one colour (progressColor = countdown ring, iconColor = built-in icons, actionColor =
 * action labels).
 */
export interface ToastTheme {
  background: string;
  text: string;
  radius: string;
  shadow: string;
  infoAccent: string;
  successAccent: string;
  warnAccent: string;
  errorAccent: string;
  loadingAccent: string;
  titleColor: string;
  messageColor: string;
  closeColor: string;
  closeHoverColor: string;
  closeHoverBackground: string;
  solidText: string;
  darkBackground: string;
  darkText: string;
  darkCloseColor: string;
  progressColor?: string;
  iconColor?: string;
  actionColor?: string;
}

/** Built-in toast defaults (light card; dark mode is opt-in via `appearance: "dark"`). */
export const defaultToastTheme: ToastTheme = {
  background: "#ffffff",
  text: "#111827",
  radius: "5px",
  // Kept tighter than the card gap on purpose. Toasts in a flat list sit TOAST_GAP_PX
  // apart, so a shadow reaching further than that lands on the neighbour below and the
  // stack reads as one shaded column instead of separate cards. Offset plus blur here
  // stay inside that gap; the slightly higher alpha keeps it from looking washed out.
  shadow: "0 4px 10px rgba(0, 0, 0, 0.10), 0 1px 2px rgba(0, 0, 0, 0.06)",
  infoAccent: "#2563eb",
  successAccent: "#16a34a",
  warnAccent: "#d97706",
  errorAccent: "#dc2626",
  // Deliberately the same blue as infoAccent: a gray spinner/stripe reads as disabled
  // rather than busy, and it also makes the promise() transition visible as a color
  // change (blue -> green on success, blue -> red on error). Still its own token, so a
  // theme can decouple the two.
  loadingAccent: "#2563eb",
  titleColor: "#111827",
  messageColor: "#374151",
  closeColor: "#9ca3af",
  closeHoverColor: "#374151",
  closeHoverBackground: "rgba(0, 0, 0, 0.06)",
  solidText: "#ffffff",
  darkBackground: "#1f2937",
  darkText: "#f9fafb",
  darkCloseColor: "#9ca3af",
};

/** Merge partial tokens over {@link defaultToastTheme} to produce a full ToastTheme. */
export function createToastTheme(overrides?: Partial<ToastTheme>): ToastTheme {
  return { ...defaultToastTheme, ...overrides };
}
