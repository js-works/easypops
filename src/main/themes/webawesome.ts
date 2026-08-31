// -------------------------------------------------------------------
// Web Awesome's design tokens as an easypops theme — both halves, toasts and dialogs.
// -------------------------------------------------------------------
//
// Nothing here is a copied colour. Web Awesome publishes its tokens as CSS custom
// properties, so every value below is a reference rather than a snapshot:
// change a token in the host app and these follow, including its light/dark switch, which
// Web Awesome does by rescoping the same tokens under .wa-light / .wa-dark. That is the
// whole reason this theme is worth having over a hand-matched palette.
//
// Naming follows --wa-color-{variant}-{fill|border|on}-{quiet|normal|loud}: `fill` is a
// background, `border` a stroke, and `on` the content that sits atop a fill. The three
// attention levels are how loud that pairing is. Fallbacks are the easypops defaults, so
// the theme degrades to the built-in look rather than to nothing if Web Awesome is absent.
//
// Reached as "easypops/themes/webawesome".

import { createDialogTheme } from "../dialogs/contract/theme.js";
import { createToastTheme } from "../toasts/contract/theme.js";

// Through the factories rather than spreading the defaults by hand: that is the documented
// way to build a theme, and it keeps working if the merge ever stops being a plain spread.
export const webawesomeToastTheme = createToastTheme({
  // A toast floats over the page, which is what `raised` means in Web Awesome's three
  // surface levels (lowered / default / raised).
  background: "var(--wa-color-surface-raised, #ffffff)",
  text: "var(--wa-color-text-normal, #111827)",
  radius: "var(--wa-border-radius-m, 5px)",
  shadow: "var(--wa-shadow-l, 0 10px 25px rgba(0, 0, 0, 0.08))",

  // `fill-loud` rather than `-normal`: an accent has to work both as a thin stripe on a
  // light card AND as the whole background of a "solid" toast, so it needs to be the
  // saturated end of the variant.
  infoAccent: "var(--wa-color-brand-fill-loud, #2563eb)",
  successAccent: "var(--wa-color-success-fill-loud, #16a34a)",
  warnAccent: "var(--wa-color-warning-fill-loud, #d97706)",
  errorAccent: "var(--wa-color-danger-fill-loud, #dc2626)",
  // Same token as info, for the reason the default theme documents: a grey spinner reads
  // as disabled rather than busy, and brand -> success stays a visible change for
  // controller.promise(). Web Awesome's `brand` is its primary.
  loadingAccent: "var(--wa-color-brand-fill-loud, #2563eb)",

  // Web Awesome has the title/body distinction as its own pair, so this needs no invented
  // muted grey the way the Bootstrap theme did.
  titleColor: "var(--wa-color-text-normal, #111827)",
  messageColor: "var(--wa-color-text-quiet, #374151)",

  closeColor: "var(--wa-color-text-quiet, #9ca3af)",
  closeHoverColor: "var(--wa-color-text-normal, #374151)",
  // NOT --wa-color-mix-hover: that token is an ingredient for color-mix(), not a colour,
  // so it cannot stand as a background on its own. A quiet neutral fill is what Web Awesome
  // means by "a barely-there surface", which is exactly this job.
  closeHoverBackground:
    "var(--wa-color-neutral-fill-quiet, rgba(0, 0, 0, 0.06))",

  // Content atop a loud fill. Web Awesome scopes this per variant; easypops has one token
  // for every severity, so brand's stands in — in practice all five resolve to the same
  // near-white.
  solidText: "var(--wa-color-brand-on-loud, #ffffff)",

  // The "dark" appearance is a per-toast choice, not the page's colour mode, so it must not
  // follow --wa-color-surface-*: under .wa-dark that would make a dark toast identical to a
  // normal one. A loud neutral fill is the darkest surface the token set offers while still
  // being a themed value.
  darkBackground: "var(--wa-color-neutral-fill-loud, #1f2937)",
  darkText: "var(--wa-color-neutral-on-loud, #f9fafb)",
  darkCloseColor: "var(--wa-color-neutral-on-loud, #9ca3af)",
});

export const webawesomeDialogTheme = createDialogTheme({
  background: "var(--wa-color-surface-raised, light-dark(white, #333))",
  text: "var(--wa-color-text-normal, light-dark(black, white))",
  // One step up from the toasts' radius: Web Awesome's scale is relative, and a dialog is
  // the larger surface of the two.
  radius: "var(--wa-border-radius-l, 4px)",
  divider: "var(--wa-color-surface-border, light-dark(#e5e7eb, rgba(255, 255, 255, 0.12)))",

  primaryText: "var(--wa-color-brand-on-loud, #ffffff)",
  primaryBackground: "var(--wa-color-brand-fill-loud, #007EC6)",
  // The secondary button is the quiet pairing of the same variant, which is precisely the
  // distinction Web Awesome's attention levels exist to express.
  secondaryText: "var(--wa-color-neutral-on-quiet, #1f2430)",
  secondaryBackground: "var(--wa-color-neutral-fill-quiet, white)",
  secondaryBorder: "var(--wa-color-neutral-border-normal, #b0b0b0)",
  dangerText: "var(--wa-color-danger-on-loud, white)",
  dangerBackground: "var(--wa-color-danger-fill-loud, #D03B3B)",
  successAccent: "var(--wa-color-success-fill-loud, #00883c)",

  closeRadius: "var(--wa-border-radius-circle, 100%)",
  actionRadius: "var(--wa-border-radius-m, 3px)",

  // Web Awesome splits duration from easing; this token wants them as one value, so the
  // two are composed here. `fast` is its own word for hover and focus — "frequent,
  // incidental state changes" — which is what an action button does.
  buttonTransition:
    "var(--wa-transition-fast, 120ms) var(--wa-transition-easing, ease)",

  // No Web Awesome counterpart: it does not scale controls on press. The default already
  // disables the effect, so this is left out entirely rather than restated.
});
