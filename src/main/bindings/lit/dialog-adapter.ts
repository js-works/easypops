// -------------------------------------------------------------------
// Lit rendering adapter for the dialogs core.
// -------------------------------------------------------------------
//
// The core is framework-free: it describes a dialog (see dialogs/adapter.ts) and this
// renders it. Pass it as `adapter`; the controller then infers its content type `C` as
// TemplateResult, so every `content:`/`title:`/override return is type-checked against
// Lit content:
//
//   import { litDialogAdapter } from "easypops/lit";
//   const dialogs = createDialogsController({ adapter: litDialogAdapter, render: { … } });
//
// Re-rendering the same template into the same container is a diff, not a rebuild, which
// is what makes an open dialog updatable: change the title and the `content` slot — and
// anything the user has typed into it — is left strictly alone. The coupling to Lit lives
// only in this file.

import { nothing, render as litRender, type TemplateResult } from "lit-html";
import { html, unsafeStatic } from "lit-html/static.js";
import type {
  DialogAdapterFactory,
  DialogProps,
  DialogSlots,
} from "../../dialogs/contract/adapter.js";

export const litDialogAdapter: DialogAdapterFactory<TemplateResult> = ({
  container,
  tag,
}) => {
  const t = unsafeStatic(tag);

  return {
    render({ props, slots }) {
      // The <form> stays in light DOM, wrapping the slotted content: form association
      // does not cross a shadow boundary, so a <form> in the shadow root would leave
      // FormData and reportValidity() unable to see the caller's fields.
      const content = props.hasForm
        ? html`<form
            slot="content"
            class="content"
            ?novalidate=${!props.nativeValidation}
            @submit=${preventSubmit}
          >
            ${slots.content}
          </form>`
        : html`<div slot="content" class="content">${slots.content}</div>`;

      litRender(
        html`
          <${t} .props=${props}>
            <span slot="icon">${slots.icon}</span>
            <span slot="title">${slots.title}</span>
            <span slot="subtitle">${slots.subtitle}</span>
            <div slot="intro">${slots.intro}</div>
            ${content}
            <div slot="outro">${slots.outro}</div>
            ${note(props, slots)}
            ${closeButton(props)}
            ${actionButtons(props)}
          </${t}>
        `,
        container,
      );
    },
  };
};

function preventSubmit(event: Event): void {
  event.preventDefault();
}

// A custom note replaces the library's own box wholesale, so it is rendered here and
// slotted — the element drops its chrome around it and only keeps the collapse. Without
// an override the box is shadow chrome filled from `props.note`, and the slot stays empty.
function note(
  props: DialogProps<TemplateResult>,
  slots: DialogSlots<TemplateResult>,
): unknown {
  const render = props.render?.note;
  const custom = render && props.note ? render(props.note) : slots.note;
  return html`<span slot="note">${custom}</span>`;
}

// Same split as the action buttons: an overridden close button is caller content, so it
// is slotted and the element renders the hole. The default one stays shadow-side.
function closeButton(props: DialogProps<TemplateResult>): unknown {
  const render = props.render?.closeButton;
  if (!render) {
    return nothing;
  }
  return html`<span slot="close">${render({ onClose: props.onClose })}</span>`;
}

// Only overridden buttons are slotted. The default ones stay in the element's shadow
// chrome, because `::slotted()` loses to any rule in the outer tree regardless of
// specificity — so anything the library styles itself has to live in the shadow root.
function actionButtons(props: DialogProps<TemplateResult>): unknown {
  const render = props.render?.actionButton;
  if (!render) {
    return nothing;
  }
  return props.buttons.map(
    (button, index) => html`
      <span slot="action" data-action-index=${index}>
        ${render({
          role: button.role,
          text: button.text,
          variant: button.type,
          loading: button.loading,
          onClick: button.onClick,
        })}
      </span>
    `,
  );
}
