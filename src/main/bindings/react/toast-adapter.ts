// -------------------------------------------------------------------
// React rendering adapter for the toasts core.
// -------------------------------------------------------------------
//
// The core owns state, timers, the custom element, hover/dismiss/action delegation and
// the animations; this only projects the keyed list of views into the stack container —
// through a portal the provider owns, so rendering a toast is a setState.

import { createElement } from "react";
import { flushSync } from "react-dom";
import type { ReactNode } from "react";
import type { ToastAdapterFactory, ToastView } from "../../toasts/contract/view.js";
import type { PortalStore } from "./portals.js";

/**
 * Content a React toast accepts: anything React can render. Wider than the dialog side's
 * {@link ReactContent}, which the dialogs core constrains to an object — toasts take `C`
 * bare (there is no `| string` in their content union), so the whole `ReactNode` is both
 * usable and necessary for a plain-string message to type-check.
 */
export type ReactToastContent = ReactNode;

export function createToastAdapter(
  store: PortalStore,
): ToastAdapterFactory<ReactToastContent> {
  return ({ container, tag }) => {
    const id = store.nextId();
    return {
      render(views) {
        // Synchronous commit: right after this returns the core reads hosts back by
        // `data-id` to start the enter transform and to measure FLIP positions.
        flushSync(() => {
          store.set(id, container, views.map((view) => host(tag, view)));
        });
      },
      destroy() {
        flushSync(() => store.remove(id));
      },
    };
  };
}

function host(tag: string, view: ToastView<ReactToastContent>): ReactNode {
  const children: ReactNode[] = [];
  const slot = (key: string, name: string, content: ReactNode): void => {
    children.push(createElement("span", { key, slot: name }, content));
  };

  if (view.icon !== null) slot("i", "icon", view.icon);
  if (view.severity !== null) slot("s", "severity", view.severity);
  if (view.title !== null) slot("t", "title", view.title);
  slot("m", "content", view.message);

  // Action clicks are delegated by the core, keyed by data-action-index — the adapter
  // only renders labels.
  view.actions.forEach((action, index) => {
    children.push(
      createElement(
        "button",
        {
          key: `a${index}`,
          slot: "action",
          type: "button",
          "data-action-index": index,
        },
        action.label,
      ),
    );
  });

  return createElement(
    tag,
    {
      key: view.id,
      "data-id": view.id,
      type: view.type,
      role: view.role,
      duration: view.duration,
      "dismiss-label": view.dismissLabel,
      "icon-mode": view.iconMode,
      dismissible: String(view.dismissible),
      count: view.count,
      "has-actions": view.actions.length > 0 ? "" : undefined,
      appearance: view.appearance,
    },
    ...children,
  );
}
