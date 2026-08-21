// -------------------------------------------------------------------
// Lit content adapter for the dialogs core.
// -------------------------------------------------------------------
//
// The core is framework-free and speaks DOM Nodes. This adapter teaches a dialogs
// controller to accept lit-html TemplateResults as content and as render-override
// return values. Pass it as `adapter`; the controller then infers its content type
// `C` as TemplateResult, so every `content:`/`title:`/override return is type-checked
// against Lit content:
//
//   import { litDialogAdapter } from "./lit-adapter";
//   const dialogs = createDialogsController({ adapter: litDialogAdapter, render: { … } });
//
// Because `C` is threaded through the public API, the core only ever hands a
// TemplateResult to this adapter (it resolves Node/string/number itself). So unlike a
// runtime-dispatch adapter, there's no `_$litType$` guard and no `| null` fallback —
// the type system guarantees the input. The coupling to Lit lives only in this file.

import { render, type TemplateResult } from "lit-html";
import type { ContentAdapter } from "./dialogs";

export const litDialogAdapter: ContentAdapter<TemplateResult> = (value) => {
  // Render once into a throwaway fragment and hand the produced nodes to the core. The
  // fragment (and lit's ChildPart on it) is discarded after the nodes are moved into the
  // dialog; content here is inserted once and never re-rendered by the core, so a
  // one-shot render is exactly right. Marker comments come along harmlessly.
  const frag = document.createDocumentFragment();
  render(value, frag);
  return frag;
};
