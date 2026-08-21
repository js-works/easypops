// -------------------------------------------------------------------
// Content model: how caller/override values become DOM nodes.
// -------------------------------------------------------------------

// Content the caller hands in (title, body, icon, reject message, and the values a render
// override returns). `C` is the caller's framework content type — a Lit TemplateResult, a
// React node, etc. — normally inferred from the configured `adapter`. `string` is always
// allowed: plain text needs no framework and the core turns it into a text node directly.
// There is deliberately no `Node` member — content flows through your framework, not raw
// DOM. `C` defaults to `never`, so an unconfigured controller is text-only; to hand in
// anything structured you declare a content type. That includes DOM nodes: handing in
// Nodes IS a content-type choice, so set `C = Node` (the core then inserts them directly,
// no adapter needed — see insertContent). A `never` default is meaningful here precisely
// because `Node` is not in the base union; leaving `C` with no default is worse, as TS
// silently falls back to the `object` constraint and reopens the loose-object hole.
export type Renderable<C extends object = never> = C | string | null | undefined;

// A content adapter turns an opaque framework value of type `C` (a Lit TemplateResult, a
// React node, …) into a real DOM Node. Because `C` is threaded through the public API,
// only a `C` ever reaches the adapter — the core handles Node/string/number itself — so
// the adapter always converts and never returns null. Pass one per controller via
// `adapter`; it's the source `C` is inferred from.
export type ContentAdapter<C> = (value: C) => Node;

// The dialog element can't be generic (custom elements have no type parameter), so it and
// the internal plumbing reuse the public types at `Renderable<any>` / ContentAdapter
// <any> rather than a separate erased type. `any` (not `object`) is deliberate: it's
// assignable in both directions, so a `Renderable<C>` flows in and out of the element with
// no casts. The public API stays fully typed on `C`; only this leaf plumbing is erased.

// Coerce content to a Node for insertion. This is the C-erased internal seam: Nodes and
// primitives are handled directly; any other object is framework content and must go
// through the adapter. Reaching an object with no adapter can only happen via an untyped
// (`as any`) bypass of the public API, so we fail loudly rather than render "[object
// Object]" — which was the whole class of bug this seam exists to prevent.
export function insertContent(
  value: Renderable<any>,
  adapter?: ContentAdapter<any> | null,
): Node {
  if (value instanceof Node) return value;
  if (value == null) return document.createTextNode("");
  if (typeof value === "object") {
    if (adapter) return adapter(value);
    throw new TypeError(
      "Dialog content is a non-Node object but no content adapter is configured. " +
        "Pass `adapter` (e.g. litDialogAdapter) to the controller, or use a Node or string.",
    );
  }
  return document.createTextNode(String(value)); // primitives only
}

// Turn "\n" in a plain string into a fragment of text + <br>. Non-string Renderables
// (Node, number, …) pass through insertContent untouched.
export function withLineBreaks(
  value: Renderable<any>,
  adapter?: ContentAdapter<any> | null,
): Node {
  if (typeof value !== "string" || !value.includes("\n")) {
    return insertContent(value, adapter);
  }
  const lines = value
    .trim()
    .split(/\r?\n|\r/)
    .map((line) => line.trim());

  const frag = document.createDocumentFragment();
  lines.forEach((line, i) => {
    if (i > 0) frag.appendChild(document.createElement("br"));
    frag.appendChild(document.createTextNode(line));
  });
  return frag;
}
