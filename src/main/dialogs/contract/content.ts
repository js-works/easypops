// -------------------------------------------------------------------
// Content model: what a caller may hand in as dialog content.
// -------------------------------------------------------------------

// Content the caller hands in (title, body, icon, reject message, and the values a render
// override returns). `C` is the caller's framework content type — a Lit TemplateResult, a
// React node, etc. — normally inferred from the configured `adapter`. `string` is always
// allowed: plain text needs no framework and every adapter renders it as a text node.
// There is deliberately no `Node` member — content flows through your framework, not raw
// DOM. Handing in Nodes IS a content-type choice, so it is made by picking the built-in
// vanilla adapter, whose `C` is `Node`.
//
// No default for `C`: the adapter is required, so `C` is always inferred from it and a
// default would be unreachable. Writing `Renderable` bare is a compile error, which is
// what we want — "renderable content" with no content type is not a meaningful thing.
export type Renderable<C extends object> = C | string | null | undefined;

// Nothing in the core turns a Renderable into DOM any more: the configured adapter renders
// every slot straight into the element's light DOM (see adapter.ts). That inversion is
// what makes an open dialog updatable — the framework diffs its own output instead of
// being asked for a detached blob the core then inserts.

// The dialog element can't be generic (custom elements have no type parameter), so it and
// the internal plumbing reuse the public types at `Renderable<any>` rather than a separate
// erased type. `any` (not `object`) is deliberate: it's assignable in both directions, so a
// `Renderable<C>` flows in and out of the element with no casts. The public API stays fully
// typed on `C`; only this leaf plumbing is erased.
