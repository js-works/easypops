// -------------------------------------------------------------------
// The presentational dialog custom element, its scroll lock, lazy registration and
// the mount layer that bridges it to the controller.
// -------------------------------------------------------------------

import { registerFirstFreeTag } from "../internal/custom-element.js";
import { deepActiveElement, h, parseSvg } from "../internal/dom.js";
import { insertContent, withLineBreaks } from "./content.js";
import { closeIconSvg, rejectIconSvg } from "./icons.js";
import {
  CLOSE_ANIMATION_FALLBACK_MS,
  DIALOG_GROW_ANIM_MS,
  REJECT_MESSAGE_ANIM_MS,
  SPINNER_DROP_ANIM_MS,
  STYLE_TEXT,
  SWAP_OUT_MS,
} from "./styles.js";
import type { ContentAdapter, Renderable } from "./content.js";
import type { DialogRenderOverrides } from "./types.js";
import type {
  DialogButtonView,
  DialogHandle,
  DialogView,
  ResolvedRejectMessage,
} from "./view.js";

// -------------------------------------------------------------------
// # Scroll lock
// -------------------------------------------------------------------

// Lock background scrolling while a modal dialog is open, reserving the scrollbar's
// width so hiding it doesn't shift the page. Ref-counted in case dialogs overlap.
let scrollLockCount = 0;
let restoreOverflow = "";
let restorePaddingRight = "";

function lockBackgroundScroll(): void {
  if (scrollLockCount++ > 0) {
    return;
  }
  const root = document.documentElement;
  const scrollbarWidth = window.innerWidth - root.clientWidth;
  restoreOverflow = root.style.overflow;
  restorePaddingRight = root.style.paddingRight;
  root.style.overflow = "hidden";
  if (scrollbarWidth > 0) {
    const existing = parseFloat(getComputedStyle(root).paddingRight) || 0;
    root.style.paddingRight = `${existing + scrollbarWidth}px`;
  }
}

function unlockBackgroundScroll(): void {
  if (scrollLockCount === 0 || --scrollLockCount > 0) {
    return;
  }
  const root = document.documentElement;
  root.style.overflow = restoreOverflow;
  root.style.paddingRight = restorePaddingRight;
}

// -------------------------------------------------------------------
// # Lazy element registration + per-instance CSS scope
// -------------------------------------------------------------------

// The exported `Dialog` base class is never registered. On first use we register a
// *subclass* under `js-interact-dialog-N`, bumping N past any already-taken name (e.g.
// a second copy of this library on the same page). All instances share that one tag.
let resolvedTagNumber = 0;
let resolvedDialogTag: string | null = null;

function dialogElementTag(): string {
  if (resolvedDialogTag) {
    return resolvedDialogTag;
  }
  const { tag, index } = registerFirstFreeTag(
    "js-interact-dialog",
    class extends Dialog {},
  );
  resolvedTagNumber = index;
  resolvedDialogTag = tag;
  return tag;
}

// Each dialog instance gets a unique CSS scope class combining the tag number (unique
// per library load) and a per-instance counter, so a caller's (unscoped) `styles` can
// be nested under it without leaking to other dialogs — or to a different version of
// this library elsewhere on the page.
let scopeInstanceCounter = 0;

// Resolve the custom-element base class in a no-DOM-safe way. `HTMLElement` only exists in
// a browser; when this module is merely *imported* during a server/SSR pass (e.g. Next.js
// evaluating the module graph), it's undefined, so fall back to a dummy base. The dialog is
// never instantiated server-side — this only keeps `import` from throwing. In a browser the
// real `HTMLElement` is used, so registration and instantiation work exactly as before.
// (The toast element is already import-safe: its class is defined lazily inside
// ensureElementRegistered.)
const DialogElementBase: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

/**
 * The presentational dialog element: a native `<dialog>` shell in a shadow root, with
 * caller content projected through named slots — `icon`, `title`, `subtitle`, `intro`,
 * `content`, `outro`. The reject message and action buttons are library-owned chrome
 * built in the shadow root, since they carry wired behavior (loading spinner,
 * validate/submit, the reject-message state machine) that isn't expressible as plain
 * slotted markup.
 *
 * A single `<dialog>` node is reused across a scope: it grows in on first show and, for
 * each subsequent view, fades the current box out and grows the new one back in without
 * ever calling `close()` — so the modal backdrop stays up for the whole scope.
 *
 * Content is light DOM, so caller `styles` are injected as a light `<style>` scoped under
 * this instance's unique class (`scopeClass`) via CSS nesting; shadow chrome stays scoped
 * by the shadow root as usual.
 *
 * Exported for reuse/subclassing but intentionally NOT `customElements.define`d — the
 * library registers a subclass lazily (see `dialogElementTag`).
 */
class Dialog extends DialogElementBase {
  /** Unique per instance; used both as the host class and to scope caller `styles`. */
  readonly scopeClass = `__internal-dialog-${resolvedTagNumber}-${++scopeInstanceCounter}__`;

  #dialog!: HTMLDialogElement;

  #spinnerOnly = false;
  #closing = false;
  #scrollLocked = false;
  #exitAnim: Animation | null = null;

  // Rebuilt each view; kept for targeted mutation between views.
  #contentEl: HTMLElement | null = null; // .dialog-content
  #footerEl: HTMLElement | null = null; // insertion anchor for the reject message
  #buttonEls: HTMLElement[] = [];
  #buttonViews: DialogButtonView[] = [];

  #defaultButtonIndex: number | null = null;
  #hasForm = false;
  #renderOverrides: DialogRenderOverrides<any> | undefined;
  #adapter: ContentAdapter<any> | undefined;
  #onClose: () => void = () => {};
  #onCancel: () => void = () => {};

  // The reject message, raised via raiseRejectMessage() (see FormAttempt.reject).
  #rejectMessage: ResolvedRejectMessage | null = null;
  #rejectMessageEl: HTMLElement | null = null;
  #rejectMessageAnim: Animation | null = null;

  #focusBeforeBusy: HTMLElement | null = null;
  #loading = new Set<number>();
  #styleEl: HTMLStyleElement | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.appendChild(h("style", null, STYLE_TEXT));

    // A single, stable <dialog> node reused across the scope, so showModal() state and
    // the `cancel` listener survive every content swap.
    this.#dialog = h("dialog", {
      onkeydown: this.#onKeyDown,
    }) as HTMLDialogElement;
    this.#dialog.addEventListener("cancel", (ev) => {
      ev.preventDefault();
      this.#onCancel();
    });
    root.appendChild(this.#dialog);
  }

  connectedCallback(): void {
    this.classList.add(this.scopeClass);
  }

  disconnectedCallback(): void {
    if (this.#scrollLocked) {
      this.#scrollLocked = false;
      unlockBackgroundScroll();
    }
    if (this.#styleEl) {
      this.#styleEl.remove();
      this.#styleEl = null;
    }
  }

  showSpinnerOnly(): void {
    this.#spinnerOnly = true;
    this.#dialog.classList.add("spinner-dialog");
    this.#dialog.setAttribute("aria-label", "Loading");
    this.#dialog.removeAttribute("aria-labelledby");
    this.#dialog.removeAttribute("aria-describedby");
    this.#dialog.replaceChildren(
      h("div", {
        class: "dialog-spinner",
        role: "status",
        "aria-label": "Loading",
      }),
    );
    this.#show();
  }

  // Set the dialog's view. If a dialog is already on screen (the spinner placeholder, or
  // the previous dialog in a scope), fade the current box out, then swap the new view in
  // and grow it back in — the <dialog> stays open, so the modal backdrop never drops.
  // NOT for the spinner -> first-real handoff: fully fading the spinner out first leaves
  // a visible gap, so there we swap and grow the real dialog straight in.
  setView(view: DialogView): void {
    const dialog = this.#dialog;
    if (dialog.open && !this.#spinnerOnly) {
      const exit = dialog.animate(
        [
          { opacity: 1, transform: "scale(1)" },
          { opacity: 0, transform: "scale(0.97)" },
        ],
        { duration: SWAP_OUT_MS, easing: "ease-in", fill: "forwards" },
      );
      this.#exitAnim = exit;
      exit.onfinish = () => {
        this.#applyView(view);
        this.#growIn();
      };
    } else {
      const wasOpen = dialog.open; // spinner placeholder already showing
      this.#applyView(view);
      if (wasOpen) {
        this.#growIn();
      } else {
        this.#show();
      }
    }
  }

  raiseRejectMessage(message: ResolvedRejectMessage): void {
    this.#setRejectMessage(message);
  }

  setButtonLoading(index: number, loading: boolean): void {
    const wasBusy = this.#loading.size > 0;
    if (loading) {
      this.#loading.add(index);
    } else {
      this.#loading.delete(index);
    }
    const nowBusy = this.#loading.size > 0;

    // Going inert blurs whatever was focused; remember it while busy and restore after,
    // so the user isn't stranded with nothing focused (e.g. after a failed submit). The
    // focused field may live in light DOM inside a web component, so pierce shadow roots.
    if (!wasBusy && nowBusy) {
      this.#focusBeforeBusy = deepActiveElement();
    } else if (wasBusy && !nowBusy) {
      const toRestore = this.#focusBeforeBusy;
      this.#focusBeforeBusy = null;
      requestAnimationFrame(() => {
        if (toRestore?.isConnected) {
          toRestore.focus();
        }
      });
    }

    // Reflect the loading state on the button. Default buttons toggle a class (node
    // identity preserved, so focus survives); override buttons must be re-rendered
    // since their loading state is internal.
    const el = this.#buttonEls[index];
    if (el) {
      if (this.#renderOverrides?.actionButton) {
        const next = this.#renderButton(this.#buttonViews[index], index);
        el.replaceWith(next);
        this.#buttonEls[index] = next;
      } else {
        el.classList.toggle("loading", loading);
      }
    }

    if (this.#contentEl) {
      this.#contentEl.inert = nowBusy;
    }
  }

  getForm(): HTMLFormElement | null {
    return this.querySelector("form");
  }

  async closeDialog(): Promise<void> {
    const dialog = this.#dialog;
    if (!dialog || this.#closing) {
      this.remove();
      return;
    }
    this.#closing = true;
    dialog.classList.add("closing");

    await Promise.race([
      new Promise<void>((res) =>
        dialog.addEventListener("animationend", () => res(), { once: true }),
      ),
      new Promise<void>((res) => setTimeout(res, CLOSE_ANIMATION_FALLBACK_MS)),
    ]);

    dialog.close();
    this.remove();
  }

  // ---- internals ----

  // Show the dialog for the first time: open the modal, lock scroll, grow it in, focus.
  #show(): void {
    if (this.#dialog.open) return;
    this.#dialog.showModal();
    this.#scrollLocked = true;
    lockBackgroundScroll();
    this.#growIn();
    this.#focusInitial();
  }

  // The single entrance animation: grow the box in from nothing. Used for the spinner
  // placeholder, the first real dialog, and every in-scope swap alike.
  #growIn(): void {
    const box = this.#dialog;
    // The spinner placeholder drops in from slightly above and settles; real dialogs
    // (and in-scope swaps) grow in from nothing as before.
    const keyframes = this.#spinnerOnly
      ? [
          { transform: "translateY(-3em)", opacity: 0 },
          { transform: "translateY(0)", opacity: 1 },
        ]
      : [
          { transform: "scale(0)", opacity: 0 },
          { transform: "scale(1)", opacity: 1 },
        ];
    box.animate(keyframes, {
      duration: this.#spinnerOnly ? SPINNER_DROP_ANIM_MS : DIALOG_GROW_ANIM_MS,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
    });
    // Clear the finished swap fade-out (fill: forwards) only after grow-in is on top of
    // the animation stack, so removing its held value causes no one-frame flash.
    this.#exitAnim?.cancel();
    this.#exitAnim = null;
  }

  // Apply a view: reset per-view state, project caller content into light-DOM slots, and
  // (re)build the shadow chrome. The stable <dialog> keeps its identity; only its single
  // child (the .dialog-content) is replaced.
  #applyView(view: DialogView): void {
    this.#spinnerOnly = false;

    // Apply the caller theme as `--dialog-*` custom properties on the host; they inherit
    // through the shadow boundary into the chrome CSS (and to slotted light DOM). No-op
    // when the map is empty, leaving the built-in look untouched.
    for (const [prop, value] of Object.entries(view.themeVars)) {
      this.style.setProperty(prop, value);
    }

    this.#dialog.classList.remove("spinner-dialog");
    this.#dialog.setAttribute("aria-labelledby", "dialog-title");
    this.#dialog.setAttribute("aria-describedby", "dialog-body");
    this.#dialog.removeAttribute("aria-label");

    this.setAttribute("data-dialog-type", view.dialogType);
    this.#defaultButtonIndex = view.defaultButtonIndex;
    this.#hasForm = view.hasForm;
    this.#buttonViews = view.buttons;
    this.#renderOverrides = view.render;
    this.#adapter = view.adapter;
    this.#onClose = view.onClose;
    this.#onCancel = view.onCancel;

    // Reset reject-message state (the old node lived in the content we're replacing).
    this.#rejectMessageAnim?.cancel();
    this.#rejectMessageAnim = null;
    this.#rejectMessage = null;
    this.#rejectMessageEl = null;
    this.#loading.clear();
    this.#focusBeforeBusy = null;

    this.#applyCallerStyles(view.styles);

    // Light DOM (projected through the slots) and shadow chrome.
    this.replaceChildren(...this.#buildSlotted(view));
    this.#dialog.replaceChildren(this.#buildContent(view));

    if (this.#dialog.open) {
      this.#focusInitial();
    }
  }

  // Scope the caller's (unscoped) CSS under this instance's class via CSS nesting, so
  // multiple dialogs — even from different library versions — can't collide. Removed on
  // close (see disconnectedCallback). NOTE: top-level @keyframes/@font-face in `styles`
  // can't be nested; wrap-scoping targets ordinary selectors (incl. nested @media).
  #applyCallerStyles(cssText: string | null): void {
    if (!cssText) {
      if (this.#styleEl) {
        this.#styleEl.remove();
        this.#styleEl = null;
      }
      return;
    }
    if (!this.#styleEl) {
      this.#styleEl = document.createElement("style");
      document.head.append(this.#styleEl);
    }
    this.#styleEl.textContent = `.${this.scopeClass} { ${cssText} }`;
  }

  // Coerce caller/override content to a Node using this dialog's adapter (if any).
  // #node is the plain seam; #lines additionally turns "\n" in strings into <br>s.
  #node(value: Renderable<any>): Node {
    return insertContent(value, this.#adapter);
  }
  #lines(value: Renderable<any>): Node {
    return withLineBreaks(value, this.#adapter);
  }

  // Build the light-DOM elements projected through the named slots.
  #buildSlotted(view: DialogView): Node[] {
    const els: Node[] = [];
    if (view.icon != null) {
      els.push(h("span", { slot: "icon" }, this.#node(view.icon)));
    }
    els.push(h("span", { slot: "title" }, this.#lines(view.title)));
    if (view.subtitle != null) {
      els.push(h("span", { slot: "subtitle" }, this.#lines(view.subtitle)));
    }
    if (view.intro != null) {
      els.push(h("div", { slot: "intro" }, this.#lines(view.intro)));
    }
    els.push(
      view.hasForm
        ? h(
            "form",
            {
              class: "content",
              slot: "content",
              onsubmit: (ev: Event) => ev.preventDefault(),
            },
            this.#node(view.content),
          )
        : h(
            "div",
            { class: "content", slot: "content" },
            this.#lines(view.content),
          ),
    );
    if (view.outro != null) {
      els.push(h("div", { slot: "outro" }, this.#lines(view.outro)));
    }
    return els;
  }

  // Build the shadow chrome (.dialog-content) and store references for later mutation.
  #buildContent(view: DialogView): HTMLElement {
    const r = this.#renderOverrides;

    const closeBtn = r?.closeButton
      ? this.#node(r.closeButton({ onClose: this.#onClose }))
      : h(
          "button",
          { class: "close-button", type: "button", onclick: this.#onClose },
          parseSvg(closeIconSvg),
        );

    const header = h(
      "div",
      { class: "header" },
      view.icon != null
        ? h("div", { id: "icon" }, h("slot", { name: "icon" }))
        : null,
      h(
        "div",
        { class: "titles" },
        h(
          "span",
          { class: "title", id: "dialog-title" },
          h("slot", { name: "title" }),
        ),
        h("span", { class: "subtitle" }, h("slot", { name: "subtitle" })),
      ),
      closeBtn,
    );

    const body = h(
      "div",
      {
        class: "body",
        id: "dialog-body",
        oninput: this.#dismissRejectMessage,
      },
      h("slot", { name: "intro" }),
      h("slot", { name: "content" }),
      h("slot", { name: "outro" }),
    );

    this.#buttonEls = view.buttons.map((b, i) => this.#renderButton(b, i));
    const footer = h(
      "div",
      { class: "footer" },
      h("div", { class: "action-buttons" }, this.#buttonEls),
    );
    this.#footerEl = footer;

    const content = h("div", { class: "dialog-content" }, header, body, footer);
    this.#contentEl = content;

    return content;
  }

  #renderButton(b: DialogButtonView, i: number): HTMLElement {
    const loading = this.#loading.has(i);
    const onClick = () => {
      this.#dismissRejectMessage();
      b.onClick();
    };
    if (this.#renderOverrides?.actionButton) {
      const node = this.#renderOverrides.actionButton({
        text: b.text,
        variant: b.type,
        loading,
        onClick,
      });
      // Overrides return a Renderable; wrap non-elements so we always hold an element
      // reference to replace on loading changes.
      return node instanceof HTMLElement
        ? node
        : h("span", null, this.#node(node));
    }
    return h(
      "button",
      {
        class: `action-button${loading ? " loading" : ""}`,
        "data-type": b.type,
        type: "button",
        onclick: onClick,
      },
      h("span", { class: "spinner" }),
      h("span", { class: "button-text" }, b.text),
    );
  }

  // Render the reject message element (see FormAttempt.reject). Honors the caller's
  // custom render override.
  #renderRejectMessageNode(message: ResolvedRejectMessage): HTMLElement {
    const r = this.#renderOverrides;
    if (r?.rejectMessage) {
      const node = r.rejectMessage({
        title: message.title,
        message: message.message,
      });
      return node instanceof HTMLElement
        ? node
        : h("div", null, this.#node(node));
    }
    return h(
      "div",
      { class: "reject-message", role: "alert" },
      h(
        "div",
        { class: "reject-message-inner" },
        h("span", { class: "reject-message-icon" }, parseSvg(rejectIconSvg)),
        h(
          "div",
          { class: "reject-message-body" },
          message.title != null
            ? h("div", { class: "reject-message-title" }, this.#node(message.title))
            : null,
          h("div", { class: "reject-message-text" }, this.#node(message.message)),
        ),
      ),
    );
  }

  // Animate the reject message's real height (measured, not guessed) between 0 and its
  // natural size, via the Web Animations API rather than a CSS transition. A CSS
  // transition needs concrete start/end values for `height`, and "auto" isn't one — the
  // usual workarounds (an oversized `max-height`, or an animated CSS Grid `fr` track) each
  // trade that off against a different flaw: a `max-height` far above the real content
  // height spends most of the transition doing nothing and then clips unevenly at the very
  // end (see the previous fix), and animated grid `fr` tracks aren't reliably smooth across
  // engines. Measuring the actual rendered height in JS sidesteps both.
  #animateRejectMessageHeight(
    el: HTMLElement,
    direction: "in" | "out",
    onFinish: () => void,
  ): void {
    const height = el.getBoundingClientRect().height;
    const keyframes = [
      { height: "0px", opacity: 0 },
      { height: `${height}px`, opacity: 1 },
    ];
    const anim = el.animate(
      direction === "in" ? keyframes : [...keyframes].reverse(),
      { duration: REJECT_MESSAGE_ANIM_MS, easing: "ease" },
    );
    this.#rejectMessageAnim = anim;
    anim.onfinish = () => {
      if (this.#rejectMessageAnim === anim) this.#rejectMessageAnim = null;
      onFinish();
    };
  }

  // Raise (or update / dismiss) the reject message.
  #setRejectMessage(message: ResolvedRejectMessage | null): void {
    this.#rejectMessageAnim?.cancel();
    this.#rejectMessageAnim = null;

    if (message) {
      this.#rejectMessage = message;
      if (this.#rejectMessageEl) {
        // Consecutive rejects: replace the node in place (no re-enter animation).
        const next = this.#renderRejectMessageNode(message);
        this.#rejectMessageEl.replaceWith(next);
        this.#rejectMessageEl = next;
      } else if (this.#footerEl) {
        const el = this.#renderRejectMessageNode(message);
        // Inserted as the footer's first child: below the divider line (the footer's
        // top border), above the action buttons.
        this.#footerEl.insertBefore(el, this.#footerEl.firstChild);
        this.#rejectMessageEl = el;
        this.#animateRejectMessageHeight(el, "in", () => {
          el.style.height = "";
        });
      }
    } else {
      this.#rejectMessage = null;
      const el = this.#rejectMessageEl;
      if (el) {
        this.#animateRejectMessageHeight(el, "out", () => {
          el.remove();
          if (this.#rejectMessageEl === el) this.#rejectMessageEl = null;
        });
      }
    }
  }

  #dismissRejectMessage = (): void => {
    if (this.#rejectMessage == null) {
      return;
    }
    this.#setRejectMessage(null);
  };

  // On open, focus sensibly: an explicit [autofocus] in slotted content wins; else the
  // first form field; else the default button (or, for critical dialogs with no default,
  // the last button — Cancel — so nothing destructive is primed). Content is light DOM,
  // so those queries hit the host; the button lookup uses the stored refs.
  #focusInitial(): void {
    const autofocus = this.querySelector<HTMLElement>("[autofocus]");
    if (autofocus) {
      requestAnimationFrame(() => autofocus.focus());
      return;
    }
    if (this.#hasForm) {
      // First focusable field. `[name]` catches form-associated custom elements
      // (e.g. <wa-input>), whose .focus() delegates to the inner native control.
      const field = this.querySelector<HTMLElement>(
        'input:not([type="hidden"]), select, textarea, [name]',
      );
      if (field) {
        requestAnimationFrame(() => field.focus());
        return;
      }
    }
    const buttons = this.#buttonEls;
    if (buttons.length === 0) {
      return;
    }
    const index = this.#defaultButtonIndex ?? buttons.length - 1;
    const button = buttons[index];
    if (button) {
      try {
        // Using try because of a bug in WebAwesome.
        requestAnimationFrame(() => button.focus());
      } catch {}
    }
  }

  // Plain Enter triggers the default button, but only when focus is in a text field /
  // select. A focused button (native or custom) handles Enter itself; textarea gets a
  // newline. Composed input events from slotted fields still reach the shadow listeners
  // because propagation follows the flattened tree.
  #onKeyDown = (ev: KeyboardEvent): void => {
    if (
      ev.key !== "Enter" ||
      ev.defaultPrevented ||
      ev.isComposing ||
      ev.shiftKey ||
      ev.ctrlKey ||
      ev.metaKey ||
      ev.altKey
    ) {
      return;
    }
    // Enter should trigger the default button when the user is in a form field —
    // including custom form controls (web components) that wrap a native field. We
    // accept a native <input>/<select> (either directly, or revealed at the top of an
    // open-shadow custom control's composed path), or any custom element (tag contains
    // "-") that sits inside the dialog's form. <textarea> (newline) and buttons
    // (self-activating) are intentionally excluded.
    const deepTag = (ev.composedPath()[0] as HTMLElement | null)?.tagName ?? "";
    const retarget = ev.target as HTMLElement | null;
    const inField =
      deepTag === "INPUT" ||
      deepTag === "SELECT" ||
      (retarget != null &&
        retarget.tagName.includes("-") &&
        this.getForm()?.contains(retarget) === true);
    if (!inField) {
      return;
    }
    const index = this.#defaultButtonIndex;
    if (index == null) {
      return;
    }
    const button = this.#buttonViews[index];
    if (!button) {
      return;
    }
    ev.preventDefault();
    this.#dismissRejectMessage();
    button.onClick();
  };
}

export { Dialog };

// -------------------------------------------------------------------
// # Mount layer
// -------------------------------------------------------------------

function createDialogElement(id: string): Dialog {
  const el = document.createElement(dialogElementTag()) as Dialog;
  el.id = id;
  document.body.append(el);
  return el;
}

function handleFor(el: Dialog): DialogHandle {
  return {
    update: (view) => el.setView(view),
    close: () => el.closeDialog(),
    setButtonLoading: (index, loading) => el.setButtonLoading(index, loading),
    raiseRejectMessage: (message) => el.raiseRejectMessage(message),
    getForm: () => el.getForm(),
  };
}

export function mountDialog(view: DialogView): DialogHandle {
  const el = createDialogElement(view.id);
  el.setView(view);
  return handleFor(el);
}

export function mountSpinnerDialog(id: string): DialogHandle {
  const el = createDialogElement(id);
  el.showSpinnerOnly();
  return handleFor(el);
}
