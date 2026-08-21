// -------------------------------------------------------------------
// The single-toast custom element: its shadow-root stylesheet + markup, the dismiss
// event it emits, and lazy registration under the first free tag. Registration is lazy
// (and the element class is defined *inside* it) so importing this module never touches
// the DOM — keeping the library SSR-safe until a controller is created in a browser.
// -------------------------------------------------------------------

import { registerFirstFreeTag } from "../internal/custom-element.js";
import { toastIcons } from "./icons.js";
import type { ToastType } from "./types.js";

// Fired by the shadow-DOM close button and by swipe-to-dismiss; caught (composed +
// bubbling) on the container, which maps event.target (retargeted to the host) to an id.
export const DISMISS_EVENT = "internal-toast:dismiss";

const SHADOW_STYLES = `
:host {
  position: relative;
  box-sizing: border-box;
  /* --toast-scale (default 1) is the controller's \`size\` multiplier: width, padding,
     font-size and gap all scale by it, so the whole card grows/shrinks together. At the
     default 1 every value below computes to exactly the px/em written here. */
  width: min(calc(360px * var(--toast-scale, 1)), calc(100vw - 40px));
  padding: calc(14px * var(--toast-scale, 1)) calc(18px * var(--toast-scale, 1))
    calc(14px * var(--toast-scale, 1)) calc(22px * var(--toast-scale, 1));
  background: var(--background, #ffffff);
  color: var(--text, #111827);
  border-radius: var(--radius, 5px);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: calc(1em * var(--toast-scale, 1));
  line-height: 1.5;
  box-shadow: var(
    --shadow,
    0 10px 25px rgba(0, 0, 0, 0.08),
    0 2px 6px rgba(0, 0, 0, 0.05)
  );
  overflow: hidden;
  pointer-events: auto;
  transform: translateX(0);
  display: flex;
  align-items: center;
  gap: calc(12px * var(--toast-scale, 1));
  /* Size of the close/countdown affordance, and the single lever for it (see
     .close-wrap). */
  --affordance-size: 1.9em;
  /* Pin the card's minimum height to the affordance box plus the vertical padding, so a
     collapsed affordance can't shorten the card. Without this, a toast that is both
     sticky and non-dismissible — a loading toast, typically — drops .close-wrap out of
     this flex row entirely and ends up shorter than every other toast. */
  min-height: calc(var(--affordance-size) + 28px * var(--toast-scale, 1));
  /* Let vertical scroll pass through while we own horizontal swipe. */
  touch-action: pan-y;
}

.accent {
  position: absolute;
  inset-inline-start: 0.25em;
  top: 0.25em;
  bottom: 0.25em;
  width: 4px;
  border-radius: 2em;
  background: var(--info-accent, #2563eb);
}

:host([type="success"]) .accent {
  background: var(--success-accent, #16a34a);
}

:host([type="warn"]) .accent {
  background: var(--warn-accent, #d97706);
}

:host([type="error"]) .accent {
  background: var(--error-accent, #dc2626);
}

:host([type="loading"]) .accent {
  background: var(--loading-accent, #2563eb);
}

.icon {
  flex: none;
  display: none;
  align-items: center;
  justify-content: center;
  color: var(--icon-color, var(--info-accent, #2563eb));
}

:host([type="success"]) .icon {
  color: var(--icon-color, var(--success-accent, #16a34a));
}

:host([type="warn"]) .icon {
  color: var(--icon-color, var(--warn-accent, #d97706));
}

:host([type="error"]) .icon {
  color: var(--icon-color, var(--error-accent, #dc2626));
}

:host([type="loading"]) .icon {
  color: var(--icon-color, var(--loading-accent, #2563eb));
}

/* Built-in severity icon: shown only when the policy opts in and the caller
   didn't provide their own (loading always opts in). */
:host([icon-mode="default"]) .icon {
  display: inline-flex;
}

.icon svg {
  display: block;
  width: 1.4em;
  height: 1.4em;
}

/* The loading spinner rotates; everything else is static. */
:host([type="loading"]) .icon svg {
  animation: toast-spin 0.75s linear infinite;
}

@keyframes toast-spin {
  to {
    transform: rotate(360deg);
  }
}

/* Caller-supplied icon (light-DOM slot): sized to match the built-in, but not
   tinted — a custom icon keeps its own colors. */
.icon-slot {
  flex: none;
  display: none;
  align-items: center;
  justify-content: center;
}

:host([icon-mode="custom"]) .icon-slot {
  display: inline-flex;
}

::slotted([slot="icon"]) {
  display: block;
  width: 1.4em;
  height: 1.4em;
}

slot {
  display: contents;
}

.content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

::slotted([slot="title"]) {
  font-weight: 600;
  color: var(--title-color, #111827);
}

::slotted([slot="content"]) {
  color: var(--message-color, #374151);
}

/* Screen-reader-only severity prefix. Absolute so it never affects layout. */
::slotted([slot="severity"]) {
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

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: calc(16px * var(--toast-scale, 1));
  margin-top: calc(4px * var(--toast-scale, 1));
}

:host(:not([has-actions])) .actions {
  display: none;
}

/* The action buttons themselves are styled at the document level (see
   containerStyles) — ::slotted() is unreliable for native form controls. This
   element only lays them out via the slot above. */

.count {
  flex: none;
  align-self: center;
  font-size: 0.8em;
  font-weight: 600;
  opacity: 0.55;
  color: var(--message-color, #374151);
}

/* --affordance-size (on :host) is the one size lever here: the ring fills this box via
   inset: 0 and scales with it through its viewBox units, .close is sized in percentages
   of it, and :host derives its min-height from it so collapsing this box never changes
   the card's height. */
.close-wrap {
  flex: none;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--affordance-size);
  height: var(--affordance-size);
  /* Pulls the affordance toward the card edge. Was -0.4em when the box was 2.4em with a
     2em button inset inside it; -0.2em keeps the same optical gap now the button fills
     the box. */
  margin-inline-end: -0.2em;
}

/* Non-dismissible + nothing to count down: the whole affordance collapses. */
:host([dismissible="false"][duration="0"]) .close-wrap {
  display: none;
}

.progress-ring {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
  pointer-events: none;
  display: block;
}

.progress-ring__value {
  fill: none;
  stroke-width: 2.5;
  stroke-linecap: round;
  /* r is chosen so the circumference is exactly 100 user units, so the dash
     values read as a simple 0..100 "percent remaining". */
  stroke-dasharray: 100;
  stroke-dashoffset: 0;
  stroke: var(--progress-color, var(--info-accent, #2563eb));
  animation: toast-countdown var(--toast-duration, 7000ms) linear forwards;
  /* Driven to "paused" by the controller when the tab is hidden. */
  animation-play-state: var(--toast-play-state, running);
}

:host([type="success"]) .progress-ring__value {
  stroke: var(--progress-color, var(--success-accent, #16a34a));
}

:host([type="warn"]) .progress-ring__value {
  stroke: var(--progress-color, var(--warn-accent, #d97706));
}

:host([type="error"]) .progress-ring__value {
  stroke: var(--progress-color, var(--error-accent, #dc2626));
}

/* Freezes together with the JS auto-dismiss timer, which also pauses on hover.
   More specific than the var rule above, so hover always wins. */
:host(:hover) .progress-ring__value {
  animation-play-state: paused;
}

/* Sticky toasts (duration 0), incl. loading, have nothing to count down. */
:host([duration="0"]) .progress-ring {
  display: none;
}

/* Hide the button (but keep the ring) when the user can't dismiss. */
:host([dismissible="false"]) .close {
  display: none;
}

@keyframes toast-countdown {
  to {
    stroke-dashoffset: 100;
  }
}

.close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* Fills .close-wrap so that box stays the single size lever. */
  width: 100%;
  height: 100%;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--close-color, #9ca3af);
  cursor: pointer;
  border-radius: 50%;
  transition: color 150ms ease, background 150ms ease;
}

.close:hover {
  color: var(--close-hover-color, #374151);
  background: var(--close-hover-background, rgba(0, 0, 0, 0.06));
}

.close svg {
  display: block;
  width: 0.9em;
  height: 0.9em;
}

/* -------------------------------------------------------------------------
   Appearance variants (see ToastControllerOptions.appearance). Placed after the
   per-type rules above so they win on equal-specificity ties by source order.

   "solid": the whole card takes the severity accent as its background, with a
   light foreground (--solid-text, default white). Good for e.g. white-on-red
   errors.
   ------------------------------------------------------------------------- */
:host([appearance="solid"]) {
  background: var(--info-accent, #2563eb);
  color: var(--solid-text, #ffffff);
}

:host([appearance="solid"][type="success"]) {
  background: var(--success-accent, #16a34a);
}

:host([appearance="solid"][type="warn"]) {
  background: var(--warn-accent, #d97706);
}

:host([appearance="solid"][type="error"]) {
  background: var(--error-accent, #dc2626);
}

:host([appearance="solid"][type="loading"]) {
  background: var(--loading-accent, #2563eb);
}

/* The whole card is the accent now, so the little stripe is redundant. */
:host([appearance="solid"]) .accent {
  display: none;
}

:host([appearance="solid"]) .icon,
:host([appearance="solid"]) ::slotted([slot="title"]),
:host([appearance="solid"]) ::slotted([slot="content"]),
:host([appearance="solid"]) .count {
  color: var(--solid-text, #ffffff);
}

:host([appearance="solid"]) .close {
  color: var(--solid-text, #ffffff);
  opacity: 0.85;
}

:host([appearance="solid"]) .close:hover {
  color: var(--solid-text, #ffffff);
  opacity: 1;
  background: rgba(255, 255, 255, 0.18);
}

:host([appearance="solid"]) .progress-ring__value {
  stroke: var(--solid-text, #ffffff);
  opacity: 0.85;
}

/* "dark": a neutral dark card (--dark-background) with light text
   (--dark-text). Unlike "solid", the severity color is *kept* for the accent
   stripe, icon and countdown ring — so it reads as a dark-mode toast rather
   than a colored one. */
:host([appearance="dark"]) {
  background: var(--dark-background, #1f2937);
  color: var(--dark-text, #f9fafb);
}

:host([appearance="dark"]) ::slotted([slot="title"]),
:host([appearance="dark"]) ::slotted([slot="content"]),
:host([appearance="dark"]) .count {
  color: var(--dark-text, #f9fafb);
}

:host([appearance="dark"]) .close {
  color: var(--dark-close-color, #9ca3af);
}

:host([appearance="dark"]) .close:hover {
  color: var(--dark-text, #f9fafb);
  background: rgba(255, 255, 255, 0.1);
}

/* The 600-level accents go muddy against the dark card, so they're lifted toward white
   here. Mixing rather than hard-coding lighter hexes means a caller's own accent
   override gets the same lift instead of being silently ignored on this appearance.
   Resolved once per type into --dark-accent, then consumed by the three rules below. */
:host([appearance="dark"]) {
  --dark-accent: color-mix(in oklab, var(--info-accent, #2563eb) 65%, white);
}

:host([appearance="dark"][type="success"]) {
  --dark-accent: color-mix(in oklab, var(--success-accent, #16a34a) 65%, white);
}

:host([appearance="dark"][type="warn"]) {
  --dark-accent: color-mix(in oklab, var(--warn-accent, #d97706) 65%, white);
}

:host([appearance="dark"][type="error"]) {
  --dark-accent: color-mix(in oklab, var(--error-accent, #dc2626) 65%, white);
}

:host([appearance="dark"][type="loading"]) {
  --dark-accent: color-mix(in oklab, var(--loading-accent, #2563eb) 65%, white);
}

/* These tie on specificity with the per-type .accent / .icon / .progress-ring__value
   rules further up, so it's source order — being below them — that makes them win.
   Keep them after those rules. */
:host([appearance="dark"]) .accent {
  background: var(--dark-accent);
}

:host([appearance="dark"]) .icon {
  color: var(--icon-color, var(--dark-accent));
}

:host([appearance="dark"]) .progress-ring__value {
  stroke: var(--progress-color, var(--dark-accent));
}

@media (prefers-reduced-motion: reduce) {
  :host,
  .close {
    transition: none;
  }

  .progress-ring,
  :host([type="loading"]) .icon svg {
    animation: none;
  }
}
`;

const SHADOW_HTML = `
<style>${SHADOW_STYLES}</style>
<span class="accent"></span>
<span class="icon" aria-hidden="true"></span>
<span class="icon-slot" aria-hidden="true"><slot name="icon"></slot></span>
<div class="content">
  <slot name="severity"></slot>
  <slot name="title"></slot>
  <slot name="content"></slot>
  <div class="actions"><slot name="action"></slot></div>
</div>
<span class="count" aria-hidden="true"></span>
<div class="close-wrap">
  <svg class="progress-ring" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
    <circle class="progress-ring__value" cx="18" cy="18" r="15.9155"></circle>
  </svg>
  <button class="close" type="button">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false">
      <line x1="6" y1="6" x2="18" y2="18"></line>
      <line x1="18" y1="6" x2="6" y2="18"></line>
    </svg>
  </button>
</div>
`;

// Resolved lazily on first controller creation so importing this module never
// touches the DOM (SSR-safe) and the element class only references HTMLElement
// when actually running in a browser. Returns the plain tag string; adapters
// decide how to use it.
let tagCache: string | null = null;

export function ensureElementRegistered(): string {
  if (tagCache) {
    return tagCache;
  }

  class ToastElement extends HTMLElement {
    private button: HTMLButtonElement | null = null;
    private iconEl: HTMLElement | null = null;
    private ringEl: SVGElement | null = null;
    private countEl: HTMLElement | null = null;

    // Swipe state.
    private dragging = false;
    private dragStartX = 0;
    private dx = 0;
    private swipeDir: "left" | "right" | null = null;

    constructor() {
      super();
      const root = this.attachShadow({ mode: "open" });
      root.innerHTML = SHADOW_HTML;
      this.button = root.querySelector<HTMLButtonElement>("button.close");
      this.iconEl = root.querySelector<HTMLElement>(".icon");
      this.ringEl = root.querySelector<SVGElement>(".progress-ring__value");
      this.countEl = root.querySelector<HTMLElement>(".count");
      this.button?.addEventListener("click", () => this.emitDismiss());

      this.addEventListener("pointerdown", this.onPointerDown);
      this.addEventListener("pointermove", this.onPointerMove);
      this.addEventListener("pointerup", this.onPointerUp);
      this.addEventListener("pointercancel", this.onPointerUp);
    }

    private emitDismiss(): void {
      this.dispatchEvent(
        new CustomEvent(DISMISS_EVENT, { bubbles: true, composed: true }),
      );
    }

    static get observedAttributes(): string[] {
      return ["dismiss-label", "duration", "type", "count"];
    }

    attributeChangedCallback(
      name: string,
      _oldValue: string | null,
      value: string | null,
    ): void {
      if (name === "dismiss-label") {
        this.button?.setAttribute("aria-label", value ?? "");
      } else if (name === "duration") {
        // Feed the ring's animation-duration via a custom property. Kept off
        // the renderer's radar (attribute, not inline style) so it never
        // collides with the imperative slide transform written to the style.
        this.style.setProperty("--toast-duration", `${value ?? "0"}ms`);
        // A duration change on a persistent host (e.g. loading -> success via
        // update/promise) must restart the countdown from full, otherwise the
        // already-"finished" forwards animation leaves an empty ring.
        if (value && value !== "0" && this.ringEl) {
          this.ringEl.style.animation = "none";
          void this.ringEl.getBoundingClientRect();
          this.ringEl.style.animation = "";
        }
      } else if (name === "type" && this.iconEl) {
        // Swap in the severity icon. Decorative only (aria-hidden), since the
        // severity is already conveyed by role + the sr-only prefix.
        const icon = value
          ? toastIcons[value as ToastType]
          : undefined;
        this.iconEl.innerHTML = icon ?? "";
      } else if (name === "count" && this.countEl) {
        const n = Number(value);
        this.countEl.textContent = n > 1 ? `×${n}` : "";
      }
    }

    // --- swipe-to-dismiss ---------------------------------------------------
    // Only toward the anchored edge (matching the exit slide's direction, read
    // from the container's data-swipe). Buttons and non-dismissible hosts are
    // exempt. On release past threshold we just emit the dismiss event and let
    // the core run its normal slide-out from wherever the finger left off.

    private onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 && event.pointerType === "mouse") {
        return;
      }
      // A press on the close button (which lives in the shadow root) or a slotted action
      // button must not start a swipe — doing so captures the pointer and swallows the
      // button's click. For shadow-internal presses `event.target` is retargeted to the
      // host, so `event.target.closest("button")` misses the close button; consult the
      // composed path instead (pointer events are composed), which pierces the shadow root.
      if (
        event
          .composedPath()
          .some((node) => node instanceof HTMLElement && node.tagName === "BUTTON")
      ) {
        return;
      }
      if (this.getAttribute("dismissible") === "false") {
        return;
      }
      const dir = this.closest<HTMLElement>(".toasts-container")?.dataset
        .swipe;
      if (dir !== "left" && dir !== "right") {
        return;
      }
      this.swipeDir = dir;
      this.dragging = true;
      this.dx = 0;
      this.dragStartX = event.clientX;
      this.style.transition = "none";
      this.setPointerCapture(event.pointerId);
    };

    private onPointerMove = (event: PointerEvent): void => {
      if (!this.dragging) {
        return;
      }
      let dx = event.clientX - this.dragStartX;
      // Clamp to the anchored direction so an "away" drag doesn't pull it out.
      dx = this.swipeDir === "right" ? Math.max(0, dx) : Math.min(0, dx);
      this.dx = dx;
      const width = this.offsetWidth || 1;
      const progress = Math.min(1, Math.abs(dx) / width);
      this.style.transform = `translateX(${dx}px)`;
      this.style.opacity = String(1 - progress * 0.6);
    };

    private onPointerUp = (): void => {
      if (!this.dragging) {
        return;
      }
      this.dragging = false;
      const width = this.offsetWidth || 1;
      const threshold = Math.max(60, width * 0.3);
      if (Math.abs(this.dx) > threshold) {
        this.emitDismiss();
      } else {
        // Snap back.
        this.style.transition = "transform 200ms ease, opacity 200ms ease";
        this.style.transform = "";
        this.style.opacity = "";
      }
    };
  }

  const { tag } = registerFirstFreeTag(
    "internal-toast",
    ToastElement,
  );
  tagCache = tag;
  return tag;
}
