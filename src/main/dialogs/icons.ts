// -------------------------------------------------------------------
// # Icons
// -------------------------------------------------------------------

import { parseSvg } from "../internal/dom.js";
import { infoIconSvg, successIconSvg } from "../internal/icons.js";
import type { Renderable } from "./content.js";
import type { DialogType } from "./types.js";

export const closeIconSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="currentColor" viewBox="0 0 16 16">
    <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/>
  </svg>
`;

// overflow="visible": these outlines touch the edge of the 16×16 viewBox, and the
// default UA style clips a root <svg> to its viewBox. This icon is projected through
// the dialog's icon <slot>, so a shadow stylesheet can't reach in to fix it via CSS
// (::slotted() can't select past the slotted node itself) — baked into the markup.
const confirmIconSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="currentColor" viewBox="0 0 16 16" overflow="visible">
    <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
    <path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286m1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94"/>
  </svg>
`;

// Exclamation-circle, used for the warn and error dialogs. Defined here (not in
// internal/icons.js) so the toast warn/error icons are unaffected. fill="currentColor"
// so it tints with the dialog's severity color. overflow="visible": same viewBox-clipping
// reason as confirmIconSvg above.
export const alertIconSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="currentColor" viewBox="0 0 16 16" overflow="visible">
    <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
    <path d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0M7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0z"/>
  </svg>
`;

// Exclamation-circle-fill, used for the form dialog's reject message. Defined here (not
// in internal/icons.js) so the toast error icon is unaffected; tinted reddish via CSS
// rather than fill="currentColor" inheritance, since the reject message's own text stays
// the normal text color.
export const rejectIconSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="currentColor" viewBox="0 0 16 16">
    <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M8 4a.905.905 0 0 0-.9.995l.35 3.507a.552.552 0 0 0 1.1 0l.35-3.507A.905.905 0 0 0 8 4m.002 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2"/>
  </svg>
`;

export function defaultDialogIcon(dialogType: DialogType): Renderable<any> {
  switch (dialogType) {
    case "info":
      return parseSvg(infoIconSvg);
    case "success":
      return parseSvg(successIconSvg);
    case "warn":
    case "error":
      return parseSvg(alertIconSvg);
    case "confirm":
    case "confirmCritical":
    case "decide":
    case "decideCritical":
      return parseSvg(confirmIconSvg);
    case "form":
    case "formCritical":
      return null;
  }
}
