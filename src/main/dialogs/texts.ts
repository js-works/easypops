// -------------------------------------------------------------------
// # Default texts
// -------------------------------------------------------------------

export const defaultDialogTexts = {
  ok: "OK",
  cancel: "Cancel",
  yes: "Yes",
  no: "No",

  titleInfo: "Information",
  titleSuccess: "Success",
  titleWarn: "Warning",
  titleError: "Error",
  titleConfirm: "Confirmation",
  titleConfirmCritical: "Confirmation",
  titleDecide: "Please decide",
  titleDecideCritical: "Please decide",
  titleForm: "Form",
  titleFormCritical: "Form",
} as const;

export type DialogTexts = Record<keyof typeof defaultDialogTexts, string>;

export type TextKey = keyof typeof defaultDialogTexts;
