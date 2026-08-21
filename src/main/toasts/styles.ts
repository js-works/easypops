// -------------------------------------------------------------------
// Document-level chrome styles for the toast container and its slotted action
// buttons, injected once per document. (Per-toast shadow styles live in element.ts.)
// -------------------------------------------------------------------


// Global chrome + anything targeting the slotted action buttons. Placement is
// applied as inline styles per controller (see applyPlacement); a single
// toast's own box lives in the custom element's shadow root (see
// SHADOW_STYLES). The action buttons are the exception: they're slotted
// light-DOM <button>s, and ::slotted() styling of native form controls is
// unreliable across engines, so we style them here in the document scope where
// they actually live — which cleanly overrides the UA button chrome. Theme
// tokens still resolve, since the buttons inherit the container's CSS vars.
const containerStyles = `
.toasts-container {
  position: fixed;
  z-index: 10000;
  display: flex;
  gap: 12px;
  pointer-events: none;
}
.toasts-liveregion {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Action buttons rendered as inline text links (not filled buttons).

   These are light-DOM buttons, so the host app's own global button styles
   (design-system resets, bare element rules, Tailwind/Bootstrap base layers)
   land on them too. To reliably out-rank that without !important, every rule
   here carries the extra [data-id] (raising specificity to (0,3,1)) and the
   base rule performs a FULL reset of the properties frameworks typically set —
   not just border/background — so a stray app declaration can't re-boxify the
   link. If your app forces button styles with !important, override via the
   --action-color token or add your own higher-specificity rule. */
.toasts-container [data-id] button[slot="action"] {
  appearance: none;
  -webkit-appearance: none;
  box-sizing: border-box;
  display: inline;
  width: auto;
  min-width: 0;
  height: auto;
  min-height: 0;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 2px;
  background: none;
  box-shadow: none;
  font: inherit;
  font-size: 0.9em;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: normal;
  text-transform: none;
  text-align: inherit;
  text-decoration: none;
  vertical-align: baseline;
  color: var(--action-color, var(--info-accent, #2563eb));
  cursor: pointer;
  transition: opacity 150ms ease;
}

.toasts-container [data-id][type="success"] button[slot="action"] {
  color: var(--action-color, var(--success-accent, #16a34a));
}

.toasts-container [data-id][type="warn"] button[slot="action"] {
  color: var(--action-color, var(--warn-accent, #d97706));
}

.toasts-container [data-id][type="error"] button[slot="action"] {
  color: var(--action-color, var(--error-accent, #dc2626));
}

.toasts-container [data-id][type="loading"] button[slot="action"] {
  color: var(--action-color, var(--loading-accent, #2563eb));
}

/* Hover feedback is a subtle dim rather than an underline: these actions sit in
   their own row (not inline in prose), where semibold accent text already reads
   as actionable, so the underline convention isn't needed and reads dated. */
.toasts-container [data-id] button[slot="action"]:hover {
  opacity: 0.75;
  background: none;
}

.toasts-container [data-id] button[slot="action"]:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}

/* Solid appearance: light links on the accent-colored card (same dim-on-hover). */
.toasts-container [data-id][appearance="solid"] button[slot="action"] {
  color: var(--solid-text, #ffffff);
}

/* Dark appearance: reuse the same lightened accent the stripe, icon and countdown ring
   use, since the 600-level accents are hard to read on the dark card. --dark-accent is
   set on the host by the shadow stylesheet (see element.ts) and inherits down to these
   slotted buttons, so the two stay in step automatically. Placed after the per-type
   rules above, which it ties with on specificity. */
.toasts-container [data-id][appearance="dark"] button[slot="action"] {
  color: var(--action-color, var(--dark-accent));
}

@media (prefers-reduced-motion: reduce) {
  .toasts-container [data-id] button[slot="action"] {
    transition: none;
  }
}
`;

export function injectContainerStyles() {
  if (document.getElementById("toasts-styles")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "toasts-styles";
  style.textContent = containerStyles;
  document.head.appendChild(style);
}
