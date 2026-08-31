// -------------------------------------------------------------------
// The framework-free rendering adapter. Projects the core's keyed list of ToastViews into
// the container it was bound to; the core owns all state and behaviour (see view.ts for
// the adapter contract).
//
// Its lit and React siblings sit next to it under bindings/ — each is its own entry point,
// so the main entry pulls in nothing framework-specific.
// -------------------------------------------------------------------

import { h } from "../../internal/dom.js";
import type { ToastAdapterFactory } from "../../toasts/contract/view.js";

/**
 * Framework-free adapter. Content is a plain string or a DOM `Node`. Does its
 * own keyed reconciliation of the host list.
 */
export type DomToastContent = string | Node;

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
  content: DomToastContent | null,
): HTMLElement[] {
  return content === null ? [] : [h("span", { slot }, content)];
}

function buildActions(actions: { label: DomToastContent }[]): HTMLElement[] {
  return actions.map((action, index) =>
    h(
      "button",
      { slot: "action", type: "button", "data-action-index": String(index) },
      action.label,
    ),
  );
}

export const domToastAdapter: ToastAdapterFactory<DomToastContent> = ({
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
