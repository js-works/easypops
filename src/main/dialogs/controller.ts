// -------------------------------------------------------------------
// The dialogs controller and its scopes: pure orchestration over the presentational
// element (see element.ts). Turns caller config into DialogViews, routes button clicks,
// aborts, and the form retry/interaction flow.
// -------------------------------------------------------------------

import { toCssVariable } from "../internal/css.js";

import {
  cancelBtn,
  confirmBtn,
  confirmBtnDanger,
  noBtn,
  okBtn,
  okBtnDanger,
  symbolCancel,
  symbolConfirm,
  symbolDecline,
  symbolOk,
  yesBtn,
  yesBtnDanger,
} from "./buttons.js";
import type { ButtonConfig } from "./buttons.js";
import { mountDialog, mountSpinnerDialog } from "./element.js";
import { FormDialogData } from "./form-data.js";
import { defaultDialogIcon } from "./icons.js";
import { BUTTON_SPINNER_DELAY_MS, SPINNER_DIALOG_DELAY_MS } from "./styles.js";
import { defaultDialogTexts } from "./texts.js";
import type { Renderable } from "./content.js";
import type { TextKey } from "./texts.js";
import type { DialogButtonView, DialogHandle, DialogView } from "./view.js";
import type {
  AnyDialogResult,
  BaseDialogConfig,
  ConfirmDialogResult,
  DecideDialogResult,
  DialogScope,
  DialogsController,
  DialogsControllerConfig,
  DialogType,
  ErrorDialogResult,
  FormAttempt,
  FormDialogConfig,
  FormDialogResult,
  FormInteraction,
  InfoDialogResult,
  SuccessDialogResult,
  WarnDialogResult,
} from "./types.js";

// Combine any number of (optional) signals into one. Returns undefined when none are
// present, the single signal when exactly one is, else an `AbortSignal.any` of all.
function combineSignals(
  ...signals: (AbortSignal | undefined)[]
): AbortSignal | undefined {
  const present = signals.filter((s): s is AbortSignal => s != null);
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return AbortSignal.any(present);
}

// A minimal single-consumer async queue: form submits are pushed in; the caller's
// `for await` pulls them out. `end()` completes the iteration (on accept or cancel).
interface AttemptQueue {
  push(attempt: FormAttempt<any>): void;
  end(): void;
  iterator(): AsyncIterator<FormAttempt<any>>;
}

function createAttemptQueue(): AttemptQueue {
  const buffer: FormAttempt<any>[] = [];
  let waiting: ((r: IteratorResult<FormAttempt<any>>) => void) | null = null;
  let ended = false;

  return {
    push(attempt) {
      if (ended) return;
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve({ value: attempt, done: false });
      } else {
        buffer.push(attempt);
      }
    },
    end() {
      ended = true;
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve({ value: undefined, done: true });
      }
    },
    iterator() {
      return {
        next() {
          if (buffer.length > 0) {
            return Promise.resolve({ value: buffer.shift()!, done: false });
          }
          if (ended) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise<IteratorResult<FormAttempt<any>>>((resolve) => {
            waiting = resolve;
          });
        },
      };
    },
  };
}

// Flow used by form dialogs to route confirm/cancel/abort through the retry interaction.
interface FormFlow {
  submit(
    data: FormDialogData,
    handle: DialogHandle,
    stopSpinner: () => void,
  ): void;
  cancel(): void;
  abort(): void;
}

// -------------------------------------------------------------------
// # Controller
// -------------------------------------------------------------------

export function createDialogsController<C extends object = never>(
  config: DialogsControllerConfig<C>,
): DialogsController<C> {
  const open = (signal?: AbortSignal): DialogScope<C> =>
    createDialogScope(config, signal);

  // Direct (non-scoped) calls open a throwaway scope and dispose it once resolved.
  const oneShot = <R>(
    run: (scope: DialogScope<C>) => Promise<R>,
  ): Promise<R> => {
    const scope = open();
    return run(scope).finally(() => scope.close());
  };

  // Forms return a FormInteraction (Promise + async-iterable). We must return that
  // object as-is (so `for await` works), and dispose the scope once it settles.
  const oneShotForm = (
    run: (scope: DialogScope<C>) => FormInteraction<C>,
  ): FormInteraction<C> => {
    const scope = open();
    const interaction = run(scope);
    void interaction.finally(() => scope.close());
    return interaction;
  };

  return {
    open,
    info: (c) => oneShot((s) => s.info(c)),
    success: (c) => oneShot((s) => s.success(c)),
    warn: (c) => oneShot((s) => s.warn(c)),
    error: (c) => oneShot((s) => s.error(c)),
    confirm: (c) => oneShot((s) => s.confirm(c)),
    confirmCritical: (c) => oneShot((s) => s.confirmCritical(c)),
    decide: (c) => oneShot((s) => s.decide(c)),
    decideCritical: (c) => oneShot((s) => s.decideCritical(c)),
    form: (c) => oneShot((s) => s.form(c)),
    formCritical: (c) => oneShot((s) => s.formCritical(c)),
    formAttempts: (c) => oneShotForm((s) => s.formAttempts(c)),
    formCriticalAttempts: (c) => oneShotForm((s) => s.formCriticalAttempts(c)),
  };
}

// -------------------------------------------------------------------
// # Scope
// -------------------------------------------------------------------

interface OpenDialogSpec {
  dialogType: DialogType;
  defaultTitle: TextKey;
  config: BaseDialogConfig<any>;
  buttons: ButtonConfig[];
  allowsForm: boolean;
}

// Monotonic, collision-free per-scope id (used as a DOM element id).
let dialogInstanceCounter = 0;

function createDialogScope<C extends object = never>(
  config: DialogsControllerConfig<C>,
  scopeSignal?: AbortSignal,
): DialogScope<C> {
  const dialogId = `internal-dialog-${++dialogInstanceCounter}`;

  // Resolve the caller theme once into `--dialog-*` custom properties, applied to every
  // dialog element opened in this scope. Empty when no theme is set (built-in look).
  const themeVars: Record<string, string> = {};
  if (config.theme) {
    for (const [key, value] of Object.entries(config.theme)) {
      // Generic theme key -> namespaced dialog CSS var (e.g. `primaryBackground` ->
      // `--dialog-primary-background`), so tokens are generic while the vars the dialog
      // CSS reads stay collision-safe and don't leak to/from the page or slotted content.
      if (value != null) {
        themeVars[`--dialog-${toCssVariable(key).slice(2)}`] = value;
      }
    }
  }

  // One element for the whole scope: it's reused across every dialog so the modal stays
  // open and the backdrop never drops between dialogs.
  let handle: DialogHandle | null = null;
  let realDialogShown = false;

  // Clears the pending 150ms button spinner of whichever button most recently triggered
  // a transition (set on click, cleared on the next open / on dispose).
  let clearPendingSpinner: (() => void) | null = null;

  // Removes the scope-level abort listener on dispose.
  const scopeLifetime = new AbortController();

  // If nothing opens within the delay, show the round spinner dialog as a placeholder.
  const spinnerTimer = setTimeout(() => {
    if (!realDialogShown && !handle) {
      handle = mountSpinnerDialog(dialogId);
    }
  }, SPINNER_DIALOG_DELAY_MS);

  // Close whatever is currently on screen and forget it. Used by abort and dispose.
  const teardownCurrent = (): void => {
    clearTimeout(spinnerTimer);
    clearPendingSpinner?.();
    clearPendingSpinner = null;
    const current = handle;
    handle = null;
    void current?.close();
  };

  // A scope signal tears down the current dialog even when no call is pending (e.g. it
  // fires during async work *between* two dialogs, while one is still on screen). A
  // pending dialog additionally settles `aborted` via its own combined-signal listener.
  if (scopeSignal && !scopeSignal.aborted) {
    scopeSignal.addEventListener("abort", teardownCurrent, {
      once: true,
      signal: scopeLifetime.signal,
    });
  }

  function getText(textKey: TextKey): string {
    return config.getText?.(textKey) ?? defaultDialogTexts[textKey];
  }

  function iconFor(
    dialogType: DialogType,
    dialogConfig: BaseDialogConfig<any>,
  ): Renderable<any> {
    // A per-dialog `icon` wins over the controller policy: true -> the built-in icon for
    // the type, false -> none, content -> that content; undefined -> fall back to policy.
    const perDialog = dialogConfig.icon;
    if (perDialog === true) return defaultDialogIcon(dialogType);
    if (perDialog === false) return null;
    if (perDialog !== undefined) return perDialog;
    if (config.getDialogIcon) {
      return config.getDialogIcon(dialogType) ?? null;
    }
    return config.autoIcons ? defaultDialogIcon(dialogType) : null;
  }

  function resolveButtons(spec: OpenDialogSpec): ButtonConfig[] {
    const overrides = spec.config.buttons;
    if (!overrides) {
      return spec.buttons;
    }

    return spec.buttons.map((button) => {
      const customText = overrides[button.overrideKey];
      return customText ? { ...button, text: customText } : button;
    });
  }

  function getStyles(spec: OpenDialogSpec): string | null {
    return spec.config.styles ?? null;
  }

  function actionFor(id: symbol): "ok" | "confirm" | "decline" | null {
    if (id === symbolOk) return "ok";
    if (id === symbolConfirm) return "confirm";
    if (id === symbolDecline) return "decline";
    return null; // cancel
  }

  // Non-form dialogs only: forms route confirm/cancel through formFlow, so no form-data
  // path is needed here.
  function finish(id: symbol, resolve: (value: AnyDialogResult) => void): void {
    const action = actionFor(id);
    if (action === null) {
      resolve({ canceled: true, aborted: false }); // cancel button / close / Esc
    } else {
      resolve({ canceled: false, action });
    }
  }

  function showDialog(
    spec: OpenDialogSpec,
    resolve: (value: AnyDialogResult) => void,
    formFlow?: FormFlow,
    cleanupSignal?: AbortSignal,
  ): void {
    clearTimeout(spinnerTimer);

    const userSignal = combineSignals(scopeSignal, spec.config.abortSignal);

    const settleAborted = (): void => {
      teardownCurrent();
      if (formFlow) formFlow.abort();
      else resolve({ canceled: true, aborted: true });
    };

    if (userSignal?.aborted) {
      settleAborted();
      return;
    }

    realDialogShown = true;

    // Reusing the current element (spinner placeholder or the previous dialog): just
    // stop the previous button's pending spinner. The element swaps its view in place.
    clearPendingSpinner?.();
    clearPendingSpinner = null;

    const buttons = resolveButtons(spec);
    const cfg = spec.config;

    // Async so `cfg.validate` (a caller-owned pre-submit check, e.g. a validation
    // library) can be awaited; its result gates the same way native constraint
    // validation already does. Not awaited by its caller below — same fire-and-forget
    // shape as the reject-message flow, with `stopSpinner` covering the wait either way.
    const onButtonClicked = async (
      button: ButtonConfig,
      stopSpinner: () => void,
    ): Promise<void> => {
      let form: HTMLFormElement | null = null;

      if (spec.allowsForm && button.validate) {
        form = handle?.getForm() ?? null;
        form?.requestSubmit();
        const nativelyValid = form?.reportValidity() ?? true;

        if (!nativelyValid) {
          stopSpinner(); // keep the dialog open so the user can fix the form
          return;
        }

        const validate = (cfg as FormDialogConfig<any>).validate;
        if (validate && !(await validate(form!))) {
          stopSpinner(); // caller's own validation failed; it owns showing why
          return;
        }
      }

      // Form dialogs route through the interaction flow (auto-accept or iterator).
      if (formFlow) {
        if (button.id === symbolConfirm) {
          const data = form ? new FormDialogData(form) : new FormDialogData();
          formFlow.submit(data, handle!, stopSpinner);
        } else {
          formFlow.cancel();
        }
        return;
      }

      finish(button.id, resolve);
    };

    const buttonViews: DialogButtonView[] = buttons.map((button, index) => ({
      type: button.type,
      text: button.text ?? getText(button.defaultTextKey),
      onClick: () => {
        const timer = setTimeout(
          () => handle?.setButtonLoading(index, true),
          BUTTON_SPINNER_DELAY_MS,
        );
        const stopSpinner = () => {
          clearTimeout(timer);
          handle?.setButtonLoading(index, false);
        };
        clearPendingSpinner = () => clearTimeout(timer);
        void onButtonClicked(button, stopSpinner);
      },
    }));

    // Escape and the close (X) button resolve as cancel. If the dialog has a Cancel
    // button, drive its exact click path so the pending spinner shows on it, just like
    // a real click. Otherwise (e.g. info/success with only an OK button) there's no
    // button to attach a spinner to, so resolve as canceled directly.
    const cancelIndex = buttons.findIndex(
      (button) => button.id === symbolCancel,
    );
    const closeAsCancel = () => {
      if (cancelIndex >= 0) {
        buttonViews[cancelIndex].onClick();
      } else if (formFlow) {
        formFlow.cancel();
      } else {
        finish(symbolCancel, resolve);
      }
    };

    const view: DialogView = {
      id: dialogId,
      themeVars,
      dialogType: spec.dialogType,
      styles: getStyles(spec),
      icon: iconFor(spec.dialogType, spec.config),
      title: cfg.title ?? getText(spec.defaultTitle),
      subtitle: cfg.subtitle,
      intro: cfg.intro,
      content: cfg.content,
      outro: cfg.outro,
      hasForm: spec.allowsForm,
      buttons: buttonViews,
      // Enter triggers the primary (first) button — except on critical dialogs, where
      // there's no default so a destructive action can't be confirmed by accident.
      defaultButtonIndex: spec.dialogType.endsWith("Critical") ? null : 0,
      render: config.render,
      adapter: config.adapter,
      onClose: closeAsCancel,
      onCancel: closeAsCancel,
    };

    if (userSignal) {
      userSignal.addEventListener("abort", settleAborted, {
        once: true,
        signal: cleanupSignal,
      });
    }

    if (handle) {
      handle.update(view); // reuse: spinner placeholder or previous dialog -> this view
    } else {
      handle = mountDialog(view);
    }
  }

  function openDialog(spec: OpenDialogSpec): Promise<AnyDialogResult> {
    return new Promise<AnyDialogResult>((resolve) => {
      // `cleanup` fires on any settlement, removing the abort listener so a long-lived
      // config/scope signal doesn't leak listeners across many dialogs.
      const cleanup = new AbortController();
      const settle = (value: AnyDialogResult) => {
        cleanup.abort();
        resolve(value);
      };
      showDialog(spec, settle, undefined, cleanup.signal);
    });
  }

  // Form dialogs return a FormInteraction: awaiting it auto-accepts the first valid
  // submit; `for await` intercepts each submit so the caller can accept() or reject()
  // (the latter keeping the same dialog open and showing a reject message).
  function openForm(spec: OpenDialogSpec): FormInteraction<any> {
    const queue = createAttemptQueue();
    const cleanup = new AbortController();
    let iterating = false;
    let settled = false;
    let result: FormDialogResult | undefined;
    let resolveResult!: (value: FormDialogResult) => void;

    const resultPromise = new Promise<FormDialogResult>((resolve) => {
      resolveResult = resolve;
    });

    const settle = (value: FormDialogResult): void => {
      if (settled) return;
      settled = true;
      result = value;
      resolveResult(value);
      queue.end();
      cleanup.abort();
    };

    const formFlow: FormFlow = {
      submit(data, dialogHandle, stopSpinner) {
        if (iterating) {
          queue.push({
            data,
            accept() {
              settle({ canceled: false, action: "confirm", data });
            },
            reject(message, title) {
              stopSpinner();
              dialogHandle.raiseRejectMessage({ title, message });
            },
          });
        } else {
          settle({ canceled: false, action: "confirm", data });
        }
      },
      cancel() {
        settle({ canceled: true, aborted: false });
      },
      abort() {
        settle({ canceled: true, aborted: true });
      },
    };

    showDialog(spec, () => {}, formFlow, cleanup.signal);

    const interaction = resultPromise as FormInteraction<any>;
    Object.defineProperty(interaction, Symbol.asyncIterator, {
      value: () => {
        iterating = true;
        return queue.iterator();
      },
    });
    Object.defineProperty(interaction, "result", {
      get: () => result,
    });
    return interaction;
  }

  // Every dialog type maps to its button row; the title key ("titleInfo", ...)
  // and form-ness derive from the type name, so one small spec builder replaces
  // twelve hand-written openDialog/openForm blocks.
  const dialogButtons: Record<DialogType, ButtonConfig[]> = {
    info: [okBtn],
    success: [okBtn],
    warn: [okBtnDanger],
    error: [okBtnDanger],
    confirm: [confirmBtn, cancelBtn],
    confirmCritical: [confirmBtnDanger, cancelBtn],
    decide: [yesBtn, noBtn, cancelBtn],
    decideCritical: [yesBtnDanger, noBtn, cancelBtn],
    form: [confirmBtn, cancelBtn],
    formCritical: [confirmBtnDanger, cancelBtn],
  };

  const spec = (
    dialogType: DialogType,
    config: BaseDialogConfig<any>,
  ): OpenDialogSpec => ({
    dialogType,
    defaultTitle:
      `title${dialogType[0].toUpperCase()}${dialogType.slice(1)}` as TextKey,
    config,
    buttons: dialogButtons[dialogType],
    allowsForm: dialogType.startsWith("form"),
  });

  const scope = {
    info: (c) => openDialog(spec("info", c)) as Promise<InfoDialogResult>,
    success: (c) =>
      openDialog(spec("success", c)) as Promise<SuccessDialogResult>,
    warn: (c) => openDialog(spec("warn", c)) as Promise<WarnDialogResult>,
    error: (c) => openDialog(spec("error", c)) as Promise<ErrorDialogResult>,
    confirm: (c) =>
      openDialog(spec("confirm", c)) as Promise<ConfirmDialogResult>,
    confirmCritical: (c) =>
      openDialog(spec("confirmCritical", c)) as Promise<ConfirmDialogResult>,
    decide: (c) => openDialog(spec("decide", c)) as Promise<DecideDialogResult>,
    decideCritical: (c) =>
      openDialog(spec("decideCritical", c)) as Promise<DecideDialogResult>,
    form: (c) => openForm(spec("form", c)) as Promise<FormDialogResult>,
    formCritical: (c) =>
      openForm(spec("formCritical", c)) as Promise<FormDialogResult>,
    formAttempts: (c) => openForm(spec("form", c)),
    formCriticalAttempts: (c) => openForm(spec("formCritical", c)),

    close(): void {
      scopeLifetime.abort();
      clearTimeout(spinnerTimer);
      clearPendingSpinner?.();
      clearPendingSpinner = null;
      void handle?.close();
      handle = null;
    },
  } as DialogScope<C>;

  // Alias the disposer to close() so the scope works with `using` — but only where the
  // runtime actually provides Symbol.dispose. There's no polyfill, so on older runtimes
  // nothing is set (and no bogus "undefined" key is created); call close() directly there.
  if (typeof Symbol.dispose === "symbol") {
    scope[Symbol.dispose] = () => scope.close();
  }

  return scope;
}
