// -------------------------------------------------------------------
// Built-in rendering adapters (lit, vanilla, React). Each projects the core's keyed list
// of ToastViews into the container it was bound to; the core owns all state and
// behaviour (see view.ts for the adapter contract).
// -------------------------------------------------------------------

import { render } from "lit-html";
import { html, unsafeStatic } from "lit-html/static.js";
import { repeat } from "lit-html/directives/repeat.js";
import type { TemplateResult } from "lit-html";
import { h } from "../internal/dom.js";
import type { ToastAdapterFactory } from "./view.js";

/**
 * lit-html adapter. Content is a lit `TemplateResult` or a plain string. The
 * keyed `repeat` is essential: an unkeyed list would let lit reuse DOM nodes by
 * position, leaking the imperative slide-out transform onto whichever
 * toast lands in that slot after a re-render.
 */
export type LitContent = string | TemplateResult;

export const litToastAdapter: ToastAdapterFactory<LitContent> = ({
  container,
  tag,
}) => {
  const staticTag = unsafeStatic(tag);

  return {
    render(views) {
      render(
        html`
          ${repeat(
            views,
            (view) => view.id,
            (view) => html`
              <${staticTag}
                data-id=${view.id}
                type=${view.type}
                role=${view.role}
                duration=${view.duration}
                dismiss-label=${view.dismissLabel}
                icon-mode=${view.iconMode}
                dismissible=${String(view.dismissible)}
                count=${view.count}
                ?has-actions=${view.actions.length > 0}
                appearance=${view.appearance}
              >
                ${
                  view.icon !== null
                    ? html`<span slot="icon">${view.icon}</span>`
                    : ""
                }
                ${
                  view.severity !== null
                    ? html`<span slot="severity">${view.severity}</span>`
                    : ""
                }
                ${
                  view.title !== null
                    ? html`<span slot="title">${view.title}</span>`
                    : ""
                }
                <span slot="content">${view.message}</span>
                ${view.actions.map(
                  (action, index) => html`
                    <button
                      slot="action"
                      type="button"
                      data-action-index=${index}
                    >
                      ${action.label}
                    </button>
                  `,
                )}
              </${staticTag}>
            `,
          )}
        `,
        container,
      );
    },
    destroy() {
      container.replaceChildren();
    },
  };
};

/**
 * Framework-free adapter. Content is a plain string or a DOM `Node`. Does its
 * own keyed reconciliation of the host list.
 */
export type VanillaContent = string | Node;

function setAttrIfChanged(el: Element, name: string, value: string) {
  // Avoid re-triggering attributeChangedCallback (e.g. re-injecting the icon)
  // when nothing actually changed.
  if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

function toggleAttr(el: Element, name: string, on: boolean) {
  if (on) {
    if (!el.hasAttribute(name)) {
      el.setAttribute(name, "");
    }
  } else if (el.hasAttribute(name)) {
    el.removeAttribute(name);
  }
}

// Both build slotted light-DOM via the shared hyperscript: h() turns a string child into
// a text node and a Node child into an appended node — exactly the manual span/button
// construction these replaced.
function buildSlot(
  slot: string,
  content: VanillaContent | null,
): HTMLElement[] {
  return content === null ? [] : [h("span", { slot }, content)];
}

function buildActions(actions: { label: VanillaContent }[]): HTMLElement[] {
  return actions.map((action, index) =>
    h(
      "button",
      { slot: "action", type: "button", "data-action-index": String(index) },
      action.label,
    ),
  );
}

export const vanillaAdapter: ToastAdapterFactory<VanillaContent> = ({
  container,
  tag,
}) => {
  return {
    render(views) {
      const existing = new Map<number, HTMLElement>();
      container
        .querySelectorAll<HTMLElement>("[data-id]")
        .forEach((el) => existing.set(Number(el.dataset.id), el));

      const desired = new Set(views.map((view) => view.id));
      existing.forEach((el, id) => {
        if (!desired.has(id)) {
          el.remove();
        }
      });

      views.forEach((view, index) => {
        let host = existing.get(view.id);
        if (!host) {
          host = document.createElement(tag);
          host.dataset.id = String(view.id);
        }

        setAttrIfChanged(host, "type", view.type);
        setAttrIfChanged(host, "role", view.role);
        setAttrIfChanged(host, "duration", String(view.duration));
        setAttrIfChanged(host, "dismiss-label", view.dismissLabel);
        setAttrIfChanged(host, "icon-mode", view.iconMode);
        setAttrIfChanged(host, "dismissible", String(view.dismissible));
        setAttrIfChanged(host, "count", String(view.count));
        toggleAttr(host, "has-actions", view.actions.length > 0);
        setAttrIfChanged(host, "appearance", view.appearance);

        // Rebuild light-DOM slotted content. The host itself is reused (keyed
        // by id), so the shadow chrome and its running ring animation persist.
        host.replaceChildren(
          ...buildSlot("icon", view.icon),
          ...buildSlot("severity", view.severity),
          ...buildSlot("title", view.title),
          ...buildSlot("content", view.message),
          ...buildActions(view.actions),
        );

        if (container.children[index] !== host) {
          container.insertBefore(host, container.children[index] ?? null);
        }
      });
    },
    destroy() {
      container
        .querySelectorAll<HTMLElement>("[data-id]")
        .forEach((el) => el.remove());
    },
  };
};

/**
 * Minimal structural view of the React APIs the adapter needs — declared
 * locally so this module never imports (or forces a dependency on) React.
 * Supply the real functions when building the adapter.
 */
export interface ReactRuntime<Node = unknown> {
  Fragment: unknown;
  createElement: (
    type: unknown,
    props: unknown,
    ...children: unknown[]
  ) => Node;
  createRoot: (container: Element) => {
    render: (node: Node) => void;
    unmount: () => void;
  };
  flushSync: (callback: () => void) => void;
}

/**
 * React adapter, built by injecting React's `createElement`/`createRoot`/
 * `flushSync`/`Fragment` — keeping React out of this module's dependencies.
 * Content is whatever your React types call a node (pass the type param):
 *
 *   import * as React from "react";
 *   import { createRoot } from "react-dom/client";
 *   import { flushSync } from "react-dom";
 *   const reactAdapter = createReactAdapter<React.ReactNode>({
 *     Fragment: React.Fragment,
 *     createElement: React.createElement,
 *     createRoot,
 *     flushSync,
 *   });
 *
 * `flushSync` is required so `render` commits synchronously (see RenderAdapter).
 */
export function createReactAdapter<Node = unknown>(
  react: ReactRuntime<Node>,
): ToastAdapterFactory<Node> {
  return ({ container, tag }) => {
    const root = react.createRoot(container);

    return {
      render(views) {
        const hosts = views.map((view) => {
          const children: Node[] = [];

          if (view.icon !== null) {
            children.push(
              react.createElement(
                "span",
                { key: "i", slot: "icon" },
                view.icon,
              ),
            );
          }
          if (view.severity !== null) {
            children.push(
              react.createElement(
                "span",
                { key: "s", slot: "severity" },
                view.severity,
              ),
            );
          }
          if (view.title !== null) {
            children.push(
              react.createElement(
                "span",
                { key: "t", slot: "title" },
                view.title,
              ),
            );
          }
          children.push(
            react.createElement(
              "span",
              { key: "m", slot: "content" },
              view.message,
            ),
          );
          view.actions.forEach((action, index) => {
            children.push(
              react.createElement(
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

          return react.createElement(
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
        });

        // Synchronous commit so the core can read hosts back immediately.
        react.flushSync(() => {
          root.render(react.createElement(react.Fragment, null, ...hosts));
        });
      },
      destroy() {
        root.unmount();
      },
    };
  };
}
