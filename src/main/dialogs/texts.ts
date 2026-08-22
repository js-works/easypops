// -------------------------------------------------------------------
// # Default texts
// -------------------------------------------------------------------

// Keys are named <category><Thing> so the category is readable without knowing the
// library, and so a key named for a thing can't box out a later key for the same thing in
// another role ("Information" is both a title and, potentially, a button).
export const defaultDialogTexts = {
  buttonOk: "OK",
  buttonCancel: "Cancel",
  buttonYes: "Yes",
  buttonNo: "No",

  // The `*Critical` titles duplicate their non-critical siblings in English on purpose —
  // they're separate keys so a translator can differentiate where a language would. Don't
  // collapse them.
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
  titleDrawer: "Form",
} as const;

export type DialogTexts = Record<keyof typeof defaultDialogTexts, string>;

export type TextKey = keyof typeof defaultDialogTexts;
