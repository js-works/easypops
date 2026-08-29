// -------------------------------------------------------------------
// "easypops/lit" — the lit-html adapters for both features.
// -------------------------------------------------------------------
//
// The only entry point that imports a framework. Keeping it separate is what lets the
// main entry stay free of `lit-html` for vanilla and React consumers.

export { litDialogAdapter } from "./dialog-adapter.js";
export { litToastAdapter } from "./toast-adapter.js";
export type { LitContent } from "./toast-adapter.js";
