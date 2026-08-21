// -------------------------------------------------------------------
// The toasts controller: owns all state, timers, event delegation, the enter/exit
// and FLIP-shuffle animations, dedupe, overflow, and the loading->promise flow. It hands
// the bound adapter a fully-resolved list of ToastViews to project (see view.ts).
// -------------------------------------------------------------------

import { toCssVariable } from "../internal/css.js";
import { DISMISS_EVENT, ensureElementRegistered } from "./element.js";
import { applyPlacement, splitPlacement } from "./placement.js";
import { injectContainerStyles } from "./styles.js";
import { defaultToastTheme } from "./theme.js";
import { defaultToastTexts } from "./texts.js";
import { policyEnabled, roleFor } from "./view.js";
import type { ToastSize, ToastControllerOptions } from "./options.js";
import type { ToastTexts } from "./texts.js";
import type { ToastAppearance, ToastView } from "./view.js";
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
} from "./types.js";

const ENTER_EXIT_TRANSITION = "transform 700ms ease-in-out";
const OFFSCREEN_DISTANCE = "120vw";
const OFFSCREEN_DISTANCE_V = "120vh";
const EXIT_MS = 700;

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
  const { adapter, theme, getText, autoTitles, maxVisible } = options;
  // Icons are on by default (they were always shown before this option existed).
  const autoIcons = options.autoIcons ?? true;
  const placement = options.placement ?? "bottom-end";
  const overflow = options.overflow ?? "evict";
  const dismissOnSwipe = options.dismissOnSwipe ?? true;
  const pauseOnHidden = options.pauseOnHidden ?? true;
  const liveRegion = options.liveRegion ?? false;
  const appearanceOption = options.appearance ?? "light";
  const size = options.size ?? "medium";

  // Resolve the appearance for a type: a single value applies to all; a
  // per-type map falls back to "light" for anything unlisted.
  function appearanceFor(type: ToastType): ToastAppearance {
    return typeof appearanceOption === "string"
      ? appearanceOption
      : (appearanceOption[type] ?? "light");
  }

  injectContainerStyles();
  const tag = ensureElementRegistered();

  function text(key: keyof ToastTexts): string {
    return getText?.(key) ?? defaultToastTexts[key];
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
  applyPlacement(container, placement);

  // Merge over the defaults and expose every entry as a CSS custom property on
  // the container. Variables inherit down to each host and pierce its shadow
  // root, so the theme is scoped per controller even though the element's
  // stylesheet lives in shadow DOM.
  const mergedTheme = { ...defaultToastTheme, ...theme };
  for (const [key, value] of Object.entries(mergedTheme)) {
    if (value != null) container.style.setProperty(toCssVariable(key), value);
  }

  // Card scale: the shadow `:host` multiplies its width/padding/font-size/gap by this,
  // inherited through the shadow boundary like the theme tokens above.
  container.style.setProperty("--toast-scale", NOTIF_SCALES[size]);

  document.body.appendChild(container);

  // Resolve the swipe-dismiss direction (physical, RTL-aware) once the
  // container is in the DOM. The custom element reads container.dataset.swipe.
  (function computeSwipeData() {
    const { horizontal } = splitPlacement(placement);
    if (!dismissOnSwipe || horizontal === "center") {
      container.dataset.swipe = "off";
      return;
    }
    const rtl = getComputedStyle(container).direction === "rtl";
    const toRight = (horizontal === "end") !== rtl;
    container.dataset.swipe = toRight ? "right" : "left";
  })();

  // Persistent aria-live regions (opt-in). More reliable than announcing via a
  // freshly-inserted role="alert" host.
  let politeRegion: HTMLElement | null = null;
  let assertiveRegion: HTMLElement | null = null;
  if (liveRegion) {
    politeRegion = document.createElement("div");
    politeRegion.className = "toasts-liveregion";
    politeRegion.setAttribute("aria-live", "polite");
    politeRegion.setAttribute("role", "status");

    assertiveRegion = document.createElement("div");
    assertiveRegion.className = "toasts-liveregion";
    assertiveRegion.setAttribute("aria-live", "assertive");
    assertiveRegion.setAttribute("role", "alert");

    container.append(politeRegion, assertiveRegion);
  }

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
    if (document.hidden) {
      pauseAll();
      container.style.setProperty("--toast-play-state", "paused");
    } else {
      container.style.setProperty("--toast-play-state", "running");
      resumeAll();
    }
  }
  if (pauseOnHidden) {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  function offscreenTransform(): string {
    const { vertical, horizontal } = splitPlacement(placement);
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
              {
                duration: 400,
                easing: "ease-in-out",
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
      policyEnabled(autoTitles, toast.type);

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
        policyEnabled(autoIcons, toast.type))
    ) {
      // The spinner IS the loading affordance, so it ignores the icon policy.
      iconMode = toast.icon === false ? "none" : "default";
    } else {
      iconMode = "none";
    }

    return {
      id: toast.id,
      type: toast.type,
      role: liveRegion ? "none" : roleFor(toast.type),
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

    if (previous) {
      animateMovement(previous);
    }
  }

  // Compose the announcement from what's actually on screen (works for any
  // content type, since we read the rendered light-DOM text).
  function announce(toast: Toast<C>) {
    if (!liveRegion) {
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
      element.style.transform = offscreenTransform();

      // Force the browser to commit the off-screen start position before the
      // transition is enabled. Without this reflow the two style writes collapse
      // into a single computed change and the toast pops in instead of
      // sliding.
      void element.offsetWidth;

      element.style.transition = ENTER_EXIT_TRANSITION;
      element.style.transform = "";
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
    element.style.transition = ENTER_EXIT_TRANSITION;

    requestAnimationFrame(() => {
      element.style.transform = offscreenTransform();
    });

    window.setTimeout(drop, EXIT_MS);
  }

  function visibleCount(): number {
    return toasts.filter((item) => !item.removing && !item.queued)
      .length;
  }

  // Evict mode: trim the oldest visible toasts past the cap (fade exit).
  function enforceCap() {
    if (!maxVisible || maxVisible <= 0) {
      return;
    }

    const active = toasts.filter(
      (item) => !item.removing && !item.queued,
    );
    const excess = active.length - maxVisible;

    // Oldest first (array order == insertion order). Cap-evictions fade rather
    // than slide — a displaced toast quietly yields its space.
    for (let i = 0; i < excess; i++) {
      remove(active[i].id, "fade");
    }
  }

  // Queue mode: when a slot frees up, promote the oldest waiting toast.
  function promoteQueued() {
    if (overflow !== "queue" || !maxVisible || maxVisible <= 0) {
      return;
    }
    if (visibleCount() >= maxVisible) {
      return;
    }
    const next = toasts.find((item) => item.queued);
    if (!next) {
      return;
    }

    const previous = getPositions();
    next.queued = false;
    update(previous);
    playEnter(next);
    startTimer(next);
    announce(next);
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
      overflow === "queue" &&
      maxVisible &&
      maxVisible > 0 &&
      visibleCount() > maxVisible
    ) {
      toast.queued = true;
      return handleFor(toast.id);
    }

    update(previous);
    playEnter(toast);
    startTimer(toast);
    announce(toast);

    // Evict mode handles the cap here; queue mode already gated above.
    if (overflow === "evict") {
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

      document.removeEventListener("keydown", onKeyDown);
      if (pauseOnHidden) {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }

      renderer.destroy?.();
      container.remove();
    },
  };
}
