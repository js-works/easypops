// -------------------------------------------------------------------
// # The dialog vocabulary
//
// The controller call surface (DialogsController / DialogsControllerConfig) plus the
// per-dialog config and result types.
// -------------------------------------------------------------------

import type { DialogAdapterFactory } from "./adapter.js";
import type { DialogTheme } from "./theme.js";
import type { Renderable } from "./content.js";
import type { DialogTexts } from "./texts.js";
import type { FormDialogData } from "./form-data.js";

// Re-export the content type so the public type surface can be named from one place.
export type { Renderable } from "./content.js";

export type DialogType =
  | "info"
  | "success"
  | "warn"
  | "error"
  | "confirm"
  | "confirmCritical"
  | "decide"
  | "decideCritical"
  | "form"
  | "formCritical"
  | "drawer"
  | "drawerCritical";

export type ActionButtonType = "primary" | "secondary" | "danger";

/**
 * Which button this is, semantically. Also the key a caller overrides its label under
 * (see {@link DialogViewConfig.buttons}). A decide dialog's Yes/No are `confirm` and
 * `decline` with different default text, not roles of their own — the four values here
 * are exactly the outcomes a click can produce.
 */
export type ButtonRole = "ok" | "confirm" | "decline" | "cancel";

/** Descriptor passed to a custom action-button renderer. */
export interface ActionButtonRender {
  role: ButtonRole;
  text: string;
  variant: ActionButtonType;
  loading: boolean;
  onClick: () => void;
}

/** Descriptor passed to a custom close-button renderer. */
export interface CloseButtonRender {
  onClose: () => void;
}

/**
 * Descriptor passed to a custom note renderer (see {@link FormAttempt.reject}). Plain
 * strings, because the library's own note box is shadow chrome and can only be filled
 * with data — an override replaces the whole box, so it gets the same values.
 */
export interface NoteRender {
  title?: string;
  message: string;
}

/**
 * Optional per-part render overrides. Each is all-or-nothing: when provided, the library
 * renders nothing of its own for that part and inserts the returned Renderable instead
 * (so the caller can drop in their design system's components). A custom part supplies
 * its own states/animation from the descriptor — e.g. a custom action button shows its
 * own loading state, and a custom reject message provides its own enter/leave animation.
 *
 * Overrides return `C` — real framework content, nothing else. `null` or a bare string
 * would be a half-override, and "render nothing here" is said by leaving the override out.
 */
export interface DialogRenderOverrides<C extends object> {
  actionButton?(button: ActionButtonRender): C;
  closeButton?(close: CloseButtonRender): C;
  note?(note: NoteRender): C;
}

export interface DialogsControllerConfig<C extends object> {
  /**
   * Renders this controller's dialogs, and is the source `C` is inferred from: pass
   * `litDialogAdapter` and every `content`/`title`/override-return on this controller is
   * typed to that framework's content.
   *
   * Required, deliberately: choosing how content is rendered is a decision no default can
   * make for you. Use {@link domDialogAdapter} for plain DOM nodes.
   */
  adapter: DialogAdapterFactory<C>;
  /**
   * Theme tokens for this controller's dialogs; omit for the built-in look. (Toasts have
   * their own {@link ToastTheme}.)
   *
   * A complete theme, not a patch: build it with {@link createDialogTheme}, which fills
   * the tokens you don't name from the defaults. One way to make a theme instead of two.
   */
  theme?: DialogTheme;
  getText?(textKey: keyof DialogTexts): string | undefined;
  /**
   * Header-icon policy for this controller's dialogs, overridden per dialog by
   * {@link DialogViewConfig.icon}. `true` uses the built-in icon for each type, `false`
   * shows none, a function decides per type — returning `true` for the built-in one,
   * `false` for none, or content of its own.
   */
  icons?: boolean | ((dialogType: DialogType) => C | boolean);
  render?: DialogRenderOverrides<C>;
  /**
   * Put something around every dialog's content before it is rendered. Unlike
   * {@link DialogRenderOverrides}, which replace a part the library would otherwise draw,
   * this leaves the content alone and only surrounds it.
   *
   * The case it exists for is a wrapper that has to be *inside* the dialog to work: a
   * scoped theme provider, or a portal target a component library can aim its popups at
   * so they land in the top layer with the dialog rather than behind it. Doing that per
   * `content` works too, but forgetting it on one dialog fails silently, which is the
   * kind of mistake a config option takes off the table.
   *
   * Called with the content the caller passed - which may be a plain string - and a
   * description of the dialog it belongs to, so a wrapper can skip the dialogs that
   * cannot contain anything to wrap:
   *
   *   wrapContent: (content, { hasForm }) =>
   *     hasForm ? h(FormProviders, null, content) : content
   *
   * Not called when a dialog has no content at all.
   */
  wrapContent?(content: Renderable<C>, dialogInfo: DialogInfo): Renderable<C>;
}

/** What {@link DialogsControllerConfig.wrapContent} is told about the dialog it is wrapping. */
export interface DialogInfo {
  dialogType: DialogType;
  /** Whether the content slot is wrapped in a <form> (form and drawer dialogs). */
  hasForm: boolean;
}

/**
 * Everything a dialog paints. Valid when it opens *and* on every later update, which is
 * the point of the split: an open dialog can be re-rendered from these fields alone.
 *
 * Behavioural options live one level down, in {@link DialogConfig} and below, so
 * "what may change while open" is expressed by inheritance rather than by subtracting
 * names. Add a behavioural field there and it is excluded from updates automatically —
 * there is no list to keep in sync.
 */
export interface DialogViewConfig<C extends object> {
  title?: Renderable<C>;
  subtitle?: Renderable<C>;
  /**
   * Header icon. `true` shows the built-in icon for this dialog type, `false` hides it,
   * content supplies a custom icon; omit to defer to the controller's
   * {@link DialogsControllerConfig.icons} policy.
   */
  icon?: C | boolean;
  intro?: Renderable<C>;
  content?: Renderable<C>;
  outro?: Renderable<C>;
  /** Caller-supplied CSS, scoped per-instance by the core. */
  styles?: string;
  /** Caller overrides for button labels, keyed by button role. */
  buttons?: Partial<Record<ButtonRole, string>>;
}

/**
 * A dialog's view plus the wiring that is fixed for its lifetime. Everything added here
 * (rather than to {@link DialogViewConfig}) is settable only when the dialog opens.
 */
export interface DialogConfig<C extends object> extends DialogViewConfig<C> {
  /**
   * Abort this dialog. When the signal aborts, the dialog closes immediately and the
   * call resolves `{ canceled: true, aborted: true }`. Combined with any scope-level
   * signal passed to `open()`.
   *
   * Behavioural, so it is not part of {@link DialogViewConfig}: the listener is attached
   * when the dialog opens, and swapping the signal later would silently detach it.
   */
  abortSignal?: AbortSignal;
}

/**
 * Client-side pre-validation for a form dialog. An object rather than a bare function so
 * further capabilities can be added without breaking the signature - and so ready-made
 * validators (for a schema library, say) have a natural shape.
 */
export interface FormValidator {
  /**
   * Run when a confirm-type button is clicked, after native constraint validation
   * (`reportValidity()`) passes and before the attempt is submitted. Return `false` to
   * keep the dialog open - unlike `reject()`, which is for server-round-trip results,
   * this is for a caller-owned validation library (Zod, Valibot, ...) that native HTML5
   * constraints can't express.
   *
   * With {@link FormDialogConfig.nativeValidation} set to `false` there is no native pass
   * to clear first, and this is the only verdict on the form.
   *
   * The library has no opinion on how invalid state is shown: the caller's own content
   * renders its own errors, and since content is rendered by your framework (not copied
   * in by the core), re-rendering that subtree is yours to do and safe at any time.
   *
   * It does have one on where to look next. When this turns a click down, focus moves to
   * the form's first control marked `aria-invalid="true"`, so the field that has to change
   * is ready to type in. That needs nothing from the validator: it is the attribute a
   * screen reader reads to announce a field as invalid, so a form layer that renders
   * accessible errors is already setting it.
   *
   * If nothing is marked invalid, `[autofocus]` is used instead - the same marker that
   * wins when the dialog opens - which lets a caller point at a field explicitly. With
   * neither, focus stays on the button that was clicked, which is what "press Enter to
   * retry" wants. Note that React's `autoFocus` prop does not produce that attribute: it
   * is applied by calling focus() on mount, so write `autofocus` literally for it to be
   * found.
   *
   * May return a promise - which is what schema libraries with async refinements and
   * form libraries like React Hook Form (whose `trigger()` is async) need. While one is
   * pending:
   *
   * - the clicked button shows its usual spinner, on the usual 150ms delay, because the
   *   click handler is simply still running;
   * - further clicks on validating buttons are dropped, so a second validation cannot
   *   start and a form dialog cannot queue a second attempt;
   * - Cancel, Escape and the close button stay live. A slow validator must not trap the
   *   user, so a verdict arriving after the dialog is gone is discarded.
   *
   * A rejected promise counts as invalid - the dialog stays open - and the error is
   * rethrown rather than swallowed, so a broken validator surfaces instead of looking
   * like a click that did nothing.
   */
  validate(form: HTMLFormElement): boolean | Promise<boolean>;
}

export interface FormDialogConfig<C extends object> extends DialogConfig<C> {
  validator?: FormValidator;
  /**
   * Whether the browser validates the form itself. Default `true`: constraint attributes
   * (`required`, `type="email"`, `minLength`, ...) are checked on a confirm click and the
   * first failure is reported in a native bubble, before {@link FormValidator.validate}
   * ever runs.
   *
   * Set `false` to put `novalidate` on the form and hand reporting entirely to your own
   * content. The attributes stay where they are, so assistive technology and mobile
   * keyboards still read them - only the browser's UI steps aside, and one kind of
   * problem then has one presentation instead of two.
   *
   * This is the option to reach for when a schema is the single source of truth. Omitting
   * the attributes is not an equivalent lever: `type="date"` and `type="number"` set
   * `badInput` on a half-typed value no matter what you leave off, so a native bubble can
   * appear in a form that declares no constraints at all.
   *
   * Behavioural, so it is not part of {@link DialogViewConfig}: it is read on each confirm
   * click and reflected on the form element, and is fixed once the dialog is open.
   */
  nativeValidation?: boolean;
}

// Not exported: the twelve methods exist so DialogScope and DialogsController can
// share them. Code that wants to accept either writes the union of those two.
interface DialogMethods<C extends object> {
  info(config: DialogConfig<C>): DialogHandle<MessageDialogResult, C>;
  success(config: DialogConfig<C>): DialogHandle<MessageDialogResult, C>;
  warn(config: DialogConfig<C>): DialogHandle<MessageDialogResult, C>;
  error(config: DialogConfig<C>): DialogHandle<MessageDialogResult, C>;
  confirm(config: DialogConfig<C>): DialogHandle<ConfirmDialogResult, C>;
  confirmCritical(
    config: DialogConfig<C>,
  ): DialogHandle<ConfirmDialogResult, C>;
  decide(config: DialogConfig<C>): DialogHandle<DecideDialogResult, C>;
  decideCritical(
    config: DialogConfig<C>,
  ): DialogHandle<DecideDialogResult, C>;
  /**
   * A form dialog. One method covers both submission styles, because
   * {@link FormDialogHandle} is awaitable *and* async-iterable:
   *
   * ```ts
   * // optimistic — resolves on the first valid submit and closes
   * const result = await dialogs.form({ title: "Edit customer", content });
   *
   * // pessimistic — stays open, with the user's input intact, until the server agrees
   * const form = dialogs.form({ title: "Edit customer", content });
   * for await (const attempt of form) {
   *   (await save(attempt.data)) ? attempt.accept() : attempt.reject("Name taken");
   * }
   * ```
   *
   * Awaiting without iterating auto-accepts the first valid submit, so the short form
   * needs no separate method.
   */
  form(config: FormDialogConfig<C>): FormDialogHandle<C>;
  /** {@link DialogMethods.form} with destructive styling and no Enter-to-confirm. */
  formCritical(config: FormDialogConfig<C>): FormDialogHandle<C>;
  /**
   * A form on a drawer surface — a full-height panel sliding in from the inline-end edge,
   * for edit-in-place flows too wide or too tall for a centered dialog. Still a modal
   * `<dialog>`, so focus trapping, the inert background and Escape behave identically.
   *
   * Same contract as {@link DialogMethods.form}. Iterating is usually the right choice
   * here: a wide edit panel is exactly where closing on submit and losing the input hurts
   * most.
   */
  drawer(config: FormDialogConfig<C>): FormDialogHandle<C>;
  /**
   * {@link DialogMethods.drawer} with destructive styling and no Enter-to-confirm —
   * for a panel whose save is irreversible (publish, send, deploy) rather than an
   * ordinary edit.
   */
  drawerCritical(config: FormDialogConfig<C>): FormDialogHandle<C>;
}

export interface DialogsController<C extends object> extends DialogMethods<C> {
  /**
   * Open a scope whose dialogs share one modal surface (the backdrop stays up for the
   * whole scope). An optional `signal` aborts every dialog opened in the scope.
   */
  open(signal?: AbortSignal): DialogScope<C>;
  /**
   * Close every dialog this controller still has on screen and settle their callers as
   * `{ canceled: true, aborted: true }` — the same result an `abortSignal` produces,
   * because it is the same situation: the dialog is gone and nobody can answer it any
   * more. Without this a caller awaiting `confirm()` would wait forever.
   *
   * The controller stays usable afterwards; it only lets go of what is open. Mirrors
   * {@link ToastController.destroy}, and is what a React provider calls when it unmounts.
   */
  abortAll(): void;
}

export interface DialogScope<C extends object> extends DialogMethods<C> {
  /**
   * Close the scope: tear down the shared modal surface and cancel anything still
   * pending in it. Call this directly when you aren't using a `using` declaration.
   */
  dispose(): void;
  /**
   * Alias of {@link close} so a scope works with `using`. Only present when the runtime
   * provides `Symbol.dispose`; otherwise call {@link dispose} directly.
   */
  [Symbol.dispose](): void;
}

// The three ways a dialog can end, named separately so each kind of dialog can say which
// of them it is actually able to produce. `canceled` discriminates answer from no-answer;
// `aborted` says why there was no answer.

/** The user answered. `A` is which answers this kind allows, `T` any data it carries. */
export interface Answered<A extends string, T = undefined> {
  canceled: false;
  action: A;
  data: T;
}

/** The user made it go away without answering: cancel button, close button, Escape. */
export interface Dismissed {
  canceled: true;
  aborted: false;
}

/** It was taken away programmatically: `abort()`, an `abortSignal`, a disposed scope. */
export interface Aborted {
  canceled: true;
  aborted: true;
}

/**
 * Result of the acknowledge-only dialogs: info, success, warn, error.
 *
 * No {@link Dismissed}: these have no cancel button, and dismissing a message *is*
 * acknowledging it — so Escape and the close button resolve as `ok` like the button does.
 * The only way here without an answer is an abort.
 */
export type MessageDialogResult = Answered<"ok"> | Aborted;
export type ConfirmDialogResult = Answered<"confirm"> | Dismissed | Aborted;
export type DecideDialogResult =
  | Answered<"confirm" | "decline">
  | Dismissed
  | Aborted;
export type FormDialogResult =
  | Answered<"confirm", FormDialogData>
  | Dismissed
  | Aborted;

/** One submission of a form dialog while iterating for retry (see {@link DialogMethods.form}). */
export interface FormAttempt {
  readonly data: FormDialogData;
  /**
   * Accept the submission: resolve the dialog and close it. Pass data to resolve with
   * something other than what was collected — normalised or server-completed values, say.
   */
  accept(data?: FormDialogData): void;
  /**
   * Reject it: keep the dialog open (values preserved) and show a note with this text,
   * and an optional heading. A reject is always styled as an error.
   */
  reject(message: string, title?: string): void;
}

/**
 * What every dialog method returns: awaitable for the result, and a handle on the dialog
 * while it is up.
 *
 * `PromiseLike` rather than `Promise` on purpose — the contract is only "you can await
 * this", which leaves the implementation free to be a plain object instead of a real
 * promise with properties bolted on. A dialog never rejects: cancelling and aborting are
 * results, not errors, so there is no `catch` to promise.
 */
export interface DialogHandle<R, C extends object> extends PromiseLike<R> {
  /** True while the dialog can still be answered. Goes false the moment it settles. */
  readonly pending: boolean;
  /**
   * Take the dialog away and settle it as `{ canceled: true, aborted: true }` — the
   * imperative twin of {@link DialogConfig.abortSignal}. No-op once settled.
   */
  abort(): void;
  /**
   * Re-render the open dialog with patched view config — a new title, relabelled buttons,
   * different content. Omitted fields keep their current value.
   *
   * Only {@link DialogViewConfig} fields are accepted: behavioural options live one level
   * down (`abortSignal`, `validator`) and are fixed once the dialog is open. A slot whose
   * value is unchanged is not re-projected, so relabelling a button cannot disturb the
   * caller's content or anything the user has typed into it. No-op once settled.
   */
  update(patch: Partial<DialogViewConfig<C>>): void;
}

/**
 * A form dialog's handle: everything {@link DialogHandle} has, plus async iteration over
 * submit attempts. `for await` it to intercept each submit and accept/reject (retry with
 * a note); await it for the final result once the loop ends.
 */
export type FormDialogHandle<C extends object> = DialogHandle<
  FormDialogResult,
  C
> &
  AsyncIterable<FormAttempt>;

// -------------------------------------------------------------------
// # Not part of the reviewed surface
//
// Everything above was gone through type by type against the types2.ts draft. What
// follows was not — it predates that pass, or is plumbing the draft deliberately left
// out. Treat it as unreviewed: it works, but nobody has argued for its shape.
// -------------------------------------------------------------------

/**
 * Any result the plumbing can produce, before narrowing to a specific dialog's.
 *
 * Only exists because one code path in the controller builds results for all twelve
 * dialog kinds and TypeScript cannot follow which one it is at runtime. The draft dropped
 * it: `MessageDialogResult | ConfirmDialogResult | DecideDialogResult | FormDialogResult`
 * says the same thing more precisely and needs no declaration of its own.
 */
export type AnyDialogResult = Answered<string, unknown> | Dismissed | Aborted;
