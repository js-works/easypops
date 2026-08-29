// -------------------------------------------------------------------
// The built-in, framework-free dialog adapter.
// -------------------------------------------------------------------
//
// Chosen like any other adapter — `adapter` is required on a controller, there is no
// implicit default. What makes this one the plain path is that its content type asks for
// nothing: a DOM Node or a string, no framework anywhere.
//
// It is also the reference implementation of the contract. Lit and React get incremental
// reconciliation from their own runtimes; here it is explicit — slot wrappers are built
// once and their children replaced only when the value actually changed. That identity
// check is what keeps an <input> the user has typed into from being rebuilt underneath
// them, which is the whole reason the adapter (not the core) owns this DOM.

import type {
  DialogAdapterFactory,
  DialogProps,
  DialogSlots,
} from "../../dialogs/contract/adapter.js";
import type { Renderable } from "../../dialogs/contract/content.js";

/** Content the built-in adapter understands: no framework required. */
export type DomDialogContent = Node;

/** Wrapper element per slot, matching what the dialog element's shadow chrome expects. */
const slotTags: Record<keyof DialogSlots<any>, string> = {
  icon: "span",
  title: "span",
  subtitle: "span",
  intro: "div",
  content: "div", // replaced by a <form> when props.hasForm — see below
  outro: "div",
  note: "span",
};

/** DOM attribute name per slot key. */
const slotNames: Record<keyof DialogSlots<any>, string> = {
  icon: "icon",
  title: "title",
  subtitle: "subtitle",
  intro: "intro",
  content: "content",
  outro: "outro",
  note: "note",
};

const slotKeys = Object.keys(slotTags) as (keyof DialogSlots<any>)[];

export const domDialogAdapter: DialogAdapterFactory<DomDialogContent> = ({
  container,
  tag,
}) => {
  let host: HTMLElement | null = null;
  let hasForm: boolean | null = null;
  const wrappers = new Map<string, HTMLElement>();
  const rendered = new Map<string, Renderable<DomDialogContent>>();

  // The content slot is the one that changes element type: a <form> when the dialog takes
  // input, a <div> otherwise. It must stay in light DOM — form association does not cross
  // a shadow boundary, so a <form> in the shadow root would leave FormData and
  // reportValidity() unable to see the caller's fields.
  const contentWrapper = (form: boolean): HTMLElement => {
    const el = document.createElement(form ? "form" : "div");
    el.setAttribute("slot", "content");
    el.className = "content";
    if (form) {
      el.addEventListener("submit", (event) => event.preventDefault());
    }
    return el;
  };

  return {
    render({ props, slots }) {
      if (!host) {
        host = document.createElement(tag);
        container.append(host);
      }

      // One property, applied synchronously by the element — no coalescing needed.
      (host as unknown as { props: unknown }).props = props;

      if (hasForm !== props.hasForm) {
        hasForm = props.hasForm;
        wrappers.get("content")?.remove();
        wrappers.set("content", contentWrapper(props.hasForm));
        rendered.delete("content");
      }

      // Synced on every render rather than only on creation: the wrapper outlives an
      // update(), and the property is the one thing on it that a new spec can change.
      if (props.hasForm) {
        (wrappers.get("content") as HTMLFormElement).noValidate =
          !props.nativeValidation;
      }

      // A custom note replaces the library's own box wholesale, so it is rendered here
      // and slotted (see #syncNoteChrome, which then drops the chrome around it).
      const custom = props.render?.note;
      const noteOverride =
        custom && props.note ? custom(props.note) : undefined;

      for (const key of slotKeys) {
        let wrapper = wrappers.get(key);
        if (!wrapper) {
          wrapper = document.createElement(slotTags[key]);
          wrapper.setAttribute("slot", slotNames[key]);
          wrappers.set(key, wrapper);
        }
        if (wrapper.parentNode !== host) {
          host.append(wrapper);
        }

        let value = slots[key];
        if (key === "note" && noteOverride !== undefined) {
          value = noteOverride;
        }

        // Identity check, not deep equality: unchanged content is left strictly alone, so
        // its DOM — and any state inside it — survives the render.
        if (rendered.has(key) && rendered.get(key) === value) {
          continue;
        }
        rendered.set(key, value);
        wrapper.replaceChildren(...toNodes(value));
      }

      renderCloseButton(host, props);
      renderActionButtons(host, props);
    },

    destroy() {
      host?.remove();
      host = null;
      wrappers.clear();
      rendered.clear();
      hasForm = null;
    },
  };
};

// The one place a Renderable becomes DOM in this adapter. An object that isn't a Node can
// only get here through an untyped (`as any`) bypass of the public API, and rendering it
// would produce "[object Object]" on screen — the class of bug the typed `C` exists to
// prevent — so fail loudly instead.
function toNodes(value: Renderable<DomDialogContent>): Node[] {
  if (value == null) return [];
  if (value instanceof Node) return [value];
  if (typeof value === "object") {
    throw new TypeError(
      "Dialog content is a non-Node object but no dialog adapter is configured. " +
        "Pass `adapter` (e.g. litDialogAdapter) to the controller, or use a Node or string.",
    );
  }
  return [document.createTextNode(String(value))];
}

// An overridden close button is caller content, so it goes into the `close` slot and the
// element renders a hole for it; the default one stays in the element's shadow chrome.
function renderCloseButton(
  host: HTMLElement,
  props: DialogProps<DomDialogContent>,
): void {
  for (const stale of host.querySelectorAll(':scope > [slot="close"]')) {
    stale.remove();
  }
  const render = props.render?.closeButton;
  if (!render) {
    return;
  }
  const wrapper = document.createElement("span");
  wrapper.setAttribute("slot", "close");
  wrapper.append(...toNodes(render({ onClose: props.onClose })));
  host.append(wrapper);
}

// Only overridden buttons are slotted; the defaults stay in the element's shadow chrome,
// because `::slotted()` loses to any rule in the outer tree regardless of specificity.
// Rebuilt on every render rather than diffed: an override's markup depends on its own
// loading state, so there is nothing stable to preserve.
function renderActionButtons(
  host: HTMLElement,
  props: DialogProps<DomDialogContent>,
): void {
  for (const stale of host.querySelectorAll(':scope > [slot="action"]')) {
    stale.remove();
  }

  const render = props.render?.actionButton;
  if (!render) {
    return;
  }

  props.buttons.forEach((button, index) => {
    const wrapper = document.createElement("span");
    wrapper.setAttribute("slot", "action");
    wrapper.dataset.actionIndex = String(index);
    wrapper.append(
      ...toNodes(
        render({
          role: button.role,
          text: button.text,
          variant: button.type,
          loading: button.loading,
          onClick: button.onClick,
        }),
      ),
    );
    host.append(wrapper);
  });
}
