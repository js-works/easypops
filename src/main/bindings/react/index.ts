// -------------------------------------------------------------------
// "easypops/react" — dialogs and toasts as React.
// -------------------------------------------------------------------
//
// Wrap your app in <EasyPopsProvider> and reach for `useDialogs()` / `useToast()`. Both
// features render through the provider, so content is ordinary JSX with your context
// available to it, and an open dialog is reconciled rather than rebuilt — what the user
// has typed into a form survives an update.
//
// `react` and `react-dom` are peer dependencies here (and only here — the main entry
// stays framework-free). Nothing is injected at runtime any more: this module imports
// React itself, so the hooks can share a single provider-owned portal registry.

export { EasyPopsProvider, useDialogs, useToast } from "./provider.js";
export type { EasyPopsConfig, EasyPopsProviderProps } from "./provider.js";
export type { ReactContent } from "./dialog-adapter.js";
export type { ReactToastContent } from "./toast-adapter.js";
