import { allTexts, bundleTexts } from "picolingo";
import { dialogTexts, toastTexts } from "./index.js";

export { germanTexts };

const germanTexts = bundleTexts({
  de: [
    allTexts(dialogTexts, {
      ok: "Ok",
      cancel: "Abbrechen",
      yes: "Ja",
      no: "Nein",
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
    }),
    allTexts(toastTexts, {
      dismiss: "Benachrichtigung ausblenden",
      info: "Information",
      success: "Erfolg",
      warn: "Warnung",
      error: "Fehler",
      loading: "Wird geladen",
    }),
  ],
});
