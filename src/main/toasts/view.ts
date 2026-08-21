// -------------------------------------------------------------------
// The render seam: the fully-resolved view model the core hands to an adapter, plus the
// adapter contract and the small policy helpers the controller uses to build a view.
// -------------------------------------------------------------------

import type { ToastType } from "./types.js";

/** Visual style of a toast card. See ToastControllerOptions.appearance. */
export type ToastAppearance = "light" | "dark" | "solid";

// Shared per-severity opt-in check used by both the title and icon policies.
export function policyEnabled(
  policy: boolean | ToastType[] | undefined,
  type: ToastType,
): boolean {
  return Array.isArray(policy) ? policy.includes(type) : policy === true;
}

// error/warn interrupt (assertive); info/success/loading wait their turn (polite).
export function roleFor(type: ToastType): "alert" | "status" {
  return type === "error" || type === "warn" ? "alert" : "status";
}

/**
 * A fully-resolved per-toast "view model". The framework-agnostic core
 * computes all policy (title fallback, icon mode, role, severity prefix) and
 * hands the adapter pure data to project into DOM — the adapter contains no
 * policy. `dismissLabel`/`severity` are always plain strings; `icon`/`title`/
 * `message` and each action `label` are content of type `C`.
 */
export interface ToastView<C> {
  id: number;
  type: ToastType;
  role: "alert" | "status" | "none";
  duration: number;
  dismissLabel: string;
  iconMode: "custom" | "default" | "none";
  icon: C | null;
  severity: string | null;
  title: C | null;
  message: C;
  actions: { label: C }[];
  dismissible: boolean;
  count: number;
  /** Visual style (see ToastControllerOptions.appearance). */
  appearance: ToastAppearance;
}

/**
 * The only framework-coupled surface. Core owns state, timers, the custom
 * element, hover/dismiss/action delegation and animations; an adapter only
 * projects a keyed list of views into the container it was bound to.
 *
 * CONTRACT: `render` must apply its changes to the DOM **synchronously** before
 * returning. Right after calling it, the core reads hosts back by `data-id`
 * (to start the enter transform and to measure FLIP positions). lit and vanilla
 * are synchronous; the React adapter uses `flushSync` to honor this. `destroy`
 * is optional cleanup (e.g. unmounting a React root).
 */
export interface ToastAdapter<C> {
  render(views: ToastView<C>[]): void;
  destroy?(): void;
}

export type ToastAdapterFactory<C> = (context: {
  container: HTMLElement;
  tag: string;
}) => ToastAdapter<C>;
