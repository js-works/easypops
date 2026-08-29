// -------------------------------------------------------------------
// Document-level chrome styles for the toast container and its slotted action
// buttons, injected once per document. (Per-toast shadow styles live in element.ts.)
// -------------------------------------------------------------------

import { css } from "../internal/css.js";


// Global chrome + anything targeting the slotted action buttons. Placement is
// applied as inline styles per controller (see applyPlacement); a single
// toast's own box lives in the custom element's shadow root (see
// SHADOW_STYLES). The action buttons are the exception: they're slotted
// light-DOM <button>s, and ::slotted() styling of native form controls is
// unreliable across engines, so we style them here in the document scope where
// they actually live — which cleanly overrides the UA button chrome. Theme
// tokens still resolve, since the buttons inherit the container's CSS vars.
const containerStyles = css`
.toasts-container {
  position: fixed;
  z-index: 10000;
  display: flex;
  /* Set by the controller from TOAST_GAP_PX, which also drives the offsets an expanding
     stack animates to — the two have to agree or the layouts disagree on where a card goes. */
  gap: var(--toast-gap, 8px);
  pointer-events: none;
}
/* Stacked layout, opt-in via the "stacked" option. Collapsed, every card occupies the
   same grid cell, so they overlap and the container keeps the height of one of them —
   absolute positioning would collapse it to nothing and take the hover target with it.
   Expanded, none of this applies and the ordinary flex column is back.

   Paint order is DOM order, and the newest host is the last child, so the newest card
   lands on top without any z-index. --stack-index (set by the controller) counts back
   from it; --stack-dir (set with the placement) flips the offset so the pile always grows
   away from the anchored edge. The offset stops growing after the third card: beyond that
   they are fully covered anyway, and letting them drift on would push the pile across the
   screen. */
/* Grid in BOTH states, never flex: the cards share one cell throughout and only their
   transform differs, so expanding is an animation rather than a relayout.

   Alignment is NOT set here. applyPlacement writes align-items inline for a flex column,
   which under grid names the other axis entirely, and an inline declaration outranks this
   rule — so the controller corrects both axes inline instead (see applyContainerOptions).
   The height is measured there too, since a one-cell grid cannot derive it. */
.toasts-container[data-stacked="on"] {
  display: grid;
  gap: 0;
  height: var(--stack-collapsed-height, auto);
  transition: height var(--stack-duration, 400ms) ease;
}

.toasts-container[data-stacked="on"][data-expanded="on"] {
  height: var(--stack-expanded-height, auto);
}

/* The offset rides on the independent "translate"/"scale" properties, NOT on transform.
   transform belongs to the controller: the enter slide writes an off-screen transform,
   forces a reflow to commit it, and only then enables its own transition (see playEnter).
   A stylesheet transition on transform would animate that first write too, so the toast
   would creep a few pixels instead of sliding in. Swipe-to-dismiss and the exit slide
   write transform inline for the same reason. The independent properties compose with it
   rather than replacing it, so both effects can run at once and neither has to know about
   the other. */
/* Both offsets are computed by the controller, which is the only place that knows how tall
   the cards actually are — a card behind a shorter one has to sit further back to clear it
   by the same sliver. transform-origin is the anchored edge, so shrinking a card pulls its
   trailing edge in without moving the edge it lines up on. */
.toasts-container[data-stacked="on"] > [data-id] {
  grid-area: 1 / 1;
  transform-origin: var(--stack-origin, bottom);
  translate: 0 calc(var(--stack-collapsed, 0px) * var(--stack-dir, -1));
  scale: var(--stack-scale, 1);
}

/* Expanded, a card steps back by the measured heights of everything in front of it, at
   full size — which is exactly where the flat list would have put it. */
.toasts-container[data-stacked="on"][data-expanded="on"] > [data-id] {
  translate: 0 calc(var(--stack-offset, 0px) * var(--stack-dir, -1));
  scale: 1;
}

/* --stack-duration is set by the controller: the slide's own 700ms when a toast arrives or
   leaves, so the pile settles in step with it rather than finishing first; a brisk 200ms
   when the user expands the stack by hand. Same easing as the slide, for the same reason. */
.toasts-container[data-stacked="on"] > [data-id] {
  transition:
    translate var(--stack-duration, 700ms) ease-in-out,
    scale var(--stack-duration, 700ms) ease-in-out;
}

@media (prefers-reduced-motion: reduce) {
  .toasts-container[data-stacked="on"] > [data-id] {
    transition: none;
  }
}

/* Expanded, the offset simply falls back to the initial values and transitions there. */

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
