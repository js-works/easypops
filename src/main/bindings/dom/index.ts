// -------------------------------------------------------------------
// The framework-free entry point: content is a DOM Node.
// -------------------------------------------------------------------
//
// Named for what you get rather than for what you go without — `dom` sits beside `lit`
// and `react` as a third rendering technology, the platform itself:
//
//   easypops/lit    -> TemplateResult
//   easypops/react  -> ReactElement
//   easypops/dom    -> Node
//
// Both adapters preserve the DOM you hand them: an unchanged slot is left strictly
// alone, so an <input> the user has typed into survives a re-render. What they cannot do
// is diff *inside* a slot — pass a new node and the whole slot is replaced. Hold your
// nodes and mutate them, which is how you would write DOM without a framework anyway.

export { domDialogAdapter } from "./dialog-adapter.js";
export type { DomDialogContent } from "./dialog-adapter.js";

export { domToastAdapter } from "./toast-adapter.js";
export type { DomToastContent } from "./toast-adapter.js";

// Building content without a framework means document.createElement chains. This takes
// the boilerplate off without introducing a template language: no parsing, no innerHTML,
// so nothing here is an injection surface, and event handlers go in directly.
//
//   const email = h("input", { name: "email", type: "email", required: true });
//   const form = h("div", null, h("label", null, "Email"), email);
export { h } from "../../internal/dom.js";
export type { Attrs, Child } from "../../internal/dom.js";
