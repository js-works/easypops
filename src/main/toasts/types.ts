// -------------------------------------------------------------------
// Core public types for toasts.
// -------------------------------------------------------------------

import type { Severity } from "../internal/severity.js";

export type ToastType = Severity | "loading";

/** A single action button rendered under the message. */
export interface ToastAction<C> {
  /** Button label (content of type `C`). */
  label: C;
  /** Invoked on click, before dismissal. May be async. */
  onClick?: () => void | Promise<void>;
  /** Dismiss the toast after `onClick`. Defaults to `true`. */
  dismiss?: boolean;
}

export interface ToastOptions<C> {
  /**
   * Heading shown above the message.
   * - omitted -> the controller's `autoTitles` policy decides (no heading
   *   unless enabled there).
   * - `false` -> no heading, regardless of the controller policy.
   * - content -> used as-is.
   */
  title?: C | false;
  /**
   * Icon shown to the left of the content, vertically centered.
   * - omitted -> the controller's `autoIcons` policy decides.
   * - `false` -> no icon, regardless of the controller policy.
   * - content -> used as-is, slotted into light DOM. With the lit adapter, use
   *   the `html` tag with a complete `<svg>…</svg>` (not lit's `svg` fragment
   *   tag, which only renders inside an existing `<svg>`).
   */
  icon?: C | false;
  message: C;
  duration?: number;
  /**
   * Dedupe key. A new toast whose key matches a still-present one
   * updates that one in place (content refreshed, timer reset) and bumps a
   * visible count instead of stacking a duplicate. Omit for no dedupe.
   */
  key?: string;
  /** Action buttons rendered under the message. */
  actions?: ToastAction<C>[];
  /**
   * Whether the user can dismiss this toast (close button, Escape,
   * swipe). Defaults to `true`. Set `false` for e.g. an in-flight loading
   * toast; programmatic dismissal (the handle, timers, `clear`) still works.
   */
  dismissible?: boolean;
}

export type ToastInput<C> = string | ToastOptions<C>;

/** Returned by `info`/`success`/`warn`/`error` so callers can control a specific toast. */
export interface ToastHandle<C> {
  id: number;
  dismiss(): void;
  /**
   * Patch a live toast: any provided field replaces the current one,
   * omitted fields are left untouched. Changing `duration` resets the
   * countdown. No-ops once the toast has been dismissed.
   */
  update(options: Partial<ToastOptions<C>>): void;
}

/**
 * Returned by {@link ToastController.loading}: a handle for a toast that is still
 * pending, so the caller can settle it themselves. Settling swaps the same toast in
 * place — it never opens a second one.
 */
export interface LoadingHandle<C> extends ToastHandle<C> {
  /**
   * Swap this toast to `success` in place, starting the normal countdown.
   *
   * Patches rather than replaces: fields the input omits keep the values they had during
   * loading. That matters most for `dismissible` — a toast opened with
   * `dismissible: false` stays unclosable after settling unless the input turns it back
   * on. `duration` is the exception, reset from sticky to the normal default.
   */
  success(input: ToastInput<C>): void;
  /** Swap this toast to `error` in place. Same patch semantics as {@link success}. */
  error(input: ToastInput<C>): void;
}

/** {@link promise} result: a handle plus the settled promise, so callers can await it. */
export interface PromiseHandle<C, T> extends ToastHandle<C> {
  result: Promise<T>;
}

/** Messages for the three phases of {@link ToastController.promise}. */
export interface PromiseMessages<C, T> {
  loading: ToastInput<C>;
  /** Static input, or a function of the resolved value. */
  success: ToastInput<C> | ((value: T) => ToastInput<C>);
  /** Static input, or a function of the rejection reason. */
  error: ToastInput<C> | ((error: unknown) => ToastInput<C>);
}

export interface ToastController<C> {
  info(message: string): ToastHandle<C>;
  info(options: ToastOptions<C>): ToastHandle<C>;
  success(message: string): ToastHandle<C>;
  success(options: ToastOptions<C>): ToastHandle<C>;
  warn(message: string): ToastHandle<C>;
  warn(options: ToastOptions<C>): ToastHandle<C>;
  error(message: string): ToastHandle<C>;
  error(options: ToastOptions<C>): ToastHandle<C>;
  /**
   * Show a loading toast and hand back a handle to settle yourself. Loading toasts are
   * sticky (no countdown), so the terminal transition is the caller's to make:
   *
   * ```ts
   * const t = toasts.loading("Generating report…");
   * try {
   *   const report = await generateReport();
   *   t.success(`Report ready: ${report.filename}`);
   * } catch (err) {
   *   t.error(`Failed: ${String(err)}`);
   * }
   * ```
   *
   * Note the `try`/`catch`: nothing reaps a loading toast, so a throw between `loading()`
   * and the settle strands it on screen — and a non-dismissible one can't even be closed.
   * Because of that, the reason to choose this over {@link ToastController.promise} is
   * needing to touch the toast mid-flight — `update()` for progress or a changing label.
   * When the transition merely mirrors a promise, `promise()` is the safer call.
   */
  loading(message: string): LoadingHandle<C>;
  loading(options: ToastOptions<C>): LoadingHandle<C>;
  /**
   * The default choice for "show a loading toast until this promise settles". Prefer it
   * wherever it fits: the library owns the failure path, so a rejection can't strand the
   * loading toast the way a missing `catch` around {@link ToastController.loading} can.
   *
   * Reach for `loading()` instead when the toast has to change while the work is still
   * running — progress, a changing label. That's the one thing this can't express, since
   * it only ever sees the settled promise.
   *
   * Each phase takes plain content; `success` and `error` also accept a function of the
   * resolved value or rejection reason, for when the message depends on it:
   *
   * ```ts
   * toasts.promise(generateReport(), {
   *   loading: "Generating report…",
   *   success: (report) => `Report ready: ${report.filename}`,
   *   error: "Could not generate the report",
   * });
   * ```
   *
   * Returns the toast handle plus `.result` — the settled promise, which rejects whenever
   * the input does, so attach a `.catch` if you await it.
   *
   * Sugar over `loading()`; both run through the same transition path.
   */
  promise<T>(
    promise: Promise<T>,
    messages: PromiseMessages<C, T>,
  ): PromiseHandle<C, T>;
  /**
   * Drop every toast at once — visible and, under `overflow: "queue"`, still queued.
   * Timers are cancelled and the cards vanish without their exit animation, unlike a
   * `dismiss()` on a single handle.
   *
   * The controller stays usable afterwards; for a permanent teardown use
   * {@link ToastController.destroy}.
   */
  clear(): void;
  /** Tear down: cancel timers, drop toasts, remove listeners + container. */
  destroy(): void;
}
