// -------------------------------------------------------------------
// EasyPopsProvider and its hooks.
// -------------------------------------------------------------------
//
// One provider owns both features: it builds the controllers, binds their adapters to a
// portal registry, and renders whatever those adapters describe. Dialogs and toasts then
// render inside your React tree — same context, same theme provider, same error
// boundary — even though the elements themselves live at the end of <body>, where a
// modal <dialog> and a fixed toast stack have to be.

import {
  createContext,
  createElement,
  Fragment,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { ReactElement, ReactNode } from "react";

import { createDialogsController } from "../../dialogs/dialogs.js";
import { createToastController } from "../../toasts/toasts.js";
import type { DialogsController, DialogsControllerConfig } from "../../dialogs/dialogs.js";
import type { ToastController, ToastControllerOptions } from "../../toasts/toasts.js";

import { createDialogAdapter } from "./dialog-adapter.js";
import { createToastAdapter } from "./toast-adapter.js";
import { createPortalStore, usePortalEntries } from "./portals.js";
import type { PortalStore } from "./portals.js";
import type { ReactContent } from "./dialog-adapter.js";
import type { ReactToastContent } from "./toast-adapter.js";

/**
 * Set-up for both features, minus the adapters — the provider supplies those.
 *
 * Live: change it and the change applies, with no remount and nothing on screen thrown
 * away. Dialog config is read when a dialog opens, so it takes effect from the *next*
 * one — a dialog already on screen keeps what it opened with, and whatever the user has
 * typed into it survives. Toast config is applied to the running stack immediately.
 *
 * It is deliberately one object rather than two props: there is no change detection
 * behind this (the current values are simply written through on every commit), so an
 * inline `config={{…}}` — a fresh object on every render — is free and safe.
 */
export interface EasyPopsConfig {
  dialogs?: Omit<DialogsControllerConfig<ReactContent>, "adapter">;
  toasts?: Omit<ToastControllerOptions<ReactToastContent>, "adapter">;
}

export interface EasyPopsProviderProps {
  /** Optional: omit it entirely for the built-in defaults. */
  config?: EasyPopsConfig;
  /**
   * Change this to re-render the dialogs that are currently on screen.
   *
   * The library's own chrome — button labels, the default title, the header icon — is
   * resolved from `config.dialogs.getText` and `.icons` when a dialog's spec is built.
   * Your *content* is React and re-renders itself, so after a language switch a dialog
   * that stays open would show translated content next to untranslated buttons. Pass the
   * value that changes and both move together:
   *
   * ```tsx
   * const { i18n } = useTranslation();
   * <EasyPopsProvider refreshKey={i18n.language} config={…}>
   * ```
   *
   * Anything comparable with `Object.is` works; nothing happens while it stays the same.
   */
  refreshKey?: unknown;
  children?: ReactNode;
}

interface EasyPops {
  dialogs: DialogsController<ReactContent>;
  toasts: ToastController<ReactToastContent>;
}

const EasyPopsContext = createContext<EasyPops | null>(null);


/**
 * Whether two toast configs would produce the same stack.
 *
 * This exists to stop a feedback loop, not as an optimisation: applying toast config
 * re-renders the stack, a stack render is a setState, and a setState is another commit —
 * so a provider that re-applied on every commit would never stop. Comparing by value
 * breaks it, and comparing *by value* is what makes an inline `config={{…}}` (a fresh
 * object every render) free.
 *
 * Functions compare equal regardless of identity, deliberately: an inline `getText`
 * arrow is new on every render and would otherwise re-open the loop. The cost is that a
 * changed `getText` alone reaches toasts already on screen only at their next render —
 * far cheaper than the alternative, and new toasts always read the current one.
 */
function sameToastConfig(a: unknown, b: unknown, depth = 2): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a === "function" && typeof b === "function") return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length &&
      a.every((value, i) => sameToastConfig(value, b[i], depth - 1))
    );
  }
  if (depth > 0 && isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => sameToastConfig(a[key], b[key], depth - 1))
    );
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The toast controller is built on first use and rebuilt after a teardown, behind a
 * facade that never goes stale. Two reasons, both about matching React's lifecycle to an
 * imperative core that touches the document the moment it is created:
 *
 * - `createToastController` appends its stack to `<body>` right away, so building one in
 *   a render that React then throws away (StrictMode double-invokes every state
 *   initializer, exactly to surface this) would leak a container. Deferring to the first
 *   *call* means a discarded render pays nothing — it never runs an event handler.
 * - StrictMode also runs mount effects twice, setup → cleanup → setup. A cleanup that
 *   destroyed a controller nothing recreates would leave toasts dead in development;
 *   clearing the holder instead makes the next call build a fresh one.
 */
function createToastHolder(store: PortalStore): {
  facade: ToastController<ReactToastContent>;
  configure: (
    options: Omit<ToastControllerOptions<ReactToastContent>, "adapter">,
  ) => void;
  teardown: () => void;
} {
  let live: ToastController<ReactToastContent> | null = null;
  let options: Omit<ToastControllerOptions<ReactToastContent>, "adapter"> = {};

  const get = (): ToastController<ReactToastContent> =>
    (live ??= createToastController<ReactToastContent>({
      ...options,
      adapter: createToastAdapter(store),
    }));

  return {
    // Written out rather than proxied: a Proxy would build the controller on any property
    // read, including a devtools inspection.
    facade: {
      info: (input: never) => get().info(input),
      success: (input: never) => get().success(input),
      warn: (input: never) => get().warn(input),
      error: (input: never) => get().error(input),
      loading: (input: never) => get().loading(input),
      promise: (promise, messages) => get().promise(promise, messages),
      clear: () => live?.clear(),
      configure: (next) => get().configure(next),
      destroy: () => {
        live?.destroy();
        live = null;
      },
    },
    // Held until the controller exists, then handed straight on. A stack that has never
    // been built has nothing to re-apply to, and building one just to configure it would
    // put an empty container in the document for an app that never toasts.
    configure: (next) => {
      const changed = !sameToastConfig(options, next);
      options = next;
      if (changed) {
        live?.configure(next);
      }
    },
    teardown: () => {
      live?.destroy();
      live = null;
    },
  };
}

export function EasyPopsProvider({
  config,
  refreshKey,
  children,
}: EasyPopsProviderProps): ReactElement {
  // Built once. The options are read when a controller is created, so changing them later
  // would silently do nothing — the same contract the vanilla API has, made explicit by
  // building in a state initializer rather than in an effect.
  //
  // `createDialogsController` is pure (it touches the document only once a dialog opens),
  // so it is safe to build here; the toast side is deferred, see createToastHolder.
  const [instance] = useState(() => {
    const store = createPortalStore();
    const holder = createToastHolder(store);
    // The object the dialogs controller reads from, kept and rewritten rather than
    // replaced: every field is read at the point of use (a theme when a scope opens, the
    // texts and icon policy per dialog), so refreshing it is all it takes for the *next*
    // dialog to see new config. Nothing on screen is touched — which is the whole point.
    // There is deliberately no change detection: the latest values are simply written on
    // every commit, so an inline `config={{…}}` object, new on every render, costs
    // nothing and triggers nothing.
    const dialogAdapter = createDialogAdapter(store);
    const liveDialogConfig: DialogsControllerConfig<ReactContent> = {
      adapter: dialogAdapter.factory,
    };
    const dialogs = createDialogsController<ReactContent>(liveDialogConfig);
    return {
      store,
      liveDialogConfig,
      refreshDialogs: dialogAdapter.refresh,
      configureToasts: holder.configure,
      teardown: () => {
        // Order matters only in that both must run: a dialog left open would otherwise
        // vanish from the page with its caller still awaiting a promise nobody can
        // answer, and the toast stack would outlive the tree that owns it.
        dialogs.abortAll();
        holder.teardown();
      },
      value: { dialogs, toasts: holder.facade } satisfies EasyPops,
    };
  });

  // Push the current config into the live controllers after every commit. A layout effect
  // rather than the render body because React can start a render and abandon it: only a
  // commit means these values are real.
  useLayoutEffect(() => {
    // Rewritten in place, so a key that disappears from `config` is genuinely gone rather
    // than lingering from an earlier render. `adapter` is the controller's, not the
    // caller's, and stays.
    // Double cast: `adapter` is required on the config, so a direct cast to an index
    // signature no longer overlaps. The loop below preserves it.
    const target = instance.liveDialogConfig as unknown as Record<string, unknown>;
    for (const key of Object.keys(target)) {
      if (key !== "adapter") delete target[key];
    }
    Object.assign(target, config?.dialogs);

    instance.configureToasts(config?.toasts ?? {});
  });

  // Rebuild the spec of every dialog on screen when `refreshKey` changes, so the chrome
  // follows whatever it depends on (a language switch, typically). Runs after the effect
  // above, so the fresh config is already in place. The mount-time run is a no-op —
  // nothing is on screen yet.
  useLayoutEffect(() => {
    instance.refreshDialogs();
  }, [instance, refreshKey]);

  // Both features put DOM in the document, outside this tree — a provider that goes away
  // has to take it with it, and settle anything its callers are still waiting on.
  useEffect(() => instance.teardown, [instance]);

  const entries = usePortalEntries(instance.store);

  return createElement(
    EasyPopsContext.Provider,
    { value: instance.value },
    children,
    createElement(
      Fragment,
      null,
      ...entries.map((entry) =>
        createPortal(entry.node, entry.container, String(entry.id)),
      ),
    ),
  );
}

function useEasyPops(hook: string): EasyPops {
  const value = useContext(EasyPopsContext);
  if (!value) {
    throw new Error(`${hook} must be used inside an <EasyPopsProvider>.`);
  }
  return value;
}

/**
 * The dialogs controller for the surrounding provider. Stable for the provider's
 * lifetime, so it is safe in a dependency array.
 */
export function useDialogs(): DialogsController<ReactContent> {
  return useEasyPops("useDialogs()").dialogs;
}

/** The toast controller for the surrounding provider. Stable, like {@link useDialogs}. */
export function useToast(): ToastController<ReactToastContent> {
  return useEasyPops("useToast()").toasts;
}
