// -------------------------------------------------------------------
// The dialog rendering adapter.
// -------------------------------------------------------------------
//
// Replaces the one-shot `ContentAdapter<C> = (value: C) => Node`. The difference is who
// builds the DOM: the adapter *describes* the dialog element and the framework renders
// and reconciles it, rather than the core constructing nodes and the framework being
// asked to produce a detached blob.
//
// That inversion is what makes an open dialog updatable. Re-describing it hands Lit's
// ChildPart / React's reconciler the same tree with changed values, so DOM identity
// survives — an <input> the user has typed into is diffed, not rebuilt. Under the old
// contract every update rebuilt the content and discarded whatever was in it.
//
// It is also what makes a React dialog adapter possible at all: React renders the host
// element declaratively, so no portal (and no synchronous `C -> Node` conversion, which
// React cannot honour) is needed.

import type { DialogButtonView } from "./view.js";
import type { DialogRenderOverrides, DialogType } from "./dialog.js";
import type { Renderable } from "./content.js";

/**
 * Data for the dialog element, as plain values. Framework content never appears here —
 * it goes in {@link DialogSlots}.
 *
 * Every key is always present, `null` for absent, never omitted. That's deliberate: it
 * lets an adapter use one fixed template with static bindings. In particular `lit-html`
 * has no spread directive, so a variable-shaped record would force one.
 */
export interface DialogProps<C extends object> {
  dialogType: DialogType;
  /** Caller theme, already resolved to `--dialog-*` custom properties. */
  themeVars: Record<string, string>;
  /** Caller stylesheet text, scoped by the element to its own instance. */
  styles: string | null;
  /** Whether the content slot is wrapped in a <form> (form and drawer dialogs). */
  hasForm: boolean;
  /**
   * Whether that <form> runs the browser's own constraint validation. False puts
   * `novalidate` on it, which is what a caller whose schema owns the reporting asks for
   * (see FormDialogConfig.nativeValidation). Always present, `true` when there is no
   * form at all.
   */
  nativeValidation: boolean;
  buttons: readonly DialogButtonView[];
  /** Index of the button Enter triggers, or null (critical dialogs prime nothing). */
  defaultButtonIndex: number | null;
  /**
   * Render the round placeholder instead of a dialog: a scope that has nothing to show
   * yet puts this up, and swaps it for the first real dialog when one is ready. Every
   * slot is empty while it is set.
   *
   * It travels as a prop rather than as a separate mount path because it is the *same*
   * element and the same open `<dialog>` — that is what keeps the modal backdrop up
   * across the handoff. An adapter needs to do nothing about it beyond passing it on.
   */
  spinnerOnly: boolean;
  onClose: () => void;
  onCancel: () => void;
  /**
   * The note the library renders inside its own box, or null for none. Plain data, not a
   * slot: the box is shadow chrome (see DialogRenderOverrides.note for replacing it).
   */
  note: { title?: string; message: string } | null;
  /**
   * The user dismissed the note (by typing, or by pressing a button). The note itself is
   * spec state — the controller drops it and re-renders. The element has already played
   * the collapse by the time this fires, so what it collapsed was still on screen for it.
   */
  onNoteDismiss: () => void;
  /**
   * Caller-supplied renderers for the library's own chrome (action buttons, close button,
   * note). They return framework content, so only an adapter can invoke them —
   * which is exactly why they travel here rather than to the element.
   *
   * The adapter renders overridden buttons into the `action` slot and leaves the default
   * ones to the element's shadow chrome. That split is deliberate: `::slotted()` loses to
   * any rule in the outer tree regardless of specificity, so anything the library needs to
   * style must live in the shadow root. Overridden buttons are the caller's own components
   * and the library styles nothing about them, so light DOM costs nothing there.
   */
  render?: DialogRenderOverrides<C>;
}

/**
 * The framework-owned regions. Same rule as {@link DialogProps}: every key present,
 * `null` for absent — so an adapter renders a fixed set of slots and lets the framework
 * diff their contents.
 */
export interface DialogSlots<C extends object> {
  icon: Renderable<C>;
  title: Renderable<C>;
  subtitle: Renderable<C>;
  intro: Renderable<C>;
  content: Renderable<C>;
  outro: Renderable<C>;
  /**
   * A caller-supplied replacement for the note box (see DialogRenderOverrides.note), or
   * null when the library renders its own from {@link DialogProps.note}.
   */
  note: C | null;
}

/** Everything an adapter needs to render one dialog element. */
export interface DialogSpec<C extends object> {
  props: DialogProps<C>;
  slots: DialogSlots<C>;
}

/**
 * A renderer bound to one container — the same shape as {@link ToastAdapterFactory}, so
 * both features work the same way.
 *
 * Binding to a container rather than returning content is what lets a vanilla adapter
 * exist at all: for `C = string | Node` there is no virtual representation to hand back,
 * so a `spec -> C` signature would force it to build fresh DOM on every render and lose
 * exactly the state we are trying to preserve. Holding the container lets it diff instead
 * — and gives React somewhere to keep its root.
 */
export type DialogAdapterFactory<C extends object> = (context: {
  container: HTMLElement;
  /** Tag the dialog element is registered under; unique per library load. */
  tag: string;
  /**
   * Ask the core for a fresh spec and render it. The adapter owns *when* — it knows its
   * framework's reactivity — and the core owns *what*: it rebuilds the spec, re-reading
   * `getText` and `icons`. Use it when something outside the core changed the answers
   * those give, e.g. the app switched language. No-op when nothing is on screen.
   */
  requestRender(): void;
}) => DialogAdapter<C>;

export interface DialogAdapter<C extends object> {
  /**
   * Render the spec into the bound container, reusing whatever is already there.
   *
   * Must be synchronous — the core reads layout and moves focus straight afterwards.
   * (React adapters need `flushSync`, the same requirement the toast adapter documents.)
   */
  render(spec: DialogSpec<C>): void;
  /** Optional teardown when the dialog goes away, e.g. unmounting a React root. */
  destroy?(): void;
}
