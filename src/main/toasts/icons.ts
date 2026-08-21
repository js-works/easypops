// -------------------------------------------------------------------
// # Icons
// -------------------------------------------------------------------
//
// The four severity glyphs are shared with dialogs (see ../internal/icons.js); only the
// loading spinner is toast-specific. Looked up by the custom element from its
// `type` attribute at runtime.

import {
  errorIconSvg,
  infoIconSvg,
  successIconSvg,
  warnIconSvg,
} from "../internal/icons.js";
import type { ToastType } from "./types.js";

// A single arc that spins via CSS (see :host([type="loading"]) .icon svg).
const loadingIcon = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" stroke-opacity="0.25"/>
    <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>
`;

export const toastIcons: Record<ToastType, string> = {
  info: infoIconSvg,
  success: successIconSvg,
  warn: warnIconSvg,
  error: errorIconSvg,
  loading: loadingIcon,
};
