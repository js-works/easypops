// Public entry point for the toasts feature. The implementation is split across the
// sibling modules: the public contract lives under contract/ (toast, theme, texts,
// options, view), the rest (icons, element, styles, placement, adapters, controller)
// alongside this file. This file re-exports the public surface, kept stable for
// ../index.ts and the package's `exports` map.
//
// Feature highlights over a bare toast core: six RTL-aware placements, mutable
// toasts (handle.update / a "loading" type / controller.promise), action buttons,
// dedupe via `key`, overflow evict/queue, swipe-to-dismiss, pause-when-hidden, an opt-in
// aria-live region, and light/dark/solid appearances. Every option defaults to the
// original behaviour.

export { createToastController } from "./controller.js";
export { createToastTheme, defaultToastTheme } from "./contract/theme.js";
export { defaultToastTexts } from "./contract/texts.js";
export type { ToastTheme } from "./contract/theme.js";

export type { ToastTextResolver, ToastTexts } from "./contract/texts.js";
export type {
  ToastSize,
  ToastControllerOptions,
  OverflowMode,
  Placement,
} from "./contract/options.js";
export type {
  ToastAdapter,
  ToastAdapterFactory,
  ToastAppearance,
  ToastView,
} from "./contract/view.js";
export type {
  ToastAction,
  ToastHandle,
  LoadingHandle,
  ToastOptions,
  ToastController,
  ToastType,
  PromiseHandle,
  PromiseMessages,
} from "./contract/toast.js";
