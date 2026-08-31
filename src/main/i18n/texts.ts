// -------------------------------------------------------------------
// Bundled translations, and picking one from the document's own language.
// -------------------------------------------------------------------
//
// For applications with no translation system at all. An app that has one should pass
// `getText` (or use easypops/picolingo, which wraps these same tables) — that always wins;
// what follows only fills the gaps.
//
// The language comes from <html lang>, read when a dialog opens or a toast renders rather
// than once at load, so a page that switches language is followed by everything opened
// afterwards. Anything already on screen is refreshed the way it always was.
//
// Matching is BCP-47 shortest-first: an exact tag, then its primary subtag, then English.
// That is what makes region variants work without shipping a table for each — "de-AT" and
// "de-CH" both land on "de", which is correct for them until a string actually diverges.

import type { DialogTexts, TextKey } from "../dialogs/contract/texts.js";
import { defaultDialogTexts } from "../dialogs/contract/texts.js";
import type { ToastTexts } from "../toasts/contract/texts.js";
import { defaultToastTexts } from "../toasts/contract/texts.js";

/**
 * German dialog texts. Typed as the full {@link DialogTexts} rather than a partial, so a
 * key added to {@link defaultDialogTexts} fails to compile here instead of silently
 * falling back to English.
 */
export const germanDialogTexts: DialogTexts = {
  buttonOk: "Ok",
  buttonCancel: "Abbrechen",
  buttonYes: "Ja",
  buttonNo: "Nein",
  titleInfo: "Information",
  titleSuccess: "Erfolg",
  titleWarn: "Warnung",
  titleError: "Fehler",
  titleConfirm: "Bestätigung",
  titleConfirmCritical: "Bestätigung",
  titleDecide: "Entscheidung",
  titleDecideCritical: "Entscheidung",
  titleForm: "Eingabe",
  titleFormCritical: "Eingabe",
  titleDrawer: "Eingabe",
  titleDrawerCritical: "Eingabe",
};

/** German toast texts. Same completeness guarantee as {@link germanDialogTexts}. */
export const germanToastTexts: ToastTexts = {
  dismiss: "Benachrichtigung ausblenden",
  info: "Information",
  success: "Erfolg",
  warn: "Warnung",
  error: "Fehler",
  loading: "Wird geladen",
};

// English is the entry for "en" as well as the final fallback, so it is named once here
// rather than special-cased in the lookup.
const DIALOG_TABLES: Record<string, DialogTexts> = {
  en: defaultDialogTexts,
  de: germanDialogTexts,
};

const TOAST_TABLES: Record<string, ToastTexts> = {
  en: defaultToastTexts,
  de: germanToastTexts,
};

/**
 * The document's declared language, lowercased. Empty or absent counts as "en-us" — an
 * unlabelled document is not evidence of any particular language, and English is what the
 * library shipped before this existed.
 */
function documentLanguage(): string {
  if (typeof document === "undefined") {
    return "en-us";
  }
  return document.documentElement.lang.trim().toLowerCase() || "en-us";
}

function lookup<T>(tables: Record<string, T>, fallback: T): T {
  const tag = documentLanguage();
  return tables[tag] ?? tables[tag.split("-")[0]] ?? fallback;
}

export function bundledDialogText(key: TextKey): string {
  return lookup(DIALOG_TABLES, defaultDialogTexts)[key];
}

export function bundledToastText(key: keyof ToastTexts): string {
  return lookup(TOAST_TABLES, defaultToastTexts)[key];
}
