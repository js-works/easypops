// -------------------------------------------------------------------
// lit-html rendering adapter for toasts.
// -------------------------------------------------------------------
//
// Kept off the package's main entry so importing "easypops" pulls in no framework code
// at all. Reachable as "easypops/lit".

import { render } from "lit-html";
import { html, unsafeStatic } from "lit-html/static.js";
import { repeat } from "lit-html/directives/repeat.js";
import type { TemplateResult } from "lit-html";
import type { ToastAdapterFactory } from "../../toasts/contract/view.js";

/**
 * lit-html adapter. Content is a lit `TemplateResult` or a plain string. The
 * keyed `repeat` is essential: an unkeyed list would let lit reuse DOM nodes by
 * position, leaking the imperative slide-out transform onto whichever
 * toast lands in that slot after a re-render.
 */
export type LitContent = string | TemplateResult;

export const litToastAdapter: ToastAdapterFactory<LitContent> = ({
  container,
  tag,
}) => {
  const staticTag = unsafeStatic(tag);

  return {
    render(views) {
      render(
        html`
          ${repeat(
            views,
            (view) => view.id,
            (view) => html`
              <${staticTag}
                data-id=${view.id}
                type=${view.type}
                role=${view.role}
                duration=${view.duration}
                dismiss-label=${view.dismissLabel}
                icon-mode=${view.iconMode}
                dismissible=${String(view.dismissible)}
                count=${view.count}
                ?has-actions=${view.actions.length > 0}
                appearance=${view.appearance}
              >
                ${
                  view.icon !== null
                    ? html`<span slot="icon">${view.icon}</span>`
                    : ""
                }
                ${
                  view.severity !== null
                    ? html`<span slot="severity">${view.severity}</span>`
                    : ""
                }
                ${
                  view.title !== null
                    ? html`<span slot="title">${view.title}</span>`
                    : ""
                }
                <span slot="content">${view.message}</span>
                ${view.actions.map(
                  (action, index) => html`
                    <button
                      slot="action"
                      type="button"
                      data-action-index=${index}
                    >
                      ${action.label}
                    </button>
                  `,
                )}
              </${staticTag}>
            `,
          )}
        `,
        container,
      );
    },
    destroy() {
      container.replaceChildren();
    },
  };
};
