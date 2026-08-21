// -------------------------------------------------------------------
// Tiny DOM helpers shared by the framework-free dialog and toast cores.
// -------------------------------------------------------------------

// Recursive: a child may be an array of children, which appendChildren flattens.
export type Child = Node | string | number | boolean | null | undefined | Child[];
export type Attrs = Record<string, unknown>;

// Build an element. Props: `class` sets className; `on*` function props add listeners
// (onClick -> "click"); `true` sets a boolean attribute; other values set attributes.
// Children: Nodes are appended, strings/numbers become text nodes, arrays are flattened,
// null/false/undefined are skipped. No parsing, so nothing here is an injection surface.
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const key in props) {
      const value = props[key];
      if (value == null || value === false) continue;
      if (key === "class") {
        el.className = String(value);
      } else if (key.startsWith("on") && typeof value === "function") {
        // Narrow to HTMLElement (stable addEventListener signature); el's precise union
        // type can otherwise break here when global HTMLElementTagNameMap augmentations
        // (e.g. component libraries in the demo) add elements with custom event maps.
        (el as HTMLElement).addEventListener(
          key.slice(2).toLowerCase(),
          value as EventListener,
        );
      } else if (value === true) {
        el.setAttribute(key, "");
      } else {
        el.setAttribute(key, String(value));
      }
    }
  }
  appendChildren(el, children);
  return el;
}

export function appendChildren(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child == null || child === false || child === true) continue;
    if (Array.isArray(child)) {
      appendChildren(parent, child);
    } else if (child instanceof Node) {
      parent.appendChild(child);
    } else {
      parent.appendChild(document.createTextNode(String(child)));
    }
  }
}

// Parse a static SVG markup string into a fresh element (safe: it's our own markup, and
// a fresh node is produced each call so the same icon can appear in multiple places).
export function parseSvg(markup: string): SVGElement {
  const tpl = document.createElement("template");
  tpl.innerHTML = markup.trim();
  return tpl.content.firstElementChild as SVGElement;
}

export function doubleRaf(fn: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

// The deep active element, piercing open shadow roots (a focused light-DOM form field
// inside a web component reports the host as document.activeElement, so walk inward).
export function deepActiveElement(): HTMLElement | null {
  let el = document.activeElement as HTMLElement | null;
  while (el?.shadowRoot?.activeElement) {
    el = el.shadowRoot.activeElement as HTMLElement;
  }
  return el;
}
