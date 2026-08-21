// -------------------------------------------------------------------
// # Public types
// -------------------------------------------------------------------

import type { DialogTheme } from "./theme.js";
import type { ContentAdapter, Renderable } from "./content.js";
import type { DialogTexts } from "./texts.js";
import type { FormDialogData } from "./form-data.js";

// Re-export the content types so the public type surface can be named from one place.
export type { ContentAdapter, Renderable } from "./content.js";

// Caller-supplied CSS for a dialog: a plain CSS string, scoped per-instance by the core.
export type Styles = string;

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
  | "formCritical";

export type ActionButtonType = "primary" | "secondary" | "danger" | "success";

/** Descriptor passed to a custom action-button renderer. */
export interface ActionButtonRender {
  text: string;
  variant: ActionButtonType;
  loading: boolean;
  onClick: () => void;
}

/** Descriptor passed to a custom close-button renderer. */
export interface CloseButtonRender {
  onClose: () => void;
}

/** Descriptor passed to a custom reject-message renderer (see FormAttempt.reject). */
export interface RejectMessageRender<C extends object = never> {
  /** The configured heading, or undefined for a message-only reject message. */
  title: Renderable<C> | undefined;
  message: Renderable<C>;
}

/**
 * Optional per-part render overrides. Each is all-or-nothing: when provided, the library
 * renders nothing of its own for that part and inserts the returned Renderable instead
 * (so the caller can drop in their design system's components). A custom part supplies
 * its own states/animation from the descriptor — e.g. a custom action button shows its
 * own loading state, and a custom reject message provides its own enter/leave animation.
 *
 * Overrides return `Renderable<C>`: a Node/string directly, or framework content when an
 * `adapter` is configured (their returns are checked against the same `C` as content).
 */
export interface DialogRenderOverrides<C extends object = never> {
  actionButton?(button: ActionButtonRender): Renderable<C>;
  closeButton?(close: CloseButtonRender): Renderable<C>;
  rejectMessage?(message: RejectMessageRender<C>): Renderable<C>;
}

export interface DialogsControllerConfig<C extends object = never> {
  /**
   * Turns opaque framework content (e.g. a Lit TemplateResult) into a Node, and is the
   * source `C` is inferred from: pass `litDialogAdapter` and every `content`/`title`/
   * override-return on this controller is typed to that framework's content.
   */
  adapter?: ContentAdapter<C>;
  /**
   * Theme tokens for this controller's dialogs. Build one with {@link createDialogTheme};
   * omit for the built-in look. (Toasts have their own {@link ToastTheme}.)
   */
  theme?: Partial<DialogTheme>;
  getText?(textKey: keyof DialogTexts): string | null;
  getDialogIcon?(dialogType: DialogType): Renderable<C> | null;
  autoIcons?: boolean;
  render?: DialogRenderOverrides<C>;
}

/** Caller overrides for button labels, keyed by button role. */
export interface DialogButtonLabels {
  ok?: string;
  confirm?: string;
  decline?: string;
  cancel?: string;
  yes?: string;
  no?: string;
}

export interface BaseDialogConfig<C extends object = never> {
  title?: Renderable<C>;
  subtitle?: Renderable<C>;
  /**
   * Header icon. `true` shows the built-in icon for this dialog type, `false` hides it,
   * content supplies a custom icon; omit to defer to the controller's `autoIcons` /
   * `getDialogIcon` policy.
   */
  icon?: Renderable<C> | boolean;
  intro?: Renderable<C>;
  content?: Renderable<C>;
  outro?: Renderable<C>;
  styles?: Styles;
  buttons?: DialogButtonLabels;
  /**
   * Abort this dialog. When the signal aborts, the dialog closes immediately and the
   * call resolves `{ canceled: true, aborted: true }`. Combined with any scope-level
   * signal passed to `open()`.
   */
  abortSignal?: AbortSignal;
}

export interface InfoDialogConfig<
  C extends object = never,
> extends BaseDialogConfig<C> {}
export interface SuccessDialogConfig<
  C extends object = never,
> extends BaseDialogConfig<C> {}
export interface WarnDialogConfig<
  C extends object = never,
> extends BaseDialogConfig<C> {}
export interface ErrorDialogConfig<
  C extends object = never,
> extends BaseDialogConfig<C> {}
export interface ConfirmDialogConfig<
  C extends object = never,
> extends BaseDialogConfig<C> {}
export interface DecideDialogConfig<
  C extends object = never,
> extends BaseDialogConfig<C> {}
export interface FormDialogConfig<
  C extends object = never,
> extends BaseDialogConfig<C> {
  /**
   * Client-side pre-validation, run when a confirm-type button is clicked, after native
   * constraint validation (`reportValidity()`) passes and before the attempt is
   * submitted. Return (or resolve) `false` to keep the dialog open — unlike `reject()`,
   * which is for server-round-trip results, this is for a caller-owned validation
   * library (Zod, react-hook-form, …) that native HTML5 constraints can't express. js-
   * gossip has no opinion on how invalid state is shown: the caller's own content is
   * responsible for rendering its own errors (e.g. a validation library re-rendering its
   * own React/Lit/vanilla subtree), since content is handed to js-gossip once and is
   * never touched again afterwards.
   */
  validate?(form: HTMLFormElement): boolean | Promise<boolean>;
}

export interface DialogsFunctions<C extends object = never> {
  info(config: InfoDialogConfig<C>): Promise<InfoDialogResult>;
  success(config: SuccessDialogConfig<C>): Promise<SuccessDialogResult>;
  warn(config: WarnDialogConfig<C>): Promise<WarnDialogResult>;
  error(config: ErrorDialogConfig<C>): Promise<ErrorDialogResult>;
  confirm(config: ConfirmDialogConfig<C>): Promise<ConfirmDialogResult>;
  confirmCritical(config: ConfirmDialogConfig<C>): Promise<ConfirmDialogResult>;
  decide(config: DecideDialogConfig<C>): Promise<DecideDialogResult>;
  decideCritical(config: DecideDialogConfig<C>): Promise<DecideDialogResult>;
  form(config: FormDialogConfig<C>): Promise<FormDialogResult>;
  formCritical(config: FormDialogConfig<C>): Promise<FormDialogResult>;
  formAttempts(config: FormDialogConfig<C>): FormInteraction<C>;
  formCriticalAttempts(config: FormDialogConfig<C>): FormInteraction<C>;
}

export interface DialogsController<
  C extends object = never,
> extends DialogsFunctions<C> {
  /**
   * Open a scope whose dialogs share one modal surface (the backdrop stays up for the
   * whole scope). An optional `signal` aborts every dialog opened in the scope.
   */
  open(signal?: AbortSignal): DialogScope<C>;
}

export interface DialogScope<C extends object = never> extends DialogsFunctions<C> {
  /**
   * Close the scope: tear down the shared modal surface and cancel anything still
   * pending in it. Call this directly when you aren't using a `using` declaration.
   */
  close(): void;
  /**
   * Alias of {@link close} so a scope works with `using`. Only present when the runtime
   * provides `Symbol.dispose`; otherwise call {@link close} directly.
   */
  [Symbol.dispose](): void;
}

type DialogResult<A extends string, T = never> =
  | ([T] extends [never]
      ? {
          canceled: false;
          action: A;
        }
      : {
          canceled: false;
          action: A;
          data: T;
        })
  | {
      canceled: true;
      aborted: boolean;
    };

export type InfoDialogResult = DialogResult<"ok">;
export type SuccessDialogResult = DialogResult<"ok">;
export type WarnDialogResult = DialogResult<"ok">;
export type ErrorDialogResult = DialogResult<"ok">;
export type ConfirmDialogResult = DialogResult<"confirm">;
export type DecideDialogResult = DialogResult<"confirm" | "decline">;
export type FormDialogResult = DialogResult<"confirm", FormDialogData>;

/** One submission of a form dialog while iterating for retry (see formAttempts()). */
export interface FormAttempt<C extends object = never> {
  readonly data: FormDialogData;
  /** Accept the submission: resolve the dialog and close it. */
  accept(): void;
  /**
   * Reject it: keep the dialog open (values preserved) and show a reject message with
   * this text, and an optional heading. A reject is always styled as an error.
   */
  reject(message: Renderable<C>, title?: Renderable<C>): void;
}

/**
 * Returned by formAttempts()/formCriticalAttempts(). `for await` it to intercept each
 * submit and accept/reject (retry with a reject message); it is also awaitable, which
 * resolves to the final result once the loop ends. After the loop, read `result` to see
 * whether the form was confirmed or canceled.
 */
export type FormInteraction<C extends object = never> = Promise<FormDialogResult> &
  AsyncIterable<FormAttempt<C>> & {
    /** The final result once settled (confirmed or canceled); undefined while pending. */
    readonly result: FormDialogResult | undefined;
  };

/** Any result finish() can produce, before narrowing to a specific dialog's result. */
export type AnyDialogResult = DialogResult<any> | DialogResult<any, unknown>;
