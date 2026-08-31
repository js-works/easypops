// -------------------------------------------------------------------
// The dialogs controller and its scopes: pure orchestration over the presentational
// element (see element.ts). Turns caller config into DialogSpecs for the configured
// adapter, routes button clicks, aborts, and the form retry/interaction flow.
// -------------------------------------------------------------------

import { toCssVariable } from "../../internal/css.js";

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
import { mountDialog } from "../element/element.js";
import { FormDialogData } from "../contract/form-data.js";
import { defaultDialogIcon } from "../element/icons.js";
import { BUTTON_SPINNER_DELAY_MS, SPINNER_DIALOG_DELAY_MS } from "../element/styles.js";
import { bundledDialogText } from "../../i18n/texts.js";
import type {
  DialogAdapterFactory,
  DialogSlots,
  DialogSpec,
} from "../contract/adapter.js";
import type { Renderable } from "../contract/content.js";
import type { TextKey } from "../contract/texts.js";
import type {
  DialogButtonView,
  DialogMount,
  ResolvedNote,
} from "../contract/view.js";
import type { DialogViewConfig } from "../contract/dialog.js";
import type {
  AnyDialogResult,
  DialogConfig,
  ConfirmDialogResult,
  DecideDialogResult,
  DialogScope,
  DialogsController,
  DialogsControllerConfig,
  DialogType,
  FormAttempt,
  FormDialogConfig,
  FormDialogResult,
  DialogHandle,
  FormDialogHandle,
  MessageDialogResult,
} from "../contract/dialog.js";

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

// Duck-typed rather than `instanceof Promise`: a validator may hand back a thenable from
// another realm or from a promise library, and both must take the async path.
function isPromiseLike(value: unknown): value is PromiseLike<boolean> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PromiseLike<boolean>).then === "function"
  );
}

// A minimal single-consumer async queue: form submits are pushed in; the caller's
// `for await` pulls them out. `end()` completes the iteration (on accept or cancel).
interface AttemptQueue {
  push(attempt: FormAttempt): void;
  end(): void;
  iterator(): AsyncIterator<FormAttempt>;
}

function createAttemptQueue(): AttemptQueue {
  const buffer: FormAttempt[] = [];
  let waiting: ((r: IteratorResult<FormAttempt>) => void) | null = null;
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
          return new Promise<IteratorResult<FormAttempt>>((resolve) => {
            waiting = resolve;
          });
        },
      };
    },
  };
}

// Flow used by form dialogs to route confirm/cancel/abort through the retry interaction.
// `raiseReject` is handed in per submit rather than taken from the handle: the note is
// view state of the dialog that produced this attempt, so it belongs to that dialog's
// spec builder.
interface FormFlow {
  submit(
    data: FormDialogData,
    raiseReject: (note: ResolvedNote) => void,
    stopSpinner: () => void,
  ): void;
  cancel(): void;
  abort(): void;
}

// -------------------------------------------------------------------
// # Controller
// -------------------------------------------------------------------

export function createDialogsController<C extends object>(
  config: DialogsControllerConfig<C>,
): DialogsController<C> {
  // Every live scope, so `abortAll()` can reach them. A scope takes itself out on dispose,
  // which is the common path — the set is normally empty.
  const scopes = new Set<DialogScope<C>>();

  const open = (signal?: AbortSignal): DialogScope<C> => {
    const scope: DialogScope<C> = createDialogScope(config, signal, () =>
      scopes.delete(scope),
    );
    scopes.add(scope);
    return scope;
  };

  // Direct (non-scoped) calls open a throwaway scope and dispose it once the dialog
  // settles. The handle is returned as-is — `.then()` would give back a bare promise and
  // drop `update`, `abort` and (for forms) the async iterator.
  const oneShot = <H extends PromiseLike<unknown>>(
    run: (scope: DialogScope<C>) => H,
  ): H => {
    const scope = open();
    const handle = run(scope);
    void Promise.resolve(handle).then(
      () => scope.dispose(),
      () => scope.dispose(),
    );
    return handle;
  };

  return {
    open,
    abortAll: () => {
      // Copy first: disposing a scope removes it from the set as we iterate.
      for (const scope of [...scopes]) {
        scope.dispose();
      }
      scopes.clear();
    },
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
    drawer: (c) => oneShot((s) => s.drawer(c)),
    drawerCritical: (c) => oneShot((s) => s.drawerCritical(c)),
  };
}

// -------------------------------------------------------------------
// # Scope
// -------------------------------------------------------------------

interface OpenDialogSpec {
  dialogType: DialogType;
  defaultTitle: TextKey;
  config: DialogConfig<any>;
  buttons: ButtonConfig[];
  allowsForm: boolean;
}

// Only form-bearing dialogs can turn it off; everything else has no form to validate, so
// the flag is true for them and the adapters never see a difference.
function nativeValidation(spec: OpenDialogSpec): boolean {
  if (!spec.allowsForm) {
    return true;
  }
  return (spec.config as FormDialogConfig<any>).nativeValidation !== false;
}

// Monotonic, collision-free per-scope id (used as a DOM element id).
let dialogInstanceCounter = 0;

function createDialogScope<C extends object>(
  config: DialogsControllerConfig<C>,
  scopeSignal?: AbortSignal,
  onClosed?: () => void,
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

  // The adapter renders every dialog of this scope. Erased to `any` here — the public
  // API stays typed on `C`, only this internal plumbing is not (see content.ts).
  const adapterFactory = config.adapter as DialogAdapterFactory<any>;

  // One element for the whole scope: it's reused across every dialog so the modal stays
  // open and the backdrop never drops between dialogs.
  let handle: DialogMount | null = null;
  let realDialogShown = false;

  // Rebuilds the spec of whatever is on screen. Set when a dialog is shown, cleared when
  // it goes away — the adapter reaches it through `requestRender`.
  let currentRefresh: (() => void) | null = null;

  const ensureHandle = (): DialogMount =>
    (handle ??= mountDialog(dialogId, adapterFactory, () => currentRefresh?.()));

  const noop = (): void => {};

  const emptySlots = (): DialogSlots<any> => ({
    icon: null,
    title: null,
    subtitle: null,
    intro: null,
    content: null,
    outro: null,
    note: null,
  });

  // Clears the pending 150ms button spinner of whichever button most recently triggered
  // a transition (set on click, cleared on the next open / on dispose).
  let clearPendingSpinner: (() => void) | null = null;

  // The scope's own lifetime, aborted by close(). It is folded into every dialog's abort
  // signal, so tearing the scope down settles whatever is still on screen as
  // `{ canceled: true, aborted: true }` rather than leaving its caller awaiting a promise
  // that can no longer be answered — there is nothing left to click. It doubles as the
  // removal signal for the scope-level listener below.
  const scopeLifetime = new AbortController();

  // If nothing opens within the delay, show the round spinner dialog as a placeholder.
  // It goes through the adapter like any other dialog, so the element (and its open
  // <dialog>, and so the backdrop) carries straight on into the first real one.
  const spinnerTimer = setTimeout(() => {
    if (!realDialogShown && !handle) {
      ensureHandle().show({
        props: {
          dialogType: "info",
          themeVars,
          styles: null,
          hasForm: false,
          nativeValidation: true,
          buttons: [],
          defaultButtonIndex: null,
          spinnerOnly: true,
          render: config.render,
          onClose: noop,
          onCancel: noop,
          note: null,
          onNoteDismiss: noop,
        },
        slots: emptySlots(),
      });
    }
  }, SPINNER_DIALOG_DELAY_MS);

  // Close whatever is currently on screen and forget it. Used by abort and dispose.
  const teardownCurrent = (): void => {
    clearTimeout(spinnerTimer);
    clearPendingSpinner?.();
    clearPendingSpinner = null;
    currentRefresh = null;
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

  // A caller's resolver still wins outright. Without one — or for a key it declines — the
  // bundled table for <html lang> answers, and English behind that.
  function getText(textKey: TextKey): string {
    return config.getText?.(textKey) ?? bundledDialogText(textKey);
  }

  // `true` -> the built-in icon for this type, `false` -> none, content -> as-is,
  // `undefined` -> not decided here (the caller of this defers to the next level).
  function resolveIcon(
    dialogType: DialogType,
    value: Renderable<any> | boolean | undefined,
  ): Renderable<any> | undefined {
    if (value === true) return defaultDialogIcon(dialogType);
    if (value === false) return null;
    return value;
  }

  // A per-dialog `icon` wins over the controller's `icons` policy; both speak the same
  // three-value language, so resolving them is the same step twice.
  function iconFor(
    dialogType: DialogType,
    dialogConfig: DialogConfig<any>,
  ): Renderable<any> {
    const perDialog = resolveIcon(dialogType, dialogConfig.icon);
    if (perDialog !== undefined) return perDialog;

    const policy = config.icons;
    const fromPolicy =
      typeof policy === "function"
        ? resolveIcon(dialogType, policy(dialogType))
        : resolveIcon(dialogType, policy);
    return fromPolicy ?? null;
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
      resolve({ canceled: false, action, data: undefined });
    }
  }

  // Returns a function that re-renders the live dialog after its config is patched.
  function showDialog(
    spec: OpenDialogSpec,
    resolve: (value: AnyDialogResult) => void,
    formFlow?: FormFlow,
    cleanupSignal?: AbortSignal,
    localAbort?: AbortSignal,
  ): (patch: Partial<DialogViewConfig<any>>) => void {
    clearTimeout(spinnerTimer);

    const userSignal = combineSignals(
      scopeLifetime.signal,
      scopeSignal,
      spec.config.abortSignal,
      localAbort,
    );

    const settleAborted = (): void => {
      teardownCurrent();
      if (formFlow) formFlow.abort();
      else resolve({ canceled: true, aborted: true });
    };

    if (userSignal?.aborted) {
      settleAborted();
      // Already aborted, so nothing was mounted and there is nothing to re-render.
      return () => {};
    }

    realDialogShown = true;

    // Reusing the current element (spinner placeholder or the previous dialog): just
    // stop the previous button's pending spinner. The element swaps its view in place.
    clearPendingSpinner?.();
    clearPendingSpinner = null;

    const buttons = resolveButtons(spec);
    const cfg = spec.config;

    // Set from the moment a validating button is clicked until its handler is done —
    // through native validation, a possibly async `validate()`, and the attempt that
    // follows. A second activation in that window would run validation twice and, on a
    // form dialog being iterated, queue a second attempt.
    //
    // The element also turns the buttons inert while busy, but that cannot be the guard:
    // it follows `loading`, which only becomes true after BUTTON_SPINNER_DELAY_MS, so the
    // first 150ms — where a double click actually lands — would be unprotected. The inert
    // is the affordance; this flag is the rule.
    //
    // Only validating buttons claim it. Cancel, Escape and the close button stay live, so
    // a slow validator or server cannot trap the user in the dialog.
    let busy = false;

    const onButtonClicked = (
      button: ButtonConfig,
      stopSpinner: () => void,
    ): void => {
      let form: HTMLFormElement | null = null;

      // Everything past a passed validation. Extracted because the async path reaches it
      // from a promise callback rather than by falling through.
      const proceed = (): void => {
        // Form dialogs route through the interaction flow (auto-accept or iterator).
        if (formFlow) {
          if (button.id === symbolConfirm) {
            const data = form ? new FormDialogData(form) : new FormDialogData();
            formFlow.submit(data, raiseNote, stopSpinner);
          } else {
            formFlow.cancel();
          }
          return;
        }

        finish(button.id, resolve);
      };

      if (spec.allowsForm && button.validate) {
        form = handle?.getForm() ?? null;
        form?.requestSubmit();

        // Skipped entirely when the caller turned native validation off: the form carries
        // `novalidate`, so requestSubmit() above no longer gates on constraints either,
        // and the validator below is the only verdict.
        if (nativeValidation(spec)) {
          const nativelyValid = form?.reportValidity() ?? true;

          if (!nativelyValid) {
            stopSpinner(); // keep the dialog open so the user can fix the form
            return;
          }
        }

        const validator = (cfg as FormDialogConfig<any>).validator;
        if (validator) {
          const verdict = validator.validate(form!);

          if (isPromiseLike(verdict)) {
            // The spinner — and the busy flag with it — deliberately keep running into
            // proceed(): a form dialog hands stopSpinner() on to the attempt, so the
            // server round-trip continues the same spinner the validation started.
            Promise.resolve(verdict).then(
              (valid) => {
                // Cancel, Escape or an abort may have settled the dialog while we
                // waited. cleanupSignal is the one thing that fires on every
                // settlement, so a late verdict is dropped rather than submitting a
                // dialog the user already dismissed.
                if (cleanupSignal?.aborted || !valid) {
                  stopSpinner();
                  if (!cleanupSignal?.aborted) {
                    handle?.focusFirstInvalid();
                  }
                  return;
                }
                proceed();
              },
              (error: unknown) => {
                stopSpinner(); // as invalid: the dialog stays open
                // Not swallowed. A synchronous validator that throws propagates out of
                // the click handler; rethrowing from a fresh task gives the async one
                // the same visibility, instead of an unhandled rejection nobody sees.
                queueMicrotask(() => {
                  throw error;
                });
              },
            );
            return;
          }

          if (!verdict) {
            stopSpinner(); // caller's own validation failed; it owns showing why
            // ...but not where to look next: focus goes back to the marked field, so the
            // user can start fixing without hunting for it.
            handle?.focusFirstInvalid();
            return;
          }
        }
      }

      proceed();
    };

    // Busy state lives here, not in the element: it is view state like any other, so it
    // travels in the spec and the adapter renders it — which is what lets a caller's own
    // action button show its own spinner.
    const setLoading = (index: number, loading: boolean): void => {
      const target = buttonViews[index];
      if (!target || target.loading === loading) {
        return;
      }
      target.loading = loading;
      rerender();
    };

    const buttonViews: DialogButtonView[] = buttons.map((button, index) => ({
      role: button.overrideKey,
      type: button.type,
      loading: false,
      text: button.text ?? getText(button.defaultTextKey),
      onClick: () => {
        // Claimed before the spinner timer even starts, so the guard covers the window
        // the delayed `inert` cannot. A dropped click starts no timer either, so it
        // leaves no flash behind.
        const claimsBusy = spec.allowsForm && button.validate;
        if (claimsBusy && busy) {
          return;
        }

        const timer = setTimeout(
          () => setLoading(index, true),
          BUTTON_SPINNER_DELAY_MS,
        );
        // Per click, so releasing is idempotent and a button that never claimed the flag
        // can't release someone else's.
        let holdsBusy = claimsBusy;
        busy ||= claimsBusy;

        const stopSpinner = () => {
          clearTimeout(timer);
          setLoading(index, false);
          if (holdsBusy) {
            holdsBusy = false;
            busy = false;
          }
        };
        clearPendingSpinner = () => clearTimeout(timer);
        onButtonClicked(button, stopSpinner);
      },
    }));

    // Escape and the close (X) button. If the dialog has a Cancel button, drive its exact
    // click path so the pending spinner shows on it, just like a real click.
    //
    // Otherwise the dialog is a message (info/success/warn/error — only an OK button), and
    // there is nothing to cancel: dismissing a message *is* acknowledging it, so Escape
    // resolves as "ok" rather than as canceled. A dialog can be canceled exactly when it
    // has a Cancel button; for the message dialogs the canceled branch is reachable only
    // by abort.
    const cancelIndex = buttons.findIndex(
      (button) => button.id === symbolCancel,
    );
    const closeAsCancel = () => {
      if (cancelIndex >= 0) {
        buttonViews[cancelIndex].onClick();
      } else if (formFlow) {
        formFlow.cancel();
      } else {
        finish(symbolOk, resolve);
      }
    };

    // The note (see FormAttempt.reject) is view state of this dialog, so it
    // lives here and is rendered from the spec like everything else. The element owns
    // only the box and its collapse; when the user dismisses it, it says so and this
    // drops it — which is what lets the *same* message be raised again afterwards.
    let note: ResolvedNote | null = null;

    const raiseNote = (value: ResolvedNote): void => {
      note = value;
      rerender();
    };

    const dismissNote = (): void => {
      if (!note) return;
      note = null;
      rerender();
    };

    // The built-in icons are fresh nodes per call, so resolving on every render would
    // hand the adapter a different value each time and defeat its identity check. Cache
    // against the config field the resolution actually depends on.
    let iconCache: { key: unknown; value: Renderable<any> } | null = null;
    // Same reasoning as the icon cache below, for the same reason: buildSpec runs on every
    // update, and a wrapper that returns a fresh value each time would break the adapters'
    // identity check on the content slot (see dom/dialog-adapter.ts) - rebuilding the
    // caller's content, and whatever the user had typed into it, on every re-render.
    // Keyed on the config value being wrapped, so a patched `content` still gets a new one.
    let contentCache: { key: unknown; value: Renderable<any> } | null = null;
    const resolveContent = (): Renderable<any> => {
      const raw = spec.config.content;
      if (raw == null || !config.wrapContent) {
        return raw;
      }
      if (!contentCache || contentCache.key !== raw) {
        contentCache = {
          key: raw,
          value: config.wrapContent(raw, {
            dialogType: spec.dialogType,
            hasForm: spec.allowsForm,
          }),
        };
      }
      return contentCache.value;
    };

    const resolveIcon = (): Renderable<any> => {
      const key = spec.config.icon;
      if (!iconCache || iconCache.key !== key) {
        iconCache = { key, value: iconFor(spec.dialogType, spec.config) };
      }
      return iconCache.value;
    };

    // Reads spec.config fresh on every call, so an update() only has to mutate the config
    // and re-run this.
    const buildSpec = (): DialogSpec<any> => ({
      props: {
        dialogType: spec.dialogType,
        themeVars,
        styles: getStyles(spec),
        hasForm: spec.allowsForm,
        nativeValidation: nativeValidation(spec),
        buttons: buttonViews,
        // Enter triggers the primary (first) button — except on critical dialogs, where
        // there's no default so a destructive action can't be confirmed by accident.
        defaultButtonIndex: spec.dialogType.endsWith("Critical") ? null : 0,
        spinnerOnly: false,
        note,
        render: config.render,
        onClose: closeAsCancel,
        onCancel: closeAsCancel,
        onNoteDismiss: dismissNote,
      },
      slots: {
        icon: resolveIcon(),
        title: spec.config.title ?? getText(spec.defaultTitle),
        subtitle: spec.config.subtitle,
        intro: spec.config.intro,
        content: resolveContent(),
        outro: spec.config.outro,
        note: null,
      },
    });

    const rerender = (): void => handle?.update(buildSpec());

    if (userSignal) {
      userSignal.addEventListener("abort", settleAborted, {
        once: true,
        signal: cleanupSignal,
      });
    }

    // Re-render from the current config — used both by the patch function below and by
    // the adapter's `requestRender`. Button *text* is refreshed in place rather than by
    // rebuilding buttonViews: that array is captured by closeAsCancel, the form flow and
    // every per-button onClick, so its identity has to survive. Slots whose value is
    // unchanged are diffed rather than rebuilt by the adapter, which is what keeps the
    // caller's content — and anything typed into it — intact.
    const refresh = (): void => {
      resolveButtons(spec).forEach((button, index) => {
        const target = buttonViews[index];
        if (target) {
          target.text = button.text ?? getText(button.defaultTextKey);
        }
      });
      rerender();
    };
    currentRefresh = refresh;

    // One call whether this is the scope's first dialog, a swap from the spinner
    // placeholder, or a swap from the previous dialog: the mount layer crossfades
    // whatever is already on screen and the element never closes.
    ensureHandle().show(buildSpec());

    // Re-render the live dialog from a patched config.
    return (patch: Partial<DialogViewConfig<any>>): void => {
      Object.assign(spec.config, patch);
      refresh();
    };
  }

  function openDialog(spec: OpenDialogSpec): DialogHandle<any, any> {
    // `cleanup` fires on any settlement, removing the abort listener so a long-lived
    // config/scope signal doesn't leak listeners across many dialogs. `localAbort` is the
    // handle's own abort(), folded into the same signal the caller's would use.
    const cleanup = new AbortController();
    const localAbort = new AbortController();
    let settled = false;
    let resolveResult!: (value: AnyDialogResult) => void;
    const result = new Promise<AnyDialogResult>((resolve) => {
      resolveResult = resolve;
    });

    const settle = (value: AnyDialogResult): void => {
      if (settled) return;
      settled = true;
      cleanup.abort();
      resolveResult(value);
    };

    const rerender = showDialog(
      spec,
      settle,
      undefined,
      cleanup.signal,
      localAbort.signal,
    );

    // A plain object, not a Promise with properties attached: `PromiseLike` is all the
    // contract asks for, so everything here is checked by the compiler.
    return {
      get pending() {
        return !settled;
      },
      abort: () => localAbort.abort(),
      update: (patch) => {
        if (!settled) rerender(patch);
      },
      then: (onFulfilled, onRejected) =>
        result.then(onFulfilled as any, onRejected),
    };
  }

  // Form dialogs return a FormDialogHandle: awaiting it auto-accepts the first valid
  // submit; `for await` intercepts each submit so the caller can accept() or reject()
  // (the latter keeping the same dialog open and showing a note).
  function openForm(spec: OpenDialogSpec): FormDialogHandle<any> {
    const queue = createAttemptQueue();
    const cleanup = new AbortController();
    const localAbort = new AbortController();
    let iterating = false;
    let settled = false;
    let resolveResult!: (value: FormDialogResult) => void;

    const resultPromise = new Promise<FormDialogResult>((resolve) => {
      resolveResult = resolve;
    });

    const settle = (value: FormDialogResult): void => {
      if (settled) return;
      settled = true;
      resolveResult(value);
      queue.end();
      cleanup.abort();
    };

    const formFlow: FormFlow = {
      submit(data, raiseReject, stopSpinner) {
        if (iterating) {
          queue.push({
            data,
            accept(replacement) {
              settle({
                canceled: false,
                action: "confirm",
                data: replacement ?? data,
              });
            },
            reject(message, title) {
              stopSpinner();
              raiseReject({ title, message });
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

    const rerender = showDialog(
      spec,
      () => {},
      formFlow,
      cleanup.signal,
      localAbort.signal,
    );

    // Same plain-object shape as openDialog, plus the async iterator. `iterating` flips
    // only when someone actually starts a `for await`, which is what decides between
    // auto-accepting the first valid submit and handing each one to the caller.
    const interaction: FormDialogHandle<any> = {
      get pending() {
        return !settled;
      },
      abort: () => localAbort.abort(),
      update: (patch) => {
        if (!settled) rerender(patch);
      },
      then: (onFulfilled, onRejected) =>
        resultPromise.then(onFulfilled as any, onRejected),
      [Symbol.asyncIterator]: () => {
        iterating = true;
        return queue.iterator();
      },
    };
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
    drawer: [confirmBtn, cancelBtn],
    drawerCritical: [confirmBtnDanger, cancelBtn],
  };

  const spec = (
    dialogType: DialogType,
    config: DialogConfig<any>,
  ): OpenDialogSpec => ({
    dialogType,
    defaultTitle:
      `title${dialogType[0].toUpperCase()}${dialogType.slice(1)}` as TextKey,
    config,
    buttons: dialogButtons[dialogType],
    // Drawers are form dialogs on another surface, so they get the <form> wrapper too.
    allowsForm:
      dialogType.startsWith("form") || dialogType.startsWith("drawer"),
  });

  const scope = {
    info: (c) => openDialog(spec("info", c)) as DialogHandle<MessageDialogResult, C>,
    success: (c) =>
      openDialog(spec("success", c)) as DialogHandle<MessageDialogResult, C>,
    warn: (c) => openDialog(spec("warn", c)) as DialogHandle<MessageDialogResult, C>,
    error: (c) => openDialog(spec("error", c)) as DialogHandle<MessageDialogResult, C>,
    confirm: (c) =>
      openDialog(spec("confirm", c)) as DialogHandle<ConfirmDialogResult, C>,
    confirmCritical: (c) =>
      openDialog(spec("confirmCritical", c)) as DialogHandle<ConfirmDialogResult, C>,
    decide: (c) => openDialog(spec("decide", c)) as DialogHandle<DecideDialogResult, C>,
    decideCritical: (c) =>
      openDialog(spec("decideCritical", c)) as DialogHandle<DecideDialogResult, C>,
    form: (c) => openForm(spec("form", c)),
    formCritical: (c) => openForm(spec("formCritical", c)),
    drawer: (c) => openForm(spec("drawer", c)),
    drawerCritical: (c) => openForm(spec("drawerCritical", c)),

    dispose(): void {
      // Aborting first is what settles any dialog still pending (see scopeLifetime); its
      // listener tears the element down, so the close below is usually a no-op.
      scopeLifetime.abort();
      clearTimeout(spinnerTimer);
      clearPendingSpinner?.();
      clearPendingSpinner = null;
      void handle?.close();
      handle = null;
      onClosed?.();
    },
  } as DialogScope<C>;

  // Alias the disposer to dispose() so the scope works with `using`. The well-known symbol
  // where the runtime has it, otherwise the registry key TypeScript's own downlevel helper
  // looks for — so a consumer compiling `using` to an older target still finds it.
  // Unconditional either way: the type promises the member, so it has to be there.
  const disposeKey: symbol = Symbol.dispose ?? Symbol.for("Symbol.dispose");
  (scope as unknown as Record<symbol, () => void>)[disposeKey] = () =>
    scope.dispose();

  return scope;
}
