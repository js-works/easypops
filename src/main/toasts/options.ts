// -------------------------------------------------------------------
// Controller-level options (placement, overflow, appearance, policies).
// -------------------------------------------------------------------

import type { ToastTheme } from "./theme.js";
import type { ToastTextResolver } from "./texts.js";
import type { ToastType } from "./types.js";
import type {
  ToastAdapterFactory,
  ToastAppearance,
} from "./view.js";

/**
 * Where the stack is anchored. Horizontal is logical (`start`/`end` follow the
 * container's writing direction, so `end` is right in LTR and left in RTL);
 * `center` anchors to the middle. Defaults to `"bottom-end"`, i.e. the original
 * bottom-right (bottom-left in RTL) behaviour.
 */
export type Placement =
  | "top-start"
  | "top-center"
  | "top-end"
  | "bottom-start"
  | "bottom-center"
  | "bottom-end";

/** How to react when more toasts arrive than {@link ToastControllerOptions.maxVisible}. */
export type OverflowMode = "evict" | "queue";

/**
 * Overall card scale, applied once to every toast from the controller — it scales
 * the font size, width and padding together. Defaults to `"medium"` (the size shipped
 * today; the default computes to exactly the original dimensions).
 */
export type ToastSize = "small" | "medium" | "large";

export interface ToastControllerOptions<C> {
  /**
   * The rendering adapter, which also fixes the content type `C`. Use the
   * built-in {@link litToastAdapter} or {@link domToastAdapter}, or build one with
   * {@link createReactAdapter}.
   */
  adapter: ToastAdapterFactory<C>;
  theme?: Partial<ToastTheme>;
  /** Overall card size for this controller — scales font, width and padding. Default `"medium"`. */
  size?: ToastSize;
  getText?: ToastTextResolver;
  /**
   * Whether a toast that omits its `title` falls back to the localized
   * severity word as a heading:
   * - `false` (default) -> no heading.
   * - `true` -> heading for every type.
   * - array -> heading only for the listed types, e.g. `["warn", "error"]`.
   *
   * A per-toast `title` (content, or `false` to suppress) overrides it.
   */
  autoTitles?: boolean | ToastType[];
  /**
   * Whether the built-in severity icon is shown when a toast doesn't
   * supply its own `icon`:
   * - `true` (default) -> icon for every type.
   * - `false` -> no default icons.
   * - array -> icon only for the listed types, e.g. `["warn", "error"]`.
   *
   * A per-toast `icon` (content, or `false` to suppress) overrides it.
   * The `loading` spinner is always shown regardless of this policy.
   */
  autoIcons?: boolean | ToastType[];
  /**
   * Cap the number of simultaneously visible toasts. When a new one
   * pushes the count past the cap, {@link OverflowMode} decides what happens.
   * Omit for no cap.
   */
  maxVisible?: number;
  /**
   * With `maxVisible` set: `"evict"` (default) dismisses the oldest to make
   * room; `"queue"` holds extras off-screen and shows them as slots free up.
   */
  overflow?: OverflowMode;
  /** Corner the stack is anchored to. Defaults to `"bottom-end"`. */
  placement?: Placement;
  /**
   * Lay the toasts on top of each other instead of side by side, with the older ones
   * peeking out behind the newest. The stack expands to the ordinary list whenever the
   * user reaches for it — pointer over it, a tap on any card, or focus moving inside —
   * and collapses again when they leave. Default `false` (the flat list).
   *
   * Only the presentation changes. How many toasts exist at once is still
   * {@link ToastControllerOptions.maxVisible} and {@link ToastControllerOptions.overflow};
   * there is no second cap here.
   */
  stacked?: boolean;
  /** Allow horizontal swipe-to-dismiss (toward the anchored edge). Default `true`. */
  dismissOnSwipe?: boolean;
  /** Freeze auto-dismiss timers while the tab is backgrounded. Default `true`. */
  pauseOnHidden?: boolean;
  /**
   * Announce toasts through a persistent visually-hidden `aria-live`
   * region instead of relying on a dynamically-inserted `role="alert"` host
   * (which several screen readers announce unreliably). When `true`, hosts get
   * `role="none"` and the region does the talking. Default `false` to preserve
   * the original per-host role behaviour.
   */
  liveRegion?: boolean;
  /**
   * Visual style of the cards:
   * - `"light"` (default) -> light card with a severity accent stripe.
   * - `"solid"` -> filled/inverted: the severity accent becomes the card
   *   background with light text (`solidText` token, default white) — e.g.
   *   white on a red error card.
   * - `"dark"` -> neutral dark card (`darkBackground`/`darkText` tokens) that
   *   keeps the severity color on the accent stripe, icon and countdown ring —
   *   lightened toward white, since the accents as-is read muddy on a dark card.
   *
   * Pass a single value to apply it to every type, or a per-type map to mix
   * them, e.g. `{ error: "solid" }` for solid errors but light everything else
   * (unlisted types fall back to `"light"`).
   */
  appearance?:
    | ToastAppearance
    | Partial<Record<ToastType, ToastAppearance>>;
}
