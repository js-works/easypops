// -------------------------------------------------------------------
// The presentational dialog custom element, its scroll lock, lazy registration and
// the mount layer that bridges it to the controller.
// -------------------------------------------------------------------
//
// The element owns the shell and the chrome; it never builds caller content. Everything
// projected through a named slot is rendered by the configured adapter (see adapter.ts)
// straight into the element's light DOM, so Lit/React reconcile it and an <input> the
// user has typed into survives an update. The element's only content entry point is the
// `props` property.

import { registerFirstFreeTag } from "../../internal/custom-element.js";
import { deepActiveElement, h, parseSvg } from "../../internal/dom.js";
import { closeIconSvg, noteIconSvg } from "./icons.js";
import {
  CLOSE_ANIMATION_FALLBACK_MS,
  DIALOG_GROW_ANIM_MS,
  REJECT_MESSAGE_ANIM_MS,
  SPINNER_DROP_ANIM_MS,
  styleText,
  SPINNER_SWAP_OUT_MS,
  SWAP_OUT_MS,
} from "./styles.js";
import type {
  DialogAdapter,
  DialogAdapterFactory,
  DialogProps,
  DialogSpec,
} from "../contract/adapter.js";
import type { DialogButtonView, DialogMount } from "../contract/view.js";

// How many frames focusFirstInvalid() lets the caller's re-render settle before reading
// aria-invalid off the form. Three is a frame past where React lands in practice, and
// still soon enough (~48ms) that the focus move reads as part of the click.
const FOCUS_INVALID_FRAMES = 3;

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
    root.style.paddingRight = `${scrollbarWidth}px`;
  }
}

function unlockBackgroundScroll(): void {
  if (--scrollLockCount > 0) {
    return;
  }
  scrollLockCount = 0;
  const root = document.documentElement;
  root.style.overflow = restoreOverflow;
  root.style.paddingRight = restorePaddingRight;
}

// -------------------------------------------------------------------
// # Reading the adapter's light DOM
// -------------------------------------------------------------------

// The adapter renders one wrapper element per slot, and — because a fixed template with
// static bindings is what lets frameworks diff rather than rebuild — it renders every
// wrapper whether or not the slot has a value. So "is this slot filled?" can't be read
// from the wrapper's presence; it has to be read from its contents.
//
// Emptiness has to tolerate a framework's own bookkeeping nodes: lit-html leaves marker
// comments inside an empty wrapper, and comments are neither elements nor text.
function slotWrapper(host: Element, name: string): Element | null {
  return host.querySelector(`:scope > [slot="${name}"]`);
}

function hasContent(wrapper: Element | null): boolean {
  if (!wrapper) {
    return false;
  }
  return wrapper.childElementCount > 0 || (wrapper.textContent ?? "").trim() !== "";
}

// Whether a slot holds plain text rather than markup. Only text gets `white-space:
// pre-line` (see the `pre-line` class in styles.ts), which is what turns "\n" in a
// caller's string into a line break. Applying it to markup would be wrong: a Lit or JSX
// template is full of source-formatting newlines that must stay collapsed.
function isTextOnly(wrapper: Element | null): boolean {
  return wrapper != null && wrapper.childElementCount === 0;
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
 * `content`, `outro`, `note`, plus `action` / `close` for overridden chrome. All of that
 * light DOM is written by the adapter; the element only provides the holes and the
 * behavior around them (the note collapse, the loading state, validate/submit, focus).
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
  // Set by beginSwap(): the next props render is the arriving dialog and has to grow in.
  #growPending = false;

  // The shadow chrome, built once and then reconciled in place. Rebuilding it per render
  // would defeat the point of the migration: a button losing node identity loses focus,
  // and the note region losing it loses its animation state.
  #contentEl: HTMLElement | null = null; // .dialog-content
  #headerEl!: HTMLElement;
  #iconEl!: HTMLElement;
  #titleEl!: HTMLElement;
  #subtitleEl!: HTMLElement;
  #partEls = new Map<string, HTMLElement>(); // intro / content / outro
  #actionsEl!: HTMLElement;
  #noteRegionEl!: HTMLElement;

  #closeEl: HTMLElement | null = null;
  #closeSlotted = false;
  #actionsSlotted = false;

  #buttonEls: HTMLElement[] = [];
  #buttonViews: readonly DialogButtonView[] = [];

  #defaultButtonIndex: number | null = null;
  #hasForm = false;
  #isDrawer = false;

  // The element reports outward with events rather than taking callback properties: it is
  // exported as a custom element, so `dialog-close` / `dialog-cancel` work from plain HTML
  // and from any framework's template. Matches the toast element, which already emits
  // its own dismiss event. The mount layer routes them back to the current spec's props.
  #emit(
    type: "dialog-close" | "dialog-cancel" | "dialog-note-dismiss",
  ): void {
    this.dispatchEvent(
      new CustomEvent(type, { bubbles: true, composed: true }),
    );
  }

  // Note state (see FormAttempt.reject). The *content* is spec state owned by
  // the controller and rendered into the note; the element only owns the box, its
  // collapse animation, and the dismissal gesture.
  #noteShown = false;
  #noteDismissing = false;
  #noteSlotted = false;
  #noteTitleEl: HTMLElement | null = null;
  #noteTextEl: HTMLElement | null = null;
  #note: { title?: string; message: string } | null = null;
  #noteAnim: Animation | null = null;

  #busy = false;
  #focusBeforeBusy: HTMLElement | null = null;
  #styleEl: HTMLStyleElement | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.appendChild(h("style", null, styleText));

    // Clicks on slotted override buttons reach props.onClick directly, bypassing the
    // wrapper #renderButton puts around the default ones — so the note dismissal
    // is handled here for both.
    this.addEventListener("click", (event) => {
      const target = event.target as Element | null;
      if (target?.closest?.('[slot="action"]')) {
        this.#dismissNote();
      } else if (target?.closest?.('[slot="close"]')) {
        this.#emit("dialog-close");
      }
    });

    // Belt and braces for the presence checks below. An adapter that adds or removes a
    // slot wrapper (rather than refilling a fixed one) changes the host's children without
    // any help from `props`, and slotchange is the only notification for that. It bubbles
    // within the shadow root, so one listener covers every slot, including chrome rebuilt
    // later.
    root.addEventListener("slotchange", () => {
      if (this.#contentEl) {
        this.#syncSlotPresence();
        this.#evaluateNote();
      }
    });

    // A single, stable <dialog> node reused across the scope, so showModal() state and
    // the `cancel` listener survive every content swap.
    this.#dialog = h("dialog", {
      onkeydown: this.#onKeyDown,
    }) as HTMLDialogElement;
    this.#dialog.addEventListener("cancel", (ev) => {
      ev.preventDefault();
      this.#emit("dialog-cancel");
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

  // ---- Adapter render entry point --------------------------------------------------
  // The adapter renders the host and all of its light DOM, then assigns this. The work is
  // deferred to a microtask for two reasons: repeated assignments coalesce into one
  // render, and the element's children are guaranteed to be in place by the time the
  // chrome reads them (a framework commits host properties before children, but both
  // within one synchronous render).
  //
  // This never touches light DOM — that belongs to the adapter.
  #pendingProps: DialogProps<any> | null = null;
  #updateQueued = false;

  set props(next: DialogProps<any>) {
    this.#pendingProps = next;
    if (this.#updateQueued) {
      return;
    }
    this.#updateQueued = true;
    queueMicrotask(() => this.#performUpdate());
  }

  get props(): DialogProps<any> | null {
    return this.#pendingProps;
  }

  /**
   * Fade the box that is currently on screen out, resolving once it is gone. The mount
   * layer awaits this before letting the adapter render the next dialog of a scope: the
   * light DOM belongs to the adapter, so the only way to keep the crossfade honest is to
   * hold the new content back until the old box has finished leaving.
   *
   * Resolves immediately when nothing is on screen yet (the first dialog just grows in).
   */
  beginSwap(): Promise<void> {
    const dialog = this.#dialog;
    if (!dialog.open || this.#closing) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const exit = dialog.animate(
        [
          { opacity: 1, transform: "scale(1)" },
          { opacity: 0, transform: "scale(0.97)" },
        ],
        {
          duration: this.#spinnerOnly ? SPINNER_SWAP_OUT_MS : SWAP_OUT_MS,
          easing: "ease-in",
          fill: "forwards",
        },
      );
      this.#exitAnim = exit;
      this.#growPending = true;
      // The note belongs to the dialog that is leaving; drop it without a
      // collapse, since the whole box is fading out anyway.
      this.#resetNote();
      exit.onfinish = () => resolve();
      exit.oncancel = () => resolve();
    });
  }

  getForm(): HTMLFormElement | null {
    return this.querySelector("form");
  }

  /**
   * Play the exit animation and close the modal. The element does *not* take itself out
   * of the DOM: it is the adapter's node now, and pulling it out from under React (which
   * would then fail to remove a child it no longer has) is exactly the kind of shared
   * ownership the adapter contract exists to avoid. The mount layer unmounts the adapter
   * and drops the container.
   */
  async closeDialog(): Promise<void> {
    const dialog = this.#dialog;
    if (!dialog || this.#closing) {
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
  }

  // ---- internals ----

  #performUpdate(): void {
    this.#updateQueued = false;
    const props = this.#pendingProps;
    if (!props) {
      return;
    }

    if (props.spinnerOnly) {
      this.#applyTheme(props.themeVars);
      this.#showSpinner();
    } else {
      this.#applyProps(props);
      this.#syncChrome(props);
      if (this.#dialog.firstChild !== this.#contentEl) {
        this.#dialog.replaceChildren(this.#contentEl!);
      }
    }

    if (!this.#dialog.open) {
      this.#show();
    } else if (this.#growPending) {
      this.#growPending = false;
      this.#growIn();
      this.#focusInitial();
    }
  }

  // The round placeholder shown while a scope has nothing to display yet. It goes through
  // props like everything else, so the same element (and the same open <dialog>, and so
  // the same backdrop) carries on into the first real dialog.
  #showSpinner(): void {
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
  }

  // Show the dialog for the first time: open the modal, lock scroll, grow it in, focus.
  #show(): void {
    if (this.#dialog.open) return;
    this.#growPending = false;
    this.#dialog.showModal();
    this.#scrollLocked = true;
    lockBackgroundScroll();
    this.#growIn();
    this.#focusInitial();
  }

  // The single entrance animation: grow the box in from nothing. Used for the spinner
  // placeholder, the first real dialog, and every in-scope swap alike. Drawers are the
  // exception — an edge panel that scales up from nothing reads wrong, so it slides.
  #growIn(): void {
    const box = this.#dialog;
    // Transforms have no logical equivalent, so the slide direction comes from the writing
    // direction. Resolved to a literal here rather than passed as var(): custom properties
    // are not substituted inside Web Animations keyframes. The same value is handed to CSS
    // for the exit keyframe, which does resolve var() (see styles.ts).
    let offscreen = "100%";
    if (this.#isDrawer) {
      offscreen =
        getComputedStyle(this).direction === "rtl" ? "-100%" : "100%";
      this.style.setProperty("--drawer-exit-translate", offscreen);
    }
    // The spinner placeholder drops in from slightly above and settles; real dialogs
    // (and in-scope swaps) grow in from nothing as before. A drawer is a pure slide — no
    // fade, so it reads as a panel arriving rather than a box appearing.
    const keyframes = this.#isDrawer
      ? [
          { transform: `translateX(${offscreen})` },
          { transform: "translateX(0)" },
        ]
      : this.#spinnerOnly
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

  // Everything derived from DialogProps: host state, theme, aria and the caller
  // stylesheet. Deliberately touches no light DOM.
  #applyProps(props: DialogProps<any>): void {
    this.#spinnerOnly = false;
    this.#applyTheme(props.themeVars);

    this.#dialog.classList.remove("spinner-dialog");
    this.#dialog.setAttribute("aria-labelledby", "dialog-title");
    this.#dialog.setAttribute("aria-describedby", "dialog-body");
    this.#dialog.removeAttribute("aria-label");

    this.setAttribute("data-dialog-type", props.dialogType);
    this.#defaultButtonIndex = props.defaultButtonIndex;
    this.#hasForm = props.hasForm;
    this.#isDrawer = props.dialogType.startsWith("drawer");
    this.#buttonViews = props.buttons;

    this.#applyCallerStyles(props.styles);
  }

  // Apply the caller theme as `--dialog-*` custom properties on the host; they inherit
  // through the shadow boundary into the chrome CSS (and to slotted light DOM). No-op
  // when the map is empty, leaving the built-in look untouched.
  #applyTheme(themeVars: Record<string, string>): void {
    for (const [prop, value] of Object.entries(themeVars)) {
      this.style.setProperty(prop, value);
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

  // ---- Shadow chrome ---------------------------------------------------------------

  // Build the chrome once. Everything caller-supplied is a hole; nothing here depends on
  // a particular view, so the same tree serves every dialog of a scope.
  #buildChrome(): void {
    this.#iconEl = h("div", { id: "icon", hidden: true }, h("slot", { name: "icon" }));
    this.#titleEl = h(
      "span",
      { class: "title", id: "dialog-title" },
      h("slot", { name: "title" }),
    );
    this.#subtitleEl = h(
      "span",
      { class: "subtitle" },
      h("slot", { name: "subtitle" }),
    );

    this.#headerEl = h(
      "div",
      { class: "header" },
      this.#iconEl,
      h("div", { class: "titles" }, this.#titleEl, this.#subtitleEl),
    );

    // Each body slot gets its own shadow-side part, so an empty one can be taken out of
    // the flex flow — otherwise the always-rendered wrapper of an absent `intro` would
    // still claim the body's row gap. Shadow-side, because styling a slotted node is not
    // an option: any rule in the outer tree beats ::slotted() regardless of specificity.
    const part = (name: string): HTMLElement => {
      const el = h(
        "div",
        { class: "part", "data-part": name },
        h("slot", { name }),
      );
      this.#partEls.set(name, el);
      return el;
    };

    const body = h(
      "div",
      {
        class: "body",
        id: "dialog-body",
        oninput: this.#dismissNote,
      },
      part("intro"),
      part("content"),
      part("outro"),
    );

    // Collapsed with a class rather than `hidden`, deliberately: `role="alert"` only
    // announces a change to a region that is in the accessibility tree, and `hidden`
    // takes it out. Zero height with overflow clipped keeps it there, so filling the
    // filling it reads as a live-region update — which is exactly what a reject is.
    this.#noteRegionEl = h("div", {
      class: "note-region collapsed",
      role: "alert",
    });
    this.#actionsEl = h("div", { class: "action-buttons" });

    const footer = h(
      "div",
      { class: "footer" },
      // Above the action buttons and below the divider line (the footer's top border).
      this.#noteRegionEl,
      this.#actionsEl,
    );

    this.#contentEl = h(
      "div",
      { class: "dialog-content" },
      this.#headerEl,
      body,
      footer,
    );
  }

  #syncChrome(props: DialogProps<any>): void {
    if (!this.#contentEl) {
      this.#buildChrome();
    }
    this.#syncCloseButton(props);
    this.#syncActionButtons(props);
    this.#syncNoteChrome(props);
    this.#syncSlotPresence();
    this.#evaluateNote();
    this.#syncBusy(props);
  }

  // An overridden close button is framework content, so the adapter renders it into the
  // `close` slot and this provides the hole. The default one stays shadow-side, where the
  // library's own styling is safe.
  #syncCloseButton(props: DialogProps<any>): void {
    const slotted = props.render?.closeButton != null;
    if (this.#closeEl && slotted === this.#closeSlotted) {
      return;
    }
    const next: HTMLElement = slotted
      ? h("slot", { name: "close" })
      : h(
          "button",
          {
            class: "close-button",
            type: "button",
            onclick: () => this.#emit("dialog-close"),
          },
          parseSvg(closeIconSvg),
        );
    if (this.#closeEl) {
      this.#closeEl.replaceWith(next);
    } else {
      this.#headerEl.append(next);
    }
    this.#closeEl = next;
    this.#closeSlotted = slotted;
  }

  // Default buttons are built here, in the shadow root, where the library's own styling
  // is safe. A caller-supplied renderer produces framework content instead, so the
  // adapter renders those into the `action` slot and this just provides the hole — the
  // library styles nothing about them, which is what makes light DOM acceptable there
  // (outer-tree rules beat ::slotted regardless of specificity).
  //
  // The defaults are reconciled, never rebuilt: a button that loses node identity loses
  // focus with it, and the loading state is now an ordinary prop that arrives on every
  // render.
  #syncActionButtons(props: DialogProps<any>): void {
    const overridden = props.render?.actionButton != null;

    if (overridden) {
      if (!this.#actionsSlotted) {
        this.#buttonEls = [];
        this.#actionsEl.replaceChildren(h("slot", { name: "action" }));
        this.#actionsSlotted = true;
      }
      return;
    }
    if (this.#actionsSlotted) {
      this.#actionsEl.replaceChildren();
      this.#actionsSlotted = false;
    }

    while (this.#buttonEls.length > props.buttons.length) {
      this.#buttonEls.pop()?.remove();
    }
    props.buttons.forEach((button, index) => {
      let el = this.#buttonEls[index];
      if (!el) {
        el = this.#createButton(index);
        this.#buttonEls[index] = el;
        this.#actionsEl.append(el);
      }
      el.classList.toggle("loading", button.loading);
      if (el.getAttribute("data-type") !== button.type) {
        el.setAttribute("data-type", button.type);
      }
      const label = el.querySelector(".button-text")!;
      if (label.textContent !== button.text) {
        label.textContent = button.text;
      }
    });
  }

  // The click handler reads the *current* button view rather than closing over one, so
  // the node survives every render — including a swap to the next dialog of a scope.
  #createButton(index: number): HTMLElement {
    return h(
      "button",
      {
        class: "action-button",
        type: "button",
        onclick: () => {
          this.#dismissNote();
          this.#buttonViews[index]?.onClick();
        },
      },
      h("span", { class: "spinner" }),
      h("span", { class: "button-text" }),
    );
  }

  // The note region is the animated box; what goes inside it depends on whether the
  // caller replaced the note wholesale. A custom one is framework content in the `note`
  // slot and gets no chrome of ours around it. The default one is built here and filled
  // from plain data — shadow chrome cannot take framework content.
  #syncNoteChrome(props: DialogProps<any>): void {
    const slotted = props.render?.note != null;

    if (this.#noteRegionEl.childElementCount === 0 || slotted !== this.#noteSlotted) {
      this.#noteSlotted = slotted;
      this.#noteTitleEl = null;
      this.#noteTextEl = null;

      if (slotted) {
        this.#noteRegionEl.replaceChildren(h("slot", { name: "note" }));
      } else {
        this.#noteTitleEl = h("div", { class: "note-title" });
        this.#noteTextEl = h("div", { class: "note-text" });
        this.#noteRegionEl.replaceChildren(
          h(
            "div",
            { class: "note" },
            h(
              "div",
              { class: "note-inner" },
              h("span", { class: "note-icon" }, parseSvg(noteIconSvg)),
              h("div", { class: "note-body" }, this.#noteTitleEl, this.#noteTextEl),
            ),
          ),
        );
      }
    }

    // Presence for #evaluateNote: data-driven for our own box, slot-driven for a custom
    // one (which only the adapter can fill).
    this.#note = slotted ? null : (props.note ?? null);

    if (this.#noteTitleEl && this.#noteTextEl) {
      const title = props.note?.title ?? "";
      this.#noteTitleEl.textContent = title;
      this.#noteTitleEl.hidden = title === "";
      this.#noteTextEl.textContent = props.note?.message ?? "";
    }
  }

  // Take empty slots out of the layout, and mark the text-only ones so a caller's "\n"
  // becomes a line break. Reads the adapter's light DOM, writes only shadow chrome.
  #syncSlotPresence(): void {
    const icon = slotWrapper(this, "icon");
    this.#iconEl.hidden = !hasContent(icon);

    const title = slotWrapper(this, "title");
    this.#titleEl.classList.toggle("pre-line", isTextOnly(title));
    const subtitle = slotWrapper(this, "subtitle");
    this.#subtitleEl.classList.toggle("pre-line", isTextOnly(subtitle));

    for (const name of ["intro", "content", "outro"]) {
      const wrapper = slotWrapper(this, name);
      const part = this.#partEls.get(name)!;
      part.hidden = !hasContent(wrapper);
      part.classList.toggle("pre-line", isTextOnly(wrapper));
    }
  }

  // Going inert blurs whatever was focused; remember it while busy and restore after, so
  // the user isn't stranded with nothing focused (e.g. after a failed submit). The focused
  // field may live in light DOM inside a web component, so pierce shadow roots.
  #syncBusy(props: DialogProps<any>): void {
    const nowBusy = props.buttons.some((button) => button.loading);
    if (!this.#busy && nowBusy) {
      this.#focusBeforeBusy = deepActiveElement();
    } else if (this.#busy && !nowBusy) {
      const toRestore = this.#focusBeforeBusy;
      this.#focusBeforeBusy = null;
      requestAnimationFrame(() => {
        if (toRestore?.isConnected) {
          toRestore.focus();
        }
      });
    }
    this.#busy = nowBusy;
    this.#contentEl!.inert = nowBusy;
    this.#syncButtonsInert(props, nowBusy);
  }

  // The affordance, not the rule: the controller drops a repeat activation from the click
  // itself, because `loading` — and therefore this — only arrives after
  // BUTTON_SPINNER_DELAY_MS. What this adds is that the user can see it.
  //
  // Cancel is exempt, so a slow handler cannot trap the user in the dialog; unless cancel
  // is the busy one itself, in which case there is nothing left to click. (No path
  // currently gets a spinner onto cancel — it settles immediately — but a caller's own
  // action button could, and the rule should not depend on that.)
  // Only the built-in buttons. Overridden ones are the caller's own DOM — they get
  // `loading` in their render descriptor and dress themselves, which is the same division
  // of labour as everywhere else here. Reaching into them would not work anyway: an
  // adapter appends its [slot="action"] wrappers *after* setting props (so after this
  // runs) and rebuilds them on every render, which would drop the attribute again.
  // Correctness does not depend on it either way — the controller's guard covers both.
  #syncButtonsInert(props: DialogProps<any>, nowBusy: boolean): void {
    if (this.#actionsSlotted) {
      return;
    }
    this.#buttonEls.forEach((el, index) => {
      const button = props.buttons[index];
      el.inert =
        nowBusy && button != null && (button.role !== "cancel" || button.loading);
    });
  }

  // ---- Note --------------------------------------------------------------

  // Animate the region's real height (measured, not guessed) between 0 and its natural
  // size, via the Web Animations API rather than a CSS transition. A CSS transition needs
  // concrete start/end values for `height`, and "auto" isn't one — the usual workarounds
  // (an oversized `max-height`, or an animated CSS Grid `fr` track) each trade that off
  // against a different flaw: a `max-height` far above the real content height spends most
  // of the transition doing nothing and then clips unevenly at the very end (see the
  // previous fix), and animated grid `fr` tracks aren't reliably smooth across engines.
  // Measuring the actual rendered height in JS sidesteps both.
  #animateNoteHeight(direction: "in" | "out", onFinish?: () => void): void {
    const el = this.#noteRegionEl;
    this.#noteAnim?.cancel();
    const height = el.getBoundingClientRect().height;
    const keyframes = [
      { height: "0px", opacity: 0 },
      { height: `${height}px`, opacity: 1 },
    ];
    const anim = el.animate(
      direction === "in" ? keyframes : [...keyframes].reverse(),
      { duration: REJECT_MESSAGE_ANIM_MS, easing: "ease" },
    );
    this.#noteAnim = anim;
    anim.onfinish = () => {
      if (this.#noteAnim === anim) this.#noteAnim = null;
      onFinish?.();
    };
  }

  // Raise the box when the note gain content, and — for a controller that clears
  // them without the user asking (a new dialog in the scope) — put it away again. The
  // user-driven dismissal is #dismissNote, which animates *before* the content
  // goes, so the collapse still has something to collapse.
  #evaluateNote(): void {
    const raised = this.#noteSlotted
      ? hasContent(slotWrapper(this, "note"))
      : this.#note != null;

    if (raised && !this.#noteShown) {
      this.#noteShown = true;
      this.#noteDismissing = false;
      this.#noteRegionEl.classList.remove("collapsed");
      this.#animateNoteHeight("in");
    } else if (!raised && this.#noteShown && !this.#noteDismissing) {
      this.#resetNote();
    }
  }

  #resetNote(): void {
    this.#noteAnim?.cancel();
    this.#noteAnim = null;
    this.#noteShown = false;
    this.#noteDismissing = false;
    this.#noteRegionEl?.classList.add("collapsed");
  }

  // The user typed, or pressed a button: collapse the message and only then tell the
  // controller, which owns the state and drops it from the next spec. Doing it in that
  // order is what keeps the content on screen for the length of the collapse — by the
  // time the slots are emptied the box is already at zero height.
  #dismissNote = (): void => {
    if (!this.#noteShown || this.#noteDismissing) {
      return;
    }
    this.#noteDismissing = true;
    this.#animateNoteHeight("out", () => {
      this.#noteShown = false;
      this.#noteDismissing = false;
      this.#noteRegionEl.classList.add("collapsed");
      this.#emit("dialog-note-dismiss");
    });
  };

  // ---- Focus & keyboard ------------------------------------------------------------

  /**
   * Send focus back into the form after a validator turned a confirm click down, so the
   * field that has to change is ready to type in rather than a tab away.
   *
   * The first control marked `aria-invalid="true"` wins. That is not a convention this
   * library invents: it is the attribute a screen reader reads to announce a field as
   * invalid, so any form layer that renders accessible errors is already setting it, and
   * the core learns which field failed without the validator having to say. Failing that,
   * `[autofocus]` - the same marker that wins on open - lets a caller point at a field
   * explicitly. With neither, nothing moves and focus stays on the button that was
   * clicked, which is where "press Enter to retry" needs it.
   */
  focusFirstInvalid(): void {
    const form = this.getForm();
    if (!form) {
      return;
    }
    // A validating button may have gone busy, and the end of that restores focus to
    // wherever it was when the click happened (see #syncBusy) - in a later frame than this
    // one, so it would win. Dropping the remembered element leaves it nothing to restore.
    this.#focusBeforeBusy = null;
    // aria-invalid is written by the caller's own re-render, and a framework that batches
    // its updates has not necessarily done that when the verdict comes back: measured with
    // React the attribute lands one frame later. So the DOM is read after a few frames,
    // not straight away.
    //
    // Deliberately not "stop at the first frame that finds something invalid". A field
    // still carrying a mark from the previous attempt would satisfy that immediately, and
    // the answer would be the field that failed *last* time rather than the first one
    // failing now. Waiting for the whole update to land is what makes document order mean
    // what it says.
    let framesLeft = FOCUS_INVALID_FRAMES;
    const look = (): void => {
      if (--framesLeft > 0) {
        requestAnimationFrame(look);
        return;
      }
      const target =
        form.querySelector<HTMLElement>('[aria-invalid="true"]') ??
        form.querySelector<HTMLElement>("[autofocus]");
      target?.focus();
    };
    requestAnimationFrame(look);
  }

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
    const button = this.#defaultButtonElement();
    if (button) {
      try {
        // Using try because of a bug in WebAwesome.
        requestAnimationFrame(() => button.focus());
      } catch {}
    }
  }

  // The button Enter primes, as a DOM node. Overridden buttons live in the light DOM, so
  // reach through the `action` wrapper to whatever inside it can actually take focus.
  #defaultButtonElement(): HTMLElement | null {
    if (!this.#actionsSlotted) {
      const buttons = this.#buttonEls;
      if (buttons.length === 0) return null;
      return buttons[this.#defaultButtonIndex ?? buttons.length - 1] ?? null;
    }
    const wrappers = this.querySelectorAll<HTMLElement>(':scope > [slot="action"]');
    if (wrappers.length === 0) return null;
    const wrapper = wrappers[this.#defaultButtonIndex ?? wrappers.length - 1];
    return (
      wrapper?.querySelector<HTMLElement>("button, [tabindex]") ??
      (wrapper?.firstElementChild as HTMLElement | null) ??
      wrapper ??
      null
    );
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
    this.#dismissNote();
    button.onClick();
  };
}

export { Dialog };

// -------------------------------------------------------------------
// # Mount layer
// -------------------------------------------------------------------
//
// Owns one container, one adapter bound to it, and the event wiring — for both the
// spinner placeholder and every real dialog, since they are the same element. The
// adapter creates the host inside the container and writes all of its light DOM; the
// mount layer never touches either.

/** Adapter-rendered light DOM means the host is found, not held. */
function dialogElement(container: HTMLElement, tag: string): Dialog | null {
  return container.querySelector<Dialog>(tag);
}

export function mountDialog(
  id: string,
  adapterFactory: DialogAdapterFactory<any>,
  requestRender: () => void,
): DialogMount {
  const container = document.createElement("div");
  container.id = id;
  // The host is `display: contents` and the <dialog> lives in the top layer, so the
  // container must not introduce a box of its own either.
  container.style.display = "contents";
  document.body.append(container);

  const tag = dialogElementTag();
  const adapter: DialogAdapter<any> = adapterFactory({
    container,
    tag,
    requestRender,
  });

  // `latest` is what the adapter renders — always the newest spec, so a spec that arrives
  // while a swap is mid-fade replaces the one waiting rather than queueing behind it.
  let latest: DialogSpec<any> | null = null;
  let swapping = false;
  let closed = false;

  const commit = (): void => {
    if (latest && !closed) {
      adapter.render(latest);
    }
  };

  // The element emits; the handlers come from the spec actually on screen. Delegated on
  // the container (the events bubble and are composed), so both the spinner and every
  // real dialog are wired by construction — there is no second place to forget.
  container.addEventListener("dialog-close", () => latest?.props.onClose());
  container.addEventListener("dialog-cancel", () => latest?.props.onCancel());
  container.addEventListener("dialog-note-dismiss", () =>
    latest?.props.onNoteDismiss(),
  );

  return {
    show(spec) {
      latest = spec;
      if (closed) return;
      const el = dialogElement(container, tag);
      if (!el) {
        commit(); // first mount: the adapter creates the host
        return;
      }
      if (swapping) return; // the in-flight swap will pick `latest` up
      swapping = true;
      void el.beginSwap().then(() => {
        swapping = false;
        commit();
      });
    },

    update(spec) {
      latest = spec;
      // Committing mid-swap would put the arriving content on screen while the outgoing
      // box is still fading it out. The swap renders `latest` when it lands.
      if (!swapping) {
        commit();
      }
    },

    async close() {
      closed = true;
      await dialogElement(container, tag)?.closeDialog();
      adapter.destroy?.();
      container.remove();
    },

    getForm: () => dialogElement(container, tag)?.getForm() ?? null,

    focusFirstInvalid: () => dialogElement(container, tag)?.focusFirstInvalid(),
  };
}
