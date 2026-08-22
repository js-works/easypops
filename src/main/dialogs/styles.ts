// -------------------------------------------------------------------
// # Styles & timing
// -------------------------------------------------------------------

import { defaultDialogTheme } from "./theme.js";

// Interim application mechanism: each token is a `--dialog-*` custom property (set from
// the controller's `theme` option, see createDialogsController) whose inline fallback is
// the built-in default from `defaultDialogTheme` — a single source. (Slated to change to
// baking values straight into the generated stylesheet; see dialogs/theme.ts.)
const theme = {
  textColor: `var(--dialog-text, ${defaultDialogTheme.text})`,
  dividerColor: `var(--dialog-divider, ${defaultDialogTheme.divider})`,
  primaryTextColor: `var(--dialog-primary-text, ${defaultDialogTheme.primaryText})`,
  primaryBackgroundColor: `var(--dialog-primary-background, ${defaultDialogTheme.primaryBackground})`,
  secondaryTextColor: `var(--dialog-secondary-text, ${defaultDialogTheme.secondaryText})`,
  secondaryBackgroundColor: `var(--dialog-secondary-background, ${defaultDialogTheme.secondaryBackground})`,
  secondaryBorderColor: `var(--dialog-secondary-border, ${defaultDialogTheme.secondaryBorder})`,
  dangerTextColor: `var(--dialog-danger-text, ${defaultDialogTheme.dangerText})`,
  dangerBackgroundColor: `var(--dialog-danger-background, ${defaultDialogTheme.dangerBackground})`,
  successColor: `var(--dialog-success-accent, ${defaultDialogTheme.successAccent})`,
  dialogBorderRadius: `var(--dialog-radius, ${defaultDialogTheme.radius})`,
  closeButtonBorderRadius: `var(--dialog-close-radius, ${defaultDialogTheme.closeRadius})`,
  actionButtonBorderRadius: `var(--dialog-action-radius, ${defaultDialogTheme.actionRadius})`,
  dialogBackgroundColor: `var(--dialog-background, ${defaultDialogTheme.background})`,
  buttonTransition: `var(--dialog-button-transition, ${defaultDialogTheme.buttonTransition})`,
  buttonActiveScale: `var(--dialog-button-active-scale, ${defaultDialogTheme.buttonActiveScale})`,
} as const;

// Duration of the reject message appear/disappear (collapse) animation. Drives both the
// CSS transition and the JS timer that removes the element after the collapse finishes.
export const REJECT_MESSAGE_ANIM_MS = 450;

// Duration of the real dialog's grow-in (entrance) animation — used for the first real
// dialog in a scope and every in-scope swap (see #growIn in element.ts).
export const DIALOG_GROW_ANIM_MS = 200;

// Duration of the spinner placeholder's drop-in animation (see #growIn in element.ts).
export const SPINNER_DROP_ANIM_MS = 500;

// Duration of the dialog's fade-out (close) animation.
export const DIALOG_CLOSE_ANIM_MS = 200;

// Duration of the backdrop's fade-in animation (dialog opening).
export const BACKDROP_FADE_IN_ANIM_MS = 200;

// Duration of the backdrop's fade-out animation (dialog closing).
export const BACKDROP_FADE_OUT_ANIM_MS = 200;

// Duration of the quick fade-out when swapping one on-screen dialog for the next within
// a scope (the backdrop stays up; only the box content changes, then grows back in).
export const SWAP_OUT_MS = 140;

// Fade-out for the spinner placeholder when the real dialog is ready. Longer than
// SWAP_OUT_MS: the placeholder is a small circle handing off to a much larger box, and a
// swap that quick reads as a cut rather than a dissolve.
export const SPINNER_SWAP_OUT_MS = 300;

// If nothing opens within this delay, a round spinner dialog is shown as a placeholder.
export const SPINNER_DIALOG_DELAY_MS = 300;

// Delay before an action button's inline spinner appears once its handler is running.
export const BUTTON_SPINNER_DELAY_MS = 150;

// Belt-and-braces close timeout in case the close animation's `animationend` never fires.
export const CLOSE_ANIMATION_FALLBACK_MS = DIALOG_CLOSE_ANIM_MS + 100;

const dialogStyles = `
  dialog {
    outline: none;
    position: fixed;
    /* Sit high and horizontally centered. margin-block-start pushes the dialog
       down proportionally on tall viewports but never lets it touch the top
       (2em floor); margin-block-end: auto lets it grow downward rather than
       being pulled up by a self-offset. */
    inset: 0;
    width: fit-content;
    /* Cap the line length so a long single-line message wraps to a few lines instead of
       stretching the dialog very wide — a calmer width/height ratio. Still shrinks to fit
       the viewport on small screens. */
    max-width: min(calc(100dvw - 4em), 34em);
    height: fit-content;
    max-height: calc(100dvh - 4em);
    margin-inline: auto;
    margin-block: max(2em, 12dvh) auto;
    color: ${theme.textColor};
    background-color: ${theme.dialogBackgroundColor};
    border: none;
    border-radius: ${theme.dialogBorderRadius};
    min-width: 22em;
    box-sizing: border-box;
    padding: 0;
    overflow: auto;
    box-shadow: 0 10px 30px -5px rgba(0,0,0,0.25), 0 4px 10px -4px rgba(0,0,0,0.15);  
  }

  dialog[open].closing {
    animation: dialog-fade-out ${DIALOG_CLOSE_ANIM_MS}ms ease-in-out;
  }

  dialog[open]::backdrop {
    background-color: rgba(0, 0, 0, 0.4);
  }

  dialog[open]:not(.closing)::backdrop {
    animation: backdrop-fade-in ${BACKDROP_FADE_IN_ANIM_MS}ms ease-in-out;
  }

  dialog[open].closing::backdrop {
    animation: backdrop-fade-out ${BACKDROP_FADE_OUT_ANIM_MS}ms ease-in-out;
  }

  /* Form dialogs get a bit more room so labelled fields aren't cramped. */
  :host([data-dialog-type="form"]) dialog,
  :host([data-dialog-type="formCritical"]) dialog {
    min-width: 26em;
  }

  /* ---- Drawer surface ------------------------------------------------------
     Same modal <dialog> as every other type — only the geometry changes, so the focus
     trap, inert background, Escape handling and ::backdrop all keep working untouched.
     Undoes the centering above: auto on the start side pushes the panel to the inline-end
     edge (right in LTR, left in RTL) and it fills the block axis. */
  :host([data-dialog-type="drawer"]) dialog {
    margin-inline-start: auto;
    margin-inline-end: 0;
    margin-block: 0;
    width: min(calc(100dvw - 2em), 30em);
    max-width: none;
    /* The base rule's 22em floor would exceed the panel width on a narrow phone and push
       content out of the viewport. */
    min-width: 0;
    height: 100dvh;
    max-height: none;
    border-radius: 0;
    /* The panel itself doesn't scroll — its body does (below) — so the title and the
       action buttons stay put on a long form. */
    overflow: hidden;
  }

  :host([data-dialog-type="drawer"]) .dialog-content {
    display: flex;
    flex-direction: column;
    height: 100%;
    /* Same reason as min-width above: the base 20em floor is wider than the panel on a
       small screen. */
    min-width: 0;
  }

  :host([data-dialog-type="drawer"]) .dialog-content .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  /* Slides out to the edge rather than fading in place. The distance is a custom property
     because transforms have no logical equivalent — the element sets it per writing
     direction (see #growIn in element.ts). */
  :host([data-dialog-type="drawer"]) dialog[open].closing {
    animation: drawer-slide-out ${DIALOG_CLOSE_ANIM_MS}ms ease-in-out;
  }

  #icon {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    /* The slotted glyphs are sized in em (width/height="1em" in the markup), so this
       is the single lever for how large the header icon renders. */
    font-size: 1.6em;
    line-height: 1;
  }

  /* The icon is projected through the "icon" slot (light DOM), so this stylesheet
     can't reach the actual <svg> inside it: ::slotted() only selects the top-level
     slotted node itself, never its descendants (this previous rule tried
     "::slotted([slot=\"icon\"]) svg", which is invalid — a pseudo-element can't be
     followed by a further compound selector — and, being comma-listed with #icon
     svg, silently invalidated this whole rule). Sizing/overflow for these glyphs is
     baked into the SVG markup itself (see internal/icons.ts, dialogs/icons.ts)
     instead; this just avoids the inline-element baseline gap on the wrapper. */
  ::slotted([slot="icon"]) {
    display: flex;
  }

  :host([data-dialog-type="info"]) #icon,
  :host([data-dialog-type="confirm"]) #icon,
  :host([data-dialog-type="decide"]) #icon,
  :host([data-dialog-type="success"]) #icon {
    color: ${theme.primaryBackgroundColor};
  }

  :host([data-dialog-type="warn"]) #icon,
  :host([data-dialog-type="error"]) #icon,
  :host([data-dialog-type="confirmCritical"]) #icon,
  :host([data-dialog-type="decideCritical"]) #icon {
    color: ${theme.dangerBackgroundColor};
  }

  .dialog-content {
    /* Chrome (titles, buttons) stays unselectable; the body and reject message opt back
       into text selection below so error messages can be copied. */
    user-select: none;
    min-width: 20em;
    font-size: 16px;
    font-family:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial,
      sans-serif;
  }

  .dialog-content .header {
    display: flex;
    align-items: center;
    gap: 0.6em;
    padding: 1.25em 1.5em 0.75em;
  }

  /* Grows to fill the row so the close button is pushed to the far edge; min-width: 0
     lets long titles wrap/ellipsize instead of overflowing. */
  .dialog-content .header .titles {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .dialog-content .header .titles .title {
    font-size: 1.1em;
    font-weight: 600;
    line-height: 1.25;
  }

  .dialog-content .header .titles .subtitle {
    font-size: 0.95em;
    line-height: 1.25;
    margin-top: -0.1em;
    opacity: 0.8;
  }

  .dialog-content .body {
    display: flex;
    flex-direction: column;
    gap: 0.5em;
    padding: 0 1.5em 1.1em 1.5em;
    min-height: 1.75em;
    line-height: 1.25em;
    user-select: text;
    /* Even out line lengths for the short message blocks; progressively enhanced —
       browsers without support fall back to normal wrapping. */
    text-wrap: balance;
  }

  .dialog-content .footer {
    user-select: none;
  }

  .dialog-content .footer .action-buttons {
    display: flex;
    flex-direction: row-reverse;
    gap: 0.4em;
    padding: 0.6em 1.5em;
  }

  .action-button {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    outline: none;
    border: none;
    border-radius: ${theme.actionButtonBorderRadius};
    padding: 0.65em 1.5em;
    /* A stack that ships a Medium (500) face, so the weight below is visible (unlike
       Helvetica/Arial, which only have 400 + 700). */
    font-family:
      system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif;
    font-weight: 500;
    /* Pin the line-height so the label box doesn't inherit the host page's line-height
       (which crosses the shadow boundary) — keeps the button snug and centering exact. */
    line-height: 1;
    cursor: pointer;
    transition:
      background-color ${theme.buttonTransition},
      border-color ${theme.buttonTransition},
      transform ${theme.buttonTransition};
  }

  .action-button:active {
    transform: scale(${theme.buttonActiveScale});
  }

  .action-button .spinner {
    display: none;
  }

  .action-button.loading .spinner {
    display: block;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(0deg);
    width: 1.5em;
    height: 1.5em;
    border: 3px solid color-mix(in srgb, currentColor 20%, transparent);
    border-top: 3px solid currentColor;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    overflow: hidden;
    box-sizing: border-box;
  }

  .action-button.loading .button-text {
    visibility: hidden;
  }

  .action-button[data-type="primary"] {
    color: ${theme.primaryTextColor};
    background-color: ${theme.primaryBackgroundColor};
  }
  .action-button[data-type="primary"]:hover {
    background-color: color-mix(in srgb, ${theme.primaryBackgroundColor}, black 10%);
  }
  .action-button[data-type="primary"]:active {
    background-color: color-mix(in srgb, ${theme.primaryBackgroundColor}, black 20%);
  }

  .action-button[data-type="secondary"] {
    color: ${theme.secondaryTextColor};
    background-color: ${theme.secondaryBackgroundColor};
    border: 1px solid ${theme.secondaryBorderColor};
  }
  .action-button[data-type="secondary"]:hover {
    background-color: color-mix(in srgb, ${theme.secondaryBackgroundColor}, black 5%);
  }
  .action-button[data-type="secondary"]:active {
    background-color: color-mix(in srgb, ${theme.secondaryBackgroundColor}, black 10%);
  }

  .action-button[data-type="danger"] {
    color: ${theme.dangerTextColor};
    background-color: ${theme.dangerBackgroundColor};
  }
  .action-button[data-type="danger"]:hover {
    background-color: color-mix(in srgb, ${theme.dangerBackgroundColor}, black 15%);
  }
  .action-button[data-type="danger"]:active {
    background-color: color-mix(in srgb, ${theme.dangerBackgroundColor}, black 40%);
  }

  .action-button[data-type="success"] {
    color: white;
    background-color: ${theme.successColor};
  }
  .action-button[data-type="success"]:hover {
    background-color: color-mix(in srgb, ${theme.successColor}, black 10%);
  }
  .action-button[data-type="success"]:active {
    background-color: color-mix(in srgb, ${theme.successColor}, black 20%);
  }

  .close-button {
    align-self: flex-start;
    border: none;
    border-radius: ${theme.closeButtonBorderRadius};
    outline: none;
    margin: 0;
    font-size: 1em;
    line-height: 0;
    background-color: transparent;
    cursor: pointer;
    padding: 0.3em;
  }
  .close-button:hover {
    background-color: light-dark(
      color-mix(in srgb, white, black 7%),
      color-mix(in srgb, black, white 7%)
    );
  }
  .close-button:active {
    background-color: light-dark(
      color-mix(in srgb, #f0f0f0, black 10%),
      color-mix(in srgb, #f0f0f0, white 10%)
    );
  }

  /* Reject message (see FormAttempt.reject): lives inside the footer (see element.ts
     #setRejectMessage), as its first child — flush against the footer's top border
     (the divider line) with no gap, and edge-to-edge across the dialog with no rounding.
     Flat fill, normal text color, reddish icon.

     The enter/exit collapse is animated in JS (element.ts #animateRejectMessageHeight)
     via the Web Animations API, using the element's actual measured height rather than a
     CSS transition — a height transition needs a concrete end value and "auto" isn't
     one. Two CSS-only workarounds were tried and discarded: an oversized max-height
     spent most of the transition idle and then clipped unevenly right at the end (the
     icon and text visibly diverged), and an animated CSS Grid fr track wasn't reliably
     smooth across engines. overflow: hidden below just clips content during that
     JS-driven height animation. */
  .reject-message {
    margin: 0;
    /* Load-bearing for the animation, not cosmetic. #animateRejectMessageHeight measures
       getBoundingClientRect().height — a border-box figure — and animates the "height"
       property to it. Under the default content-box that end frame renders 2px taller
       than the element's natural size (the two 1px borders sit outside the animated
       height), so clearing the inline height on finish snapped it back by 2px at full
       opacity. Matching the box model to the measurement removes that jump. */
    box-sizing: border-box;
    border: none;
    border-top: 1px solid #e8e8e8;
    border-bottom: 1px solid #e8e8e8;
    border-radius: 0;
    color: ${theme.textColor};
    background-color: #f8f8f8;
    font-size: 0.85em;
    line-height: 1.35;
    user-select: text;
    overflow: hidden;
  }

  .reject-message-inner {
    display: flex;
    align-items: center;
    gap: 0.85em;
    padding: 0.85em 1.5em;
  }

  .reject-message .reject-message-icon {
    flex: none;
    display: flex;
    align-items: center;
    font-size: 1.5em;
    line-height: 1;
    color: ${theme.dangerBackgroundColor};
  }

  .reject-message-body {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .reject-message-title {
    font-weight: 600;
    line-height: 1.15;
  }
  .reject-message-text {
    line-height: 1.25;
  }
  .reject-message-icon svg {
    display: block;
    width: 1em;
    height: 1em;
    /* This glyph draws to the edge of its 16×16 viewBox; the SVG viewport would
       otherwise shave that outer edge at this small size. */
    overflow: visible;
  }


  @keyframes drawer-slide-out {
    to {
      transform: translateX(var(--drawer-exit-translate, 100%));
      opacity: 0;
    }
  }

  @keyframes dialog-fade-out {
    from { opacity: 1; }
    to { opacity: 0; }
  }

  @keyframes backdrop-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes backdrop-fade-out {
    from { opacity: 1; }
    to { opacity: 0; }
  }

  @keyframes spin {
    from { transform: translate(-50%, -50%) rotate(0deg); }
    to { transform: translate(-50%, -50%) rotate(360deg); }
  }
`;

const placeholderStyles = `
  :host {
    display: contents;
  }

  dialog.spinner-dialog {
    min-width: 0;
    width: 3.25em;
    height: 3.25em;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .dialog-spinner {
    width: 2.2em;
    height: 2.2em;
    border: 3px solid color-mix(in srgb, currentColor 20%, transparent);
    border-top: 3px solid #444;
    border-radius: 50%;
    animation: spin-plain 1s linear infinite;
    box-sizing: border-box;
  }

  @keyframes spin-plain {
    to { transform: rotate(360deg); }
  }
`;

export const STYLE_TEXT = dialogStyles + placeholderStyles;
