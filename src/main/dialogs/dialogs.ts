// Public entry point for the dialogs feature. The implementation is split across the
// sibling modules (types, content, form-data, texts, buttons, icons, styles, view,
// element, controller); this file just re-exports the public surface, kept stable for
// ../index.ts and the package's `exports` map.

export { createDialogsController } from "./controller.js";
export { Dialog } from "./element.js";
export { createDialogTheme, defaultDialogTheme } from "./theme.js";
export { defaultDialogTexts } from "./texts.js";
export type { DialogTheme } from "./theme.js";

export type { ContentAdapter, Renderable } from "./content.js";
export type { DialogTexts } from "./texts.js";
export type { FormDialogData } from "./form-data.js";
export type {
  ActionButtonRender,
  ActionButtonType,
  BaseDialogConfig,
  CloseButtonRender,
  ConfirmDialogConfig,
  ConfirmDialogResult,
  DecideDialogConfig,
  DecideDialogResult,
  DialogRenderOverrides,
  DialogScope,
  DialogsController,
  DialogsControllerConfig,
  DialogType,
  ErrorDialogConfig,
  ErrorDialogResult,
  FormAttempt,
  FormDialogConfig,
  FormDialogResult,
  FormInteraction,
  InfoDialogConfig,
  InfoDialogResult,
  RejectMessageRender,
  Styles,
  SuccessDialogConfig,
  SuccessDialogResult,
  WarnDialogConfig,
  WarnDialogResult,
} from "./types.js";
