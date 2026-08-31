// Public entry point for the dialogs feature. The implementation is split across the
// sibling modules (dialog, content, adapter, form-data, texts, buttons, icons, styles,
// view, element, controller); this file just re-exports the public surface, kept stable
// for ../index.ts and the package's `exports` map.

export { createDialogsController } from "./controller/controller.js";
export type {
  DialogAdapter,
  DialogAdapterFactory,
  DialogProps,
  DialogSlots,
  DialogSpec,
} from "./contract/adapter.js";
export { Dialog } from "./element/element.js";
export { createDialogTheme, defaultDialogTheme } from "./contract/theme.js";
export { defaultDialogTexts } from "./contract/texts.js";
export type { DialogTheme } from "./contract/theme.js";

export type { Renderable } from "./contract/content.js";
export type { DialogTexts } from "./contract/texts.js";
export { FormDialogData } from "./contract/form-data.js";
export type {
  ActionButtonRender,
  ActionButtonType,
  DialogConfig,
  ButtonRole,
  CloseButtonRender,
  ConfirmDialogResult,
  DecideDialogResult,
  DialogInfo,
  DialogRenderOverrides,
  DialogScope,
  DialogsController,
  DialogsControllerConfig,
  DialogType,
  DialogViewConfig,
  FormAttempt,
  FormDialogConfig,
  FormDialogResult,
  DialogHandle,
  FormDialogHandle,
  FormValidator,
  MessageDialogResult,
  NoteRender,
} from "./contract/dialog.js";
