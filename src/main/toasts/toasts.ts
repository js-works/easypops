// Public entry point for the toasts feature. The implementation is split across
// the sibling modules (types, theme, texts, options, view, icons, element, styles,
// placement, adapters, controller); this file re-exports the public surface, kept stable
// for ../index.ts and the package's `exports` map.
//
// Feature highlights over a bare toast core: six RTL-aware placements, mutable
// toasts (handle.update / a "loading" type / controller.promise), action buttons,
// dedupe via `key`, overflow evict/queue, swipe-to-dismiss, pause-when-hidden, an opt-in
// aria-live region, and light/dark/solid appearances. Every option defaults to the
// original behaviour.

export { createToastController } from "./controller.js";
export { createToastTheme, defaultToastTheme } from "./theme.js";
export { defaultToastTexts } from "./texts.js";
export type { ToastTheme } from "./theme.js";

export type { ToastTextResolver, ToastTexts } from "./texts.js";
export type {
  ToastSize,
  ToastControllerOptions,
  OverflowMode,
  Placement,
} from "./options.js";
export type {
  ToastAdapter,
  ToastAdapterFactory,
  ToastAppearance,
  ToastView,
} from "./view.js";
export type {
  ToastAction,
  ToastHandle,
  LoadingHandle,
  ToastOptions,
  ToastController,
  ToastType,
  PromiseHandle,
  PromiseMessages,
} from "./types.js";
