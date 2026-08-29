// -------------------------------------------------------------------
// The React i18n demo: switching the language while a dialog is open.
// -------------------------------------------------------------------
//
// One dialog, one paragraph in it, one button that changes the language. Nothing else, so
// that the two halves of the answer are visible on their own.
//
// # Your content follows because it subscribes
//
//   The JSX handed to `content` is a snapshot, not a live binding. React re-renders it
//   when a context it reads changes, which is exactly what `useTranslation()` gives you in
//   a real app. Read the language from a prop instead of from context and the content
//   stays in the language it opened with, no matter what else you do.
//
// # The library's own chrome follows because of `refreshKey`
//
//   Button labels and the default title come from `getText`, which the core reads while
//   building a spec - so something has to ask it to build a new one. React cannot notice a
//   language change on its own, and calling back into the core from a render would loop.
//   That is what the prop is for.
//
//   Drop either half and you get a half-translated dialog. The switch is worth trying with
//   `refreshKey` commented out.
//
// # The button is inside the dialog on purpose
//
//   A modal <dialog> is in the top layer, so nothing behind the backdrop can be clicked
//   while it is open. Switching the language from outside would mean closing the dialog
//   first, which is the one thing this page is not about. The page has its own copy of the
//   switch for when no dialog is up.

import { createContext, use, useState } from "react";
import { createRoot } from "react-dom/client";

import { EasyPopsProvider, useDialogs } from "../main/bindings/react/index.js";
import type { DialogTexts } from "../main/index.js";

type Lang = "en" | "de";

/** What the library asks for. Missing keys fall back to the built-in English. */
const CHROME: Record<Lang, Partial<DialogTexts>> = {
  en: {},
  de: {
    buttonOk: "Ok",
    buttonCancel: "Abbrechen",
    titleConfirmCritical: "Bestätigung",
  },
};

/** What this page says for itself. The library never sees these. */
const UI = {
  en: {
    heading: "React i18n demo",
    open: "Delete customer",
    question: "Delete Jane Doe? This cannot be undone.",
    switch: "Auf Deutsch umschalten",
    hint: "Open the dialog, then switch the language from inside it. The paragraph, the title and the buttons all change.",
    confirmed: "deleted",
    canceled: "canceled",
  },
  // Umlauts are content, not decoration: this is what the page says to a German reader.
  de: {
    heading: "React-i18n-Demo",
    open: "Kunde löschen",
    question:
      "Jane Doe wirklich löschen? Das kann nicht rückgängig gemacht werden.",
    switch: "Switch to English",
    hint: "Dialog öffnen, dann von innen die Sprache umschalten. Absatz, Titel und Buttons wechseln mit.",
    confirmed: "gelöscht",
    canceled: "abgebrochen",
  },
} as const;

// Stands in for i18next's provider. What matters is that dialog content reads the language
// from *here* rather than from a prop captured when the dialog opened.
const LangContext = createContext<{ lang: Lang; toggle: () => void }>({
  lang: "en",
  toggle: () => {},
});

const useLang = () => use(LangContext);

function Question() {
  const { lang, toggle } = useLang();
  return (
    <>
      <p>{UI[lang].question}</p>
      <p>
        <button
          id="lang-in-dialog"
          className="demo-btn"
          type="button"
          onClick={toggle}
        >
          {UI[lang].switch}
        </button>
      </p>
    </>
  );
}

function Page() {
  const dialogs = useDialogs();
  const { lang, toggle } = useLang();
  const [log, setLog] = useState<string[]>([]);

  // The log stores what happened, not a sentence about it. `lang` in this closure is
  // pinned to whatever it was when the dialog opened, so translating here would write a
  // stale line; resolving on render instead means the log re-translates with everything
  // else. That is the same rule the dialog content follows.
  async function remove() {
    const result = await dialogs.confirmCritical({ content: <Question /> });
    setLog((prev) =>
      [result.canceled ? "canceled" : "confirmed", ...prev].slice(0, 6),
    );
  }

  return (
    <main>
      <h1>{UI[lang].heading}</h1>
      <p>
        <button id="open" className="demo-btn" onClick={remove}>
          {UI[lang].open}
        </button>{" "}
        <button id="lang" className="demo-btn" onClick={toggle}>
          {UI[lang].switch}
        </button>
      </p>
      <p>{UI[lang].hint}</p>
      <ul id="log">
        {log.map((key, i) => (
          <li key={i}>
            {key === "confirmed" ? UI[lang].confirmed : UI[lang].canceled}
          </li>
        ))}
      </ul>
    </main>
  );
}

function App() {
  const [lang, setLang] = useState<Lang>("en");
  const toggle = () => setLang(lang === "en" ? "de" : "en");

  return (
    <LangContext value={{ lang, toggle }}>
      <EasyPopsProvider
        // Without this the title and the buttons would keep the language the dialog
        // opened with, while the paragraph above them changed.
        refreshKey={lang}
        config={{ dialogs: { icons: true, getText: (key) => CHROME[lang][key] } }}
      >
        <Page />
      </EasyPopsProvider>
    </LangContext>
  );
}

createRoot(document.getElementById("app")!).render(<App />);
