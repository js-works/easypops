// -------------------------------------------------------------------
// The toasts controller: owns all state, timers, event delegation, the enter/exit
// and FLIP-shuffle animations, dedupe, overflow, and the loading->promise flow. It hands
// the bound adapter a fully-resolved list of ToastViews to project (see contract/view.ts).
// -------------------------------------------------------------------

import { toCssVariable } from "../internal/css.js";
import { DISMISS_EVENT, ensureElementRegistered } from "./element.js";
import { applyPlacement, splitPlacement } from "./placement.js";
import { injectContainerStyles } from "./styles.js";
import { defaultToastTheme } from "./contract/theme.js";
import { bundledToastText } from "../i18n/texts.js";
import { policyEnabled, roleFor } from "./contract/view.js";
import type {
  OverflowMode,
  Placement,
  ToastControllerOptions,
  ToastSize,
} from "./contract/options.js";
import type { ToastTexts } from "./contract/texts.js";
import type { ToastAppearance, ToastView } from "./contract/view.js";
import type {
  ToastAction,
  LoadingHandle,
  ToastHandle,
  ToastInput,
  ToastOptions,
  ToastController,
  ToastType,
  PromiseHandle,
  PromiseMessages,
} from "./contract/toast.js";

// Entering and leaving are not mirror images here, because they do not cover the same
// ground. A toast arrives by rising its own height and fading in — a short, calm move that
// works the same whether the toasts are stacked or listed. It leaves by travelling clear
// off the screen, which takes both longer and a direction: swipe-to-dismiss drags a card
// sideways and the exit has to carry on from where the finger let go (see the element's
// onPointerDown), so the way out stays horizontal.
// These are written inline, and an inline transition replaces the stylesheet's outright —
// so they have to name every property that was being transitioned there, or the ones they
// leave out stop animating for that toast from then on. translate/scale carry the stacked
// offset (see the container stylesheet); dropping them is what made settled cards jump
// while a new one slid in.
const ENTER_MS = 400;
// Shared with the FLIP shuffle in animateMovement: when a toast arrives, the ones already
// on screen move aside at the same moment, and any difference in curve or duration reads
// as them setting off at a different time.
const ENTER_EASING = "ease";
const ENTER_TRANSITION =
  `transform ${ENTER_MS}ms ${ENTER_EASING}, opacity ${ENTER_MS}ms ${ENTER_EASING},` +
  ` translate ${ENTER_MS}ms ${ENTER_EASING}, scale ${ENTER_MS}ms ${ENTER_EASING}`;
const EXIT_TRANSITION =
  "transform 700ms ease-in-out, translate 400ms ease, scale 400ms ease";
const EXIT_MS = 700;
const OFFSCREEN_DISTANCE = "120vw";
const OFFSCREEN_DISTANCE_V = "120vh";

// Re-stacking that accompanies an arriving toast travels with it, so it borrows the
// entrance's timing and the two read as one movement. Expanding the stack on hover or a tap
// is a direct answer to the user's own pointer and wants to be quicker still.
const STACK_SHUFFLE_MS = 400;
const STACK_TOGGLE_MS = 200;
// The one source of truth for the space between cards. The stylesheet reads it back as
// --toast-gap rather than repeating the number: the flat list's `gap` and the offsets an
// expanding stack animates to have to agree exactly, or the two layouts land in different
// places.
const TOAST_GAP_PX = 8;
// How much of each card behind the front one stays visible, and how much smaller it gets.
// Past STACK_MAX_DEPTH the cards are fully covered anyway, so they stop receding — letting
// them go on would march the pile across the screen.
const STACK_PEEK_PX = 10;
const STACK_SCALE_STEP = 0.05;
const STACK_MAX_DEPTH = 3;

// Cap-eviction exit: a quick fade in place (see remove()'s "fade" mode).
const FADE_TRANSITION = "opacity 500ms ease";
const FADE_MS = 500;

// Auto-dismiss default for a toast that doesn't specify its own `duration`. Loading
// toasts are the exception — they're created sticky (0) and get this when they settle.
const DEFAULT_DURATION_MS = 5000;

// The `size` option maps to a unitless multiplier the shadow `:host` scales its
// dimensions by. "medium" = 1, so the default leaves the card at its base dimensions.
const NOTIF_SCALES: Record<ToastSize, string> = {
  small: "0.875",
  medium: "1",
  large: "1.125",
};

interface Toast<C> {
  id: number;
  type: ToastType;
  title?: C | false;
  icon?: C | false;
  message: C;
  duration: number;
  removing: boolean;
  // While removing, which exit is playing. Slide victims must be excluded from
  // the FLIP shuffle (it would clobber their sideways transform); fade victims
  // must be included (opacity doesn't conflict with FLIP, and staying in the
  // shuffle keeps them gliding instead of snapping when the list reflows).
  exitMode: "slide" | "fade" | null;
  // Auto-dismiss timer state (supports pause-on-hover / pause-on-hidden).
  timer: number | null; // active setTimeout handle, or null while paused / none
  remaining: number; // ms left to run
  startedAt: number; // timestamp the current run began
  // Dedupe / actions / gating.
  key?: string;
  count: number; // >1 after dedupe collapse; shown as a ×N badge
  actions: ToastAction<C>[];
  dismissible: boolean;
  // Queue mode: created but held off-screen until a visible slot frees up.
  queued: boolean;
}

export function createToastController<C>(
  options: ToastControllerOptions<C>,
): ToastController<C> {
  // The adapter is fixed for the controller's life — it is bound to this container below,
  // and rebinding it would mean throwing the rendered stack away. Everything else is read
  // through `opts` at the point of use rather than captured here, so `configure()` can
  // replace it and the next toast simply reads what is current. Nothing on screen is
  // disturbed by that; container-level settings are re-applied in applyContainerOptions.
  const { adapter } = options;
  let opts: ToastControllerOptions<C> = options;

  // Icons are on by default (they were always shown before this option existed).
  const autoIcons = (): boolean | ToastType[] => opts.autoIcons ?? true;
  const placement = (): Placement => opts.placement ?? "bottom-end";
  const overflow = (): OverflowMode => opts.overflow ?? "evict";
  const dismissOnSwipe = (): boolean => opts.dismissOnSwipe ?? true;
  const pauseOnHidden = (): boolean => opts.pauseOnHidden ?? true;
  const liveRegion = (): boolean => opts.liveRegion ?? false;
  const size = (): ToastSize => opts.size ?? "medium";
  const autoTitles = (): boolean | ToastType[] | undefined => opts.autoTitles;
  const maxVisible = (): number | undefined => opts.maxVisible;
  const stacked = (): boolean => opts.stacked ?? false;

  // Resolve the appearance for a type: a single value applies to all; a
  // per-type map falls back to "light" for anything unlisted.
  function appearanceFor(type: ToastType): ToastAppearance {
    const option = opts.appearance ?? "light";
    return typeof option === "string" ? option : (option[type] ?? "light");
  }

  injectContainerStyles();
  const tag = ensureElementRegistered();

  // A caller's resolver still wins outright. Without one — or for a key it declines — the
  // bundled table for <html lang> answers, and English behind that.
  function text(key: keyof ToastTexts): string {
    return opts.getText?.(key) ?? bundledToastText(key);
  }

  const reducedMotionQuery =
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;

  function prefersReducedMotion(): boolean {
    return reducedMotionQuery?.matches ?? false;
  }

  const container = document.createElement("div");
  container.className = "toasts-container";

  // Persistent aria-live regions (opt-in). More reliable than announcing via a
  // freshly-inserted role="alert" host.
  let politeRegion: HTMLElement | null = null;
  let assertiveRegion: HTMLElement | null = null;

  function hiddenRegion(live: string, role: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "toasts-liveregion";
    el.setAttribute("aria-live", live);
    el.setAttribute("role", role);
    return el;
  }

  // Everything that lives on the container rather than on a toast. Split out (and called
  // again by configure) because these are exactly the settings that were previously baked
  // in at construction: the theme is re-merged over the defaults every time, so a token
  // that is dropped from the theme goes back to its default rather than lingering.
  function applyContainerOptions(): void {
    applyPlacement(container, placement());

    // Merge over the defaults and expose every entry as a CSS custom property on
    // the container. Variables inherit down to each host and pierce its shadow
    // root, so the theme is scoped per controller even though the element's
    // stylesheet lives in shadow DOM.
    const mergedTheme = { ...defaultToastTheme, ...opts.theme };
    for (const [key, value] of Object.entries(mergedTheme)) {
      if (value != null) container.style.setProperty(toCssVariable(key), value);
    }

    // Card scale: the shadow `:host` multiplies its width/padding/font-size/gap by this,
    // inherited through the shadow boundary like the theme tokens above.
    container.style.setProperty("--toast-scale", NOTIF_SCALES[size()]);

    // The stylesheet's `gap` reads this, so the flat list and the stack's expanded offsets
    // are driven by the same number instead of two that have to be kept in step by hand.
    container.style.setProperty("--toast-gap", `${TOAST_GAP_PX}px`);

    // Swipe-dismiss direction (physical, RTL-aware). Only meaningful once the container
    // is in the DOM, since it reads the resolved writing direction; the custom element
    // reads container.dataset.swipe.
    const { horizontal } = splitPlacement(placement());
    if (!dismissOnSwipe() || horizontal === "center") {
      container.dataset.swipe = "off";
    } else {
      const rtl = getComputedStyle(container).direction === "rtl";
      container.dataset.swipe = (horizontal === "end") !== rtl ? "right" : "left";
    }

    // Stacked layout, and which way the cards behind the newest peek out: away from the
    // anchored edge, so the pile always grows into the screen rather than off it.
    if (stacked()) {
      container.dataset.stacked = "on";
      const { vertical, horizontal } = splitPlacement(placement());
      container.style.setProperty("--stack-dir", vertical === "top" ? "1" : "-1");
      // applyPlacement just set alignItems inline for a flex column, where it means the
      // INLINE axis. Under grid the same property means the BLOCK axis, so that value
      // would push the cards to the bottom of the box — invisible while the box is one
      // card tall, glaring once expanding makes it tall. Overwritten here rather than in
      // the stylesheet, because an inline declaration is what has to be beaten.
      container.style.alignItems = vertical === "top" ? "start" : "end";
      container.style.justifyItems = horizontal;
      // Shrink toward the anchored edge, not the middle: that edge is where the cards line
      // up, so keeping it fixed is both what the pile should look like and what makes the
      // peek arithmetic in syncStackIndices tractable.
      container.style.setProperty(
        "--stack-origin",
        vertical === "top" ? "top" : "bottom",
      );
    } else {
      delete container.dataset.stacked;
      delete container.dataset.expanded;
      container.style.removeProperty("--stack-dir");
      // alignItems belongs to applyPlacement again; justifyItems is meaningless for flex.
      container.style.removeProperty("justify-items");
    }

    if (liveRegion() && !politeRegion) {
      politeRegion = hiddenRegion("polite", "status");
      assertiveRegion = hiddenRegion("assertive", "alert");
      container.append(politeRegion, assertiveRegion);
    } else if (!liveRegion() && politeRegion) {
      politeRegion.remove();
      assertiveRegion?.remove();
      politeRegion = null;
      assertiveRegion = null;
    }
  }

  document.body.appendChild(container);
  applyContainerOptions();

  // Bind the chosen adapter to this controller's container + element tag.
  const renderer = adapter({ container, tag });

  const toasts: Toast<C>[] = [];
  let nextId = 0;
  let destroyed = false;

  // Close-button clicks and swipes arrive here as a composed, bubbling event;
  // the event target is retargeted to the host element, so we read its data-id.
  container.addEventListener(DISMISS_EVENT, (event) => {
    const host = event.target as HTMLElement | null;
    if (!host) {
      return;
    }
    const id = Number(host.dataset.id);
    if (!Number.isNaN(id)) {
      remove(id);
    }
  });

  // Action-button clicks (light-DOM slotted buttons). Behaviour lives here,
  // keyed by the button's data-action-index — the adapter only renders labels.
  container.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      "[data-action-index]",
    );
    if (!button) {
      return;
    }
    const host = button.closest<HTMLElement>("[data-id]");
    if (!host) {
      return;
    }
    const id = Number(host.dataset.id);
    const index = Number(button.dataset.actionIndex);
    const toast = toasts.find((item) => item.id === id);
    const action = toast?.actions[index];
    if (!action) {
      return;
    }
    action.onClick?.();
    if (action.dismiss !== false) {
      remove(id);
    }
  });

  // Pause auto-dismiss while the pointer is over a toast; resume on
  // leave. Delegated on the container (mouseover/out bubble, unlike
  // enter/leave), so adapters needn't wire per-host listeners. pause/resume are
  // effectively idempotent, and a stray resume immediately followed by a pause
  // during intra-card movement recomputes ~0 elapsed, so the countdown doesn't
  // drift.
  container.addEventListener("mouseover", (event) => {
    const host = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      "[data-id]",
    );
    if (host) {
      pause(Number(host.dataset.id));
      setExpanded(true);
    }
  });

  container.addEventListener("mouseout", (event) => {
    const host = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      "[data-id]",
    );
    if (host) {
      resume(Number(host.dataset.id));
    }
  });

  // Collapsing is driven from the document, not from the cards' own mouseout, for two
  // reasons that pull in opposite directions. Expanding moves the cards, and one sliding
  // out from under a stationary pointer fires mouseout exactly as leaving does — acting on
  // that made the stack bounce open and shut. But asking only where the pointer was when
  // it left a card misses the other exit: through a gap, or through the part of the
  // container no card covers. From there the container's pointer-events: none means no
  // further event ever arrives, and the stack stays open. Watching the pointer itself
  // answers both — it is the position that matters, not what was left behind.
  //
  // Mouse only. Touch expands by tapping and collapses by tapping elsewhere; a finger
  // wandering off during a swipe-to-dismiss should not fold the stack mid-gesture.
  const onPointerMoveOutside = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse") {
      return;
    }
    if (pointerOverStack(event)) {
      window.clearTimeout(collapseTimer);
    } else {
      collapseSoon();
    }
  };

  function pointerOverStack(event: MouseEvent): boolean {
    const rect = container.getBoundingClientRect();
    return (
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    );
  }

  // --- stacked layout: expanding and collapsing ----------------------------
  //
  // Collapsing is deferred by a beat rather than done on the spot, because the gaps
  // between the cards belong to no toast: moving the pointer from one card to the next
  // leaves the stack for an instant and would otherwise make it snap shut and open again.
  // Sonner bridges those gaps with a generated ::after; that is not available here, since
  // a toast host owns a shadow root and generated content on a shadow host never renders.
  // A cancelled timeout does the same job without touching the layout.
  const COLLAPSE_DELAY_MS = 120;
  let collapseTimer: ReturnType<typeof setTimeout> | undefined;

  function setExpanded(expanded: boolean): void {
    window.clearTimeout(collapseTimer);
    if (!stacked()) {
      return;
    }
    container.style.setProperty("--stack-duration", `${STACK_TOGGLE_MS}ms`);
    if (expanded) {
      container.dataset.expanded = "on";
      // Only while it is open — an always-on pointermove listener for a stack nobody is
      // looking at would be a needless tax on every mouse move in the page.
      document.addEventListener("pointermove", onPointerMoveOutside);
    } else {
      delete container.dataset.expanded;
      document.removeEventListener("pointermove", onPointerMoveOutside);
    }
  }

  function collapseSoon(): void {
    window.clearTimeout(collapseTimer);
    collapseTimer = window.setTimeout(
      () => setExpanded(false),
      COLLAPSE_DELAY_MS,
    ) as unknown as ReturnType<typeof setTimeout>;
  }

  // Touch has no hover, so a tap on a card body opens the stack. That gesture is free:
  // the click handler above ignores anything that is not an action button, the close
  // button reports through its own event out of the shadow root, and a swipe never
  // starts on a button and is discarded below its threshold.
  //
  // A second tap deliberately does NOT collapse: by then the finger is usually on its way
  // to an action button, and folding the stack under it would be maddening. Tapping
  // outside is what closes it.
  container.addEventListener("click", (event) => {
    const host = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      "[data-id]",
    );
    if (host) {
      setExpanded(true);
    }
  });

  // Keyboard users reach the cards by tabbing; the stack has to be open for that to be
  // any use. focusout carries the element focus moves *to*, so leaving for something
  // outside the stack collapses it while moving between cards does not.
  container.addEventListener("focusin", () => setExpanded(true));
  container.addEventListener("focusout", (event) => {
    const next = event.relatedTarget as Node | null;
    if (!next || !container.contains(next)) {
      collapseSoon();
    }
  });

  const onPointerDownOutside = (event: PointerEvent): void => {
    const target = event.target as Node | null;
    if (!target || !container.contains(target)) {
      setExpanded(false);
    }
  };
  document.addEventListener("pointerdown", onPointerDownOutside);

  // Escape dismisses the most recent still-present, dismissible toast.
  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape") {
      return;
    }

    for (let i = toasts.length - 1; i >= 0; i--) {
      const toast = toasts[i];
      if (
        !toast.removing &&
        !toast.queued &&
        toast.dismissible
      ) {
        remove(toast.id);
        break;
      }
    }
  }
  document.addEventListener("keydown", onKeyDown);

  // Freeze timers + the CSS ring while the tab is backgrounded, so a
  // toast doesn't silently expire off-screen.
  function onVisibilityChange() {
    if (!pauseOnHidden()) {
      return;
    }
    if (document.hidden) {
      pauseAll();
      container.style.setProperty("--toast-play-state", "paused");
    } else {
      container.style.setProperty("--toast-play-state", "running");
      resumeAll();
    }
  }
  // Always listened for; the handler checks the current setting, so toggling
  // `pauseOnHidden` through configure() takes effect without re-binding anything.
  document.addEventListener("visibilitychange", onVisibilityChange);

  // Where a toast starts: one card-height outside its resting place, on the side the stack
  // is anchored to, so it rises into the corner it belongs to. No writing direction to
  // consult — the move is purely vertical.
  function enterTransform(): string {
    const { vertical } = splitPlacement(placement());
    return `translateY(${vertical === "top" ? "-" : ""}100%)`;
  }

  // Where a toast goes: clear of the viewport, toward the nearest edge, which for a corner
  // placement is the horizontal one a swipe would have thrown it at.
  function exitTransform(): string {
    const { vertical, horizontal } = splitPlacement(placement());
    if (horizontal === "center") {
      return `translateY(${vertical === "top" ? "-" : ""}${OFFSCREEN_DISTANCE_V})`;
    }
    const rtl = getComputedStyle(container).direction === "rtl";
    const toRight = (horizontal === "end") !== rtl;
    return `translateX(${toRight ? "" : "-"}${OFFSCREEN_DISTANCE})`;
  }

  function startTimer(toast: Toast<C>) {
    if (toast.duration <= 0 || toast.remaining <= 0) {
      return;
    }

    toast.startedAt = Date.now();
    toast.timer = window.setTimeout(() => {
      toast.timer = null;
      remove(toast.id);
    }, toast.remaining);
  }

  function pause(id: number) {
    const toast = toasts.find((item) => item.id === id);

    if (!toast || toast.timer === null) {
      return;
    }

    window.clearTimeout(toast.timer);
    toast.timer = null;
    toast.remaining = Math.max(
      0,
      toast.remaining - (Date.now() - toast.startedAt),
    );
  }

  function resume(id: number) {
    const toast = toasts.find((item) => item.id === id);

    if (
      !toast ||
      toast.removing ||
      toast.queued ||
      toast.timer !== null ||
      toast.duration <= 0
    ) {
      return;
    }

    startTimer(toast);
  }

  function pauseAll() {
    for (const toast of toasts) {
      pause(toast.id);
    }
  }

  function resumeAll() {
    // Won't override a hover pause: with a hidden tab there's no pointer, and
    // resume() is a no-op for anything already running.
    for (const toast of toasts) {
      resume(toast.id);
    }
  }

  function getPositions() {
    const positions = new Map<number, DOMRect>();

    container.querySelectorAll<HTMLElement>("[data-id]").forEach((element) => {
      positions.set(
        Number(element.dataset.id),
        element.getBoundingClientRect(),
      );
    });

    return positions;
  }

  function animateMovement(previous: Map<number, DOMRect>) {
    if (prefersReducedMotion()) {
      return;
    }

    // A stack never moves anything by layout — collapsed or expanded, every card sits in
    // the same grid cell and only its transform differs. So the only difference a rect can
    // show is that transform, which getBoundingClientRect includes: FLIP would animate a
    // movement the stylesheet is already animating, at its own duration, on top of it.
    if (stacked()) {
      return;
    }

    requestAnimationFrame(() => {
      container
        .querySelectorAll<HTMLElement>("[data-id]")
        .forEach((element) => {
          const id = Number(element.dataset.id);

          // Skip toasts that are sliding out: they're gliding off-screen
          // via their own transform, which a FLIP translateY here would stomp
          // on. Fade-exiting ones are deliberately NOT skipped — opacity doesn't
          // conflict with the shuffle, and keeping them in it makes them glide
          // to their new slot instead of snapping (the "jump" while fading).
          const toast = toasts.find((item) => item.id === id);
          if (toast?.removing && toast.exitMode === "slide") {
            return;
          }

          const oldPosition = previous.get(id);

          if (!oldPosition) {
            return;
          }

          const newPosition = element.getBoundingClientRect();
          const deltaY = oldPosition.top - newPosition.top;

          if (deltaY !== 0) {
            element.animate(
              [
                { transform: `translateY(${deltaY}px)` },
                { transform: "translateY(0)" },
              ],
              // Same duration and curve as the arriving toast's own slide. The two happen
              // at once and are read as one movement, so a different easing here — the
              // former ease-in-out, which also brakes at the start — made the settled
              // toasts look like they set off late.
              {
                duration: ENTER_MS,
                easing: ENTER_EASING,
              },
            );
          }
        });
    });
  }

  // Resolve a toast into the fully-computed view model the adapter
  // renders. All policy (title fallback, severity prefix, icon mode) lives here
  // so adapters stay dumb.
  function toView(toast: Toast<C>): ToastView<C> {
    // A visible default heading (the severity word) is shown only when the
    // caller omitted the title AND the controller policy opts this type in.
    const defaultTitleShown =
      toast.title === undefined &&
      policyEnabled(autoTitles(), toast.type);

    // Resolve the heading: `false` -> none; omitted -> policy default or none;
    // otherwise the caller's value.
    let title: C | null;
    if (toast.title === false) {
      title = null;
    } else if (toast.title === undefined) {
      title = defaultTitleShown
        ? (text(toast.type) as unknown as C)
        : null;
    } else {
      title = toast.title;
    }

    // The hidden severity prefix is redundant only when a visible default
    // heading already states the severity. Punctuation is composed here so
    // every adapter renders the same string.
    const severity = defaultTitleShown ? null : `${text(toast.type)}: `;

    // Resolve the icon into one of three modes:
    // - "custom": caller supplied one -> slot it (light DOM).
    // - "default": omitted + policy opts in (or loading) -> shadow built-in.
    // - "none": `false`, or omitted with the policy off.
    const customIcon =
      toast.icon !== undefined && toast.icon !== false
        ? toast.icon
        : null;
    let iconMode: ToastView<C>["iconMode"];
    if (customIcon !== null) {
      iconMode = "custom";
    } else if (
      toast.type === "loading" ||
      (toast.icon === undefined &&
        policyEnabled(autoIcons(), toast.type))
    ) {
      // The spinner IS the loading affordance, so it ignores the icon policy.
      iconMode = toast.icon === false ? "none" : "default";
    } else {
      iconMode = "none";
    }

    return {
      id: toast.id,
      type: toast.type,
      role: liveRegion() ? "none" : roleFor(toast.type),
      duration: toast.duration,
      dismissLabel: text("dismiss"),
      iconMode,
      icon: customIcon,
      severity,
      title,
      message: toast.message,
      actions: toast.actions.map((action) => ({ label: action.label })),
      dismissible: toast.dismissible,
      count: toast.count,
      appearance: appearanceFor(toast.type),
    };
  }

  function update(previous?: Map<number, DOMRect>) {
    // Queued toasts exist in state but aren't rendered yet.
    renderer.render(toasts.filter((item) => !item.queued).map(toView));
    syncStackIndices();

    if (previous) {
      animateMovement(previous);
    }
  }

  // Both stacked states are transforms off a single shared grid cell: the collapsed one
  // from a card's depth in the pile, the expanded one from the real heights of the cards
  // in front of it. Laying the expanded state out for real (a flex column) and only the
  // collapsed one by transform would put a layout change between the two — and layout
  // changes do not animate, so expanding would snap open. Measuring costs a reflow here,
  // which playEnter is about to force anyway.
  //
  // The newest host is the last child, so both the depth and the running offset count back
  // from the end.
  function syncStackIndices(): void {
    if (!stacked()) {
      return;
    }
    // A toast is arriving or leaving, so the re-stack travels alongside its slide.
    container.style.setProperty("--stack-duration", `${STACK_SHUFFLE_MS}ms`);

    const hosts = Array.from(
      container.querySelectorAll<HTMLElement>(':scope > [data-id]'),
    );
    const newest = hosts.length - 1;
    const frontHeight = hosts[newest]?.offsetHeight ?? 0;
    let offset = 0;

    for (let position = newest; position >= 0; position--) {
      const host = hosts[position];
      const depth = Math.min(newest - position, STACK_MAX_DEPTH);
      const scale = 1 - depth * STACK_SCALE_STEP;

      // The collapsed offset is derived, not a fixed step per depth: what should be
      // constant is how far a card's trailing edge clears the front card's — 14px, no
      // matter how tall the card itself is. A fixed step assumes every toast is the same
      // height, and a short one in front (a loading toast, say) then lets the taller card
      // behind it show far more than a sliver. Height times scale is the visual extent,
      // since transform-origin sits on the anchored edge.
      const peek = frontHeight + depth * STACK_PEEK_PX - host.offsetHeight * scale;

      host.style.setProperty("--stack-index", String(newest - position));
      host.style.setProperty("--stack-scale", String(scale));
      host.style.setProperty("--stack-collapsed", `${Math.max(0, peek)}px`);
      host.style.setProperty("--stack-offset", `${offset}px`);
      offset += host.offsetHeight + TOAST_GAP_PX;
    }

    // The container carries its own height, because its children all share one cell and it
    // would otherwise stay one card tall — the expanded pile would then hang outside the
    // area the pointer has to stay in to keep it open.
    const collapsed = hosts[newest]?.offsetHeight ?? 0;
    container.style.setProperty("--stack-collapsed-height", `${collapsed}px`);
    container.style.setProperty(
      "--stack-expanded-height",
      `${Math.max(collapsed, offset - TOAST_GAP_PX)}px`,
    );
  }

  // Compose the announcement from what's actually on screen (works for any
  // content type, since we read the rendered light-DOM text).
  function announce(toast: Toast<C>) {
    if (!liveRegion()) {
      return;
    }
    const host = container.querySelector<HTMLElement>(
      `[data-id="${toast.id}"]`,
    );
    const titleText =
      host?.querySelector('[slot="title"]')?.textContent?.trim() ?? "";
    const messageText =
      host?.querySelector('[slot="content"]')?.textContent?.trim() ?? "";
    const message = [text(toast.type), titleText, messageText]
      .filter(Boolean)
      .join(" ");

    const region =
      roleFor(toast.type) === "alert" ? assertiveRegion : politeRegion;
    if (!region) {
      return;
    }
    // Clear then set on the next frame so repeated identical text still fires.
    region.textContent = "";
    requestAnimationFrame(() => {
      region.textContent = message;
    });
  }

  // Play the enter slide for a freshly-rendered host.
  function playEnter(toast: Toast<C>) {
    const element = container.querySelector<HTMLElement>(
      `[data-id="${toast.id}"]`,
    );

    if (element && !prefersReducedMotion()) {
      element.style.transform = enterTransform();
      element.style.opacity = "0";

      // Force the browser to commit the start position before the transition is
      // enabled. Without this reflow the two style writes collapse into a single
      // computed change and the toast pops in instead of sliding.
      void element.offsetWidth;

      element.style.transition = ENTER_TRANSITION;
      element.style.transform = "";
      element.style.opacity = "";

      // Hand the toast back to the stylesheet once it has arrived. Its inline transition
      // is fixed at the entrance timing, while the stylesheet's is driven by
      // --stack-duration and switches between the shuffle and the quicker hover expand —
      // which it cannot do as long as an inline declaration outranks it.
      window.setTimeout(() => {
        element.style.transition = "";
      }, ENTER_MS);
    }
  }

  // `mode` picks the exit animation:
  // - "slide" (default): timer/click/swipe dismissals glide off-screen.
  // - "fade": cap-evictions dissolve quickly in place. A fade is layout-neutral
  //   (opacity only), so simultaneous evictions can't clobber one another the
  //   way concurrent sideways slides would, and by the time the slot collapses
  //   the element is already invisible — no blink, no jump.
  function remove(id: number, mode: "slide" | "fade" = "slide") {
    const toast = toasts.find((item) => item.id === id);

    if (!toast || toast.removing) {
      return;
    }

    // A queued toast isn't on screen: just drop it, no animation.
    if (toast.queued) {
      const index = toasts.findIndex((item) => item.id === id);
      if (index !== -1) {
        toasts.splice(index, 1);
      }
      return;
    }

    toast.removing = true;
    toast.exitMode = mode;

    if (toast.timer !== null) {
      window.clearTimeout(toast.timer);
      toast.timer = null;
    }

    const drop = () => {
      const index = toasts.findIndex((item) => item.id === id);

      if (index === -1) {
        return;
      }

      const previous = getPositions();

      toasts.splice(index, 1);
      update(previous);
      promoteQueued();
    };

    const element = container.querySelector<HTMLElement>(`[data-id="${id}"]`);

    // No node to animate, or the user prefers reduced motion: drop immediately.
    if (!element || prefersReducedMotion()) {
      drop();
      return;
    }

    if (mode === "fade") {
      element.style.transition = FADE_TRANSITION;

      requestAnimationFrame(() => {
        element.style.opacity = "0";
      });

      window.setTimeout(drop, FADE_MS);
      return;
    }

    // The at-rest translateX(0) has already been painted in previous frames, so
    // enabling the transition and then flipping the transform in the next frame
    // animates cleanly.
    element.style.transition = EXIT_TRANSITION;

    requestAnimationFrame(() => {
      element.style.transform = exitTransform();
    });

    window.setTimeout(drop, EXIT_MS);
  }

  function visibleCount(): number {
    return toasts.filter((item) => !item.removing && !item.queued)
      .length;
  }

  // Evict mode: trim the oldest visible toasts past the cap (fade exit).
  function enforceCap() {
    const cap = maxVisible();
    if (!cap || cap <= 0) {
      return;
    }

    const active = toasts.filter(
      (item) => !item.removing && !item.queued,
    );
    const excess = active.length - cap;

    // Oldest first (array order == insertion order). Cap-evictions fade rather
    // than slide — a displaced toast quietly yields its space.
    for (let i = 0; i < excess; i++) {
      remove(active[i].id, "fade");
    }
  }

  // Queue mode: when a slot frees up, promote the oldest waiting toast.
  // Promotes at most one queued toast, and says whether it did. One is the right unit for
  // the usual caller — a toast left, so a slot opened — while configure(), which can free
  // several slots at once by raising the cap, loops until this comes back false.
  function promoteQueued(): boolean {
    const cap = maxVisible();
    if (overflow() !== "queue" || !cap || cap <= 0) {
      return false;
    }
    if (visibleCount() >= cap) {
      return false;
    }
    const next = toasts.find((item) => item.queued);
    if (!next) {
      return false;
    }

    const previous = getPositions();
    next.queued = false;
    update(previous);
    playEnter(next);
    startTimer(next);
    announce(next);
    return true;
  }

  function toOptions(input: ToastInput<C>): ToastOptions<C> {
    // String shorthand: every adapter's content type includes plain strings.
    return typeof input === "string"
      ? ({ message: input } as unknown as ToastOptions<C>)
      : input;
  }

  function handleFor(id: number): ToastHandle<C> {
    return {
      id,
      dismiss: () => remove(id),
      update: (opts) => patch(id, opts),
    };
  }

  // Settle a pending loading toast into its terminal type, in place. The duration has to
  // be restored explicitly because loading toasts are created sticky (0).
  //
  // `opts.duration ?? DEFAULT_DURATION_MS` rather than letting spread order decide: an
  // input carrying an explicit `duration: undefined` would otherwise overwrite the
  // default, and patch() skips undefined — stranding the settled toast at 0.
  function settle(
    id: number,
    type: "success" | "error",
    input: ToastInput<C>,
  ): void {
    const opts = toOptions(input);
    patch(id, {
      ...opts,
      type,
      duration: opts.duration ?? DEFAULT_DURATION_MS,
    });
  }

  function loadingHandleFor(id: number): LoadingHandle<C> {
    return {
      ...handleFor(id),
      success: (input) => settle(id, "success", input),
      error: (input) => settle(id, "error", input),
    };
  }

  // Local, not `this.loading`, so promise() below can reuse it without depending on the
  // returned object's `this` (which a destructured `const { promise } = toasts` loses).
  function loadingToast(input: ToastInput<C>): LoadingHandle<C> {
    // duration 0 makes it sticky; a duration in the caller's own options still wins.
    return loadingHandleFor(add("loading", { duration: 0, ...toOptions(input) }).id);
  }

  // Patch a live toast in place. `type` stays off ToastOptions, so handle.update() can
  // never change it; the only public route is settle() via a LoadingHandle, plus dedupe
  // folding a repeat into an existing toast.
  function patch(
    id: number,
    changes: Partial<ToastOptions<C>> & { type?: ToastType },
  ) {
    if (destroyed) {
      return;
    }
    const toast = toasts.find((item) => item.id === id);
    if (!toast || toast.removing) {
      return;
    }

    if (changes.type !== undefined) toast.type = changes.type;
    if (changes.title !== undefined) toast.title = changes.title;
    if (changes.icon !== undefined) toast.icon = changes.icon;
    if (changes.message !== undefined) toast.message = changes.message;
    if (changes.actions !== undefined) toast.actions = changes.actions;
    if (changes.dismissible !== undefined)
      toast.dismissible = changes.dismissible;
    if (changes.key !== undefined) toast.key = changes.key;

    if (changes.duration !== undefined) {
      toast.duration = changes.duration;
      toast.remaining = changes.duration;
      if (toast.timer !== null) {
        window.clearTimeout(toast.timer);
        toast.timer = null;
      }
      if (!toast.queued) {
        startTimer(toast);
      }
    }

    if (!toast.queued) {
      update();
      announce(toast);
    }
  }

  function add(
    type: ToastType,
    input: ToastInput<C>,
  ): ToastHandle<C> {
    if (destroyed) {
      return { id: -1, dismiss() {}, update() {} };
    }

    const opts = toOptions(input);

    // Dedupe: fold a repeat with the same key into the existing toast.
    if (opts.key) {
      const existing = toasts.find(
        (item) => item.key === opts.key && !item.removing,
      );
      if (existing) {
        existing.count += 1;
        patch(existing.id, {
          type,
          title: opts.title,
          icon: opts.icon,
          message: opts.message,
          actions: opts.actions,
          dismissible: opts.dismissible,
          duration: opts.duration ?? existing.duration,
        });
        return handleFor(existing.id);
      }
    }

    const previous = getPositions();
    const duration =
      opts.duration ?? (type === "loading" ? 0 : DEFAULT_DURATION_MS);

    const toast: Toast<C> = {
      id: nextId++,
      type,
      title: opts.title,
      icon: opts.icon,
      message: opts.message,
      duration,
      removing: false,
      exitMode: null,
      timer: null,
      remaining: duration,
      startedAt: 0,
      key: opts.key,
      count: 1,
      actions: opts.actions ?? [],
      dismissible: opts.dismissible ?? true,
      queued: false,
    };

    toasts.push(toast);

    // Queue mode: hold this one off-screen if we're already at the cap.
    if (
      overflow() === "queue" &&
      maxVisible() &&
      maxVisible()! > 0 &&
      visibleCount() > maxVisible()!
    ) {
      toast.queued = true;
      return handleFor(toast.id);
    }

    update(previous);
    playEnter(toast);
    startTimer(toast);
    announce(toast);

    // Evict mode handles the cap here; queue mode already gated above.
    if (overflow() === "evict") {
      enforceCap();
    }

    return handleFor(toast.id);
  }

  return {
    info(input: ToastInput<C>) {
      return add("info", input);
    },
    success(input: ToastInput<C>) {
      return add("success", input);
    },
    warn(input: ToastInput<C>) {
      return add("warn", input);
    },
    error(input: ToastInput<C>) {
      return add("error", input);
    },
    loading(input: ToastInput<C>): LoadingHandle<C> {
      return loadingToast(input);
    },
    promise<T>(
      promise: Promise<T>,
      messages: PromiseMessages<C, T>,
    ): PromiseHandle<C, T> {
      const handle = loadingToast(messages.loading);

      // The settled phases accept either content or a function of the settled value.
      const inputFor = (
        resolver: PromiseMessages<C, T>["success" | "error"],
        value: unknown,
      ): ToastInput<C> =>
        typeof resolver === "function"
          ? (resolver as (v: unknown) => ToastInput<C>)(value)
          : resolver;

      const result = Promise.resolve(promise).then(
        (value) => {
          handle.success(inputFor(messages.success, value));
          return value;
        },
        (error) => {
          handle.error(inputFor(messages.error, error));
          throw error;
        },
      );

      return Object.assign(handle, { result });
    },
    configure(next: Omit<ToastControllerOptions<C>, "adapter">) {
      // A wholesale replacement, not a merge: a field left out goes back to its default,
      // so the object handed in is always the complete truth about this controller. That
      // is what lets a caller — or a React provider pushing its current config — hand it
      // over without having to work out what changed.
      opts = { ...next, adapter } as ToastControllerOptions<C>;
      applyContainerOptions();
      // The per-toast settings (icons, titles, appearance, texts) are read at render
      // time, so re-rendering is all it takes for the stack already on screen to pick
      // them up. A tightened `maxVisible` is enforced the way it is on arrival.
      enforceCap();
      while (promoteQueued()) {
        // Raising the cap can free several slots at once.
      }
      update();
    },

    clear() {
      for (const toast of toasts) {
        if (toast.timer !== null) {
          window.clearTimeout(toast.timer);
          toast.timer = null;
        }
      }

      toasts.length = 0;
      update();
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;

      for (const toast of toasts) {
        if (toast.timer !== null) {
          window.clearTimeout(toast.timer);
          toast.timer = null;
        }
      }
      toasts.length = 0;

      window.clearTimeout(collapseTimer);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("pointerdown", onPointerDownOutside);
      document.removeEventListener("pointermove", onPointerMoveOutside);

      renderer.destroy?.();
      container.remove();
    },
  };
}
