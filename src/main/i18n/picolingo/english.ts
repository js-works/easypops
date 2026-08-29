import { allTexts, bundleTexts } from "picolingo";
import { dialogTexts, toastTexts } from "./index.js";
import { defaultDialogTexts, defaultToastTexts } from "../../index.js";

export { englishTexts };

const englishTexts = bundleTexts({
  en: [
    allTexts(dialogTexts, defaultDialogTexts),
    allTexts(toastTexts, defaultToastTexts),
  ],
});
