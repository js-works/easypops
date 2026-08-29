// -------------------------------------------------------------------
// React rendering adapter for the dialogs core.
// -------------------------------------------------------------------
//
// The core describes a dialog (see dialogs/adapter.ts) and this renders it — as React
// elements, through a portal the provider owns. That inversion is what makes a React
// dialog possible at all: under the old one-shot contract the core asked for a detached
// `Node`, which React cannot produce synchronously, and every update rebuilt the content
// and discarded whatever the user had typed into it. Here an update is an ordinary
// re-render, so React reconciles and the DOM (and its state) survives.

import { createElement, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import type { ReactElement, ReactNode } from "react";
import type {
  DialogAdapterFactory,
  DialogProps,
  DialogSlots,
} from "../../dialogs/contract/adapter.js";
import type { Renderable } from "../../dialogs/contract/content.js";
import type { PortalStore } from "./portals.js";

/**
 * Content a React controller accepts: an element (so `<>{…}</>` covers a list), or the
 * plain `string` every adapter takes. It is an element rather than the whole `ReactNode`
 * union because the core's content type is constrained to an object — the same reason the
 * Lit adapter's is `TemplateResult` and not "anything Lit can render".
 */
export type ReactContent = ReactElement;

/**
 * The factory, plus a `refresh()` that asks the core for a fresh spec for every dialog
 * this adapter has on screen.
 *
 * The core resolves `getText` and `icons` while building a spec, so a language change
 * only reaches an open dialog if something rebuilds it. React cannot notice that on its
 * own: re-rendering `DialogHost` re-renders the *same* spec, and calling back into the
 * core from a render would loop. So the trigger is explicit — see the provider's
 * `refreshKey`.
 */
export interface ReactDialogAdapter {
  factory: DialogAdapterFactory<ReactContent>;
  refresh(): void;
}

export function createDialogAdapter(store: PortalStore): ReactDialogAdapter {
  // One per mounted scope; a scope removes its own on destroy.
  const pending = new Set<() => void>();

  const factory: DialogAdapterFactory<ReactContent> = ({
    container,
    tag,
    requestRender,
  }) => {
    const id = store.nextId();
    pending.add(requestRender);
    return {
      render(spec) {
        // Synchronous commit: the core reads layout and moves focus straight after this
        // returns (the same requirement the toast adapter documents).
        flushSync(() => {
          store.set(id, container, createElement(DialogHost, { tag, spec }));
        });
      },
      destroy() {
        pending.delete(requestRender);
        flushSync(() => store.remove(id));
      },
    };
  };

  return {
    factory,
    refresh: () => {
      for (const request of pending) request();
    },
  };
}


// The core's own chrome — the built-in dialog icons — is DOM, because a DOM node is the
// only representation of a glyph that every adapter can take. React cannot render one as
// a child (it throws "Objects are not valid as a React child"), so a node is mounted into
// an anchor instead. `display: contents` keeps the anchor out of the layout, leaving the
// glyph exactly where the shadow chrome expects it.
const anchorStyle = { display: "contents" } as const;

function RawNode({ node }: { node: Node }): ReactElement {
  const anchor = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = anchor.current;
    if (!el) return undefined;
    el.replaceChildren(node);
    return () => el.replaceChildren();
  }, [node]);
  return createElement("span", { ref: anchor, style: anchorStyle });
}

function content(value: Renderable<ReactContent>): ReactNode {
  // `typeof Node` guarded so merely importing this module during an SSR pass is safe.
  if (typeof Node !== "undefined" && value instanceof Node) {
    return createElement(RawNode, { node: value });
  }
  return value as ReactNode;
}

/**
 * The host element plus its slotted light DOM. `props` is assigned imperatively rather
 * than passed as a React prop: how a custom element receives a non-primitive prop has
 * changed across React versions, and a layout effect is unambiguous in all of them. The
 * element coalesces assignments into one microtask, so it sees the children in place
 * regardless of when this runs relative to them.
 */
function DialogHost({
  tag,
  spec,
}: {
  tag: string;
  spec: { props: DialogProps<ReactContent>; slots: DialogSlots<ReactContent> };
}): ReactElement {
  const host = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (host.current) {
      (host.current as unknown as { props: unknown }).props = spec.props;
    }
  });

  const { props, slots } = spec;

  // The <form> stays in light DOM, wrapping the slotted content: form association does
  // not cross a shadow boundary, so a <form> in the shadow root would leave FormData and
  // reportValidity() unable to see the caller's fields.
  const contentPart = props.hasForm
    ? createElement(
        "form",
        {
          slot: "content",
          key: "content",
          className: "content",
          noValidate: !props.nativeValidation,
          onSubmit: preventSubmit,
        },
        content(slots.content),
      )
    : createElement(
        "div",
        { slot: "content", key: "content", className: "content" },
        content(slots.content),
      );

  return createElement(
    tag,
    { ref: host },
    createElement("span", { slot: "icon", key: "icon" }, content(slots.icon)),
    createElement("span", { slot: "title", key: "title" }, content(slots.title)),
    createElement("span", { slot: "subtitle", key: "subtitle" }, content(slots.subtitle)),
    createElement("div", { slot: "intro", key: "intro" }, content(slots.intro)),
    contentPart,
    createElement("div", { slot: "outro", key: "outro" }, content(slots.outro)),
    note(props, slots),
    closeButton(props),
    ...actionButtons(props),
  );
}

function preventSubmit(event: { preventDefault(): void }): void {
  event.preventDefault();
}

// A custom note replaces the library's own box wholesale, so it is rendered here and
// slotted — the element then drops its chrome around it and keeps only the collapse.
// Without an override the box is shadow chrome filled from `props.note`, and this slot
// stays empty.
function note(
  props: DialogProps<ReactContent>,
  slots: DialogSlots<ReactContent>,
): ReactNode {
  const render = props.render?.note;
  return createElement(
    "span",
    { key: "note", slot: "note" },
    render && props.note ? content(render(props.note)) : content(slots.note),
  );
}

// Same split as the action buttons: an overridden close button is caller content, so it
// is slotted and the element renders the hole. The default one stays shadow-side.
function closeButton(props: DialogProps<ReactContent>): ReactNode {
  const render = props.render?.closeButton;
  if (!render) {
    return null;
  }
  return createElement(
    "span",
    { slot: "close", key: "close" },
    content(render({ onClose: props.onClose })),
  );
}

// Only overridden buttons are slotted. The default ones stay in the element's shadow
// chrome, because `::slotted()` loses to any rule in the outer tree regardless of
// specificity — so anything the library styles itself has to live in the shadow root.
function actionButtons(props: DialogProps<ReactContent>): ReactNode[] {
  const render = props.render?.actionButton;
  if (!render) {
    return [];
  }
  return props.buttons.map((button, index) =>
    createElement(
      "span",
      { slot: "action", key: `action-${index}`, "data-action-index": index },
      content(
        render({
          role: button.role,
          text: button.text,
          variant: button.type,
          loading: button.loading,
          onClick: button.onClick,
        }),
      ),
    ),
  );
}
