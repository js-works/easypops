// -------------------------------------------------------------------
// The React demo: a form dialog built from a schema.
// -------------------------------------------------------------------
//
// The point of this page is how little of it there is. easypops opens the dialog and owns
// the <form>; a zod schema owns everything about the fields; Mantine renders them. There
// is no field component here, no error state, no CSS and no aria wiring, because none of
// those are things a caller should have to write.
//
// # One model, read three ways
//
//   The zod object below is the only place a field is described. Three things read it:
//
//   - schemaResolver validates values against it and hands Mantine the messages;
//   - z.toJSONSchema() turns it into field metadata (which fields are mandatory, what each
//     is called, what kind of input the value wants), and Mantine's enhanceGetInputProps
//     feeds that to every input;
//   - the confirm button asks it for a verdict, through `validator`.
//
//   So a field is one line of JSX containing nothing but its path. Adding a field, making
//   one optional or renaming a label is a change to the model and to nothing else.
//
// # Native validation is off
//
//   `nativeValidation: false` puts `novalidate` on the library's <form>. The constraint
//   attributes stay where they are, so assistive technology still hears `required` and
//   phones still get the right keyboard from `type="email"`; only the browser's own
//   reporting steps aside. Without it a half-typed date raises a native bubble no matter
//   what attributes you leave off, and one kind of problem would have two presentations.
//
// # Validation and rejection are different things
//
//   `validator` is the client-side gate: it runs on a confirm click and returning false
//   keeps the dialog open. Everything after it is the retry loop below, where a confirm
//   is an attempt the "server" can reject - which also keeps the dialog open, with the
//   values intact, and shows a note instead of a field error.

import { useState, createContext, use } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  Button,
  CloseButton,
  Group,
  MantineProvider,
  MantineThemeProvider,
  Select,
  TextInput,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { schemaResolver, useForm } from "@mantine/form";
import type { UseFormReturnType } from "@mantine/form";
import { z } from "zod";

import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "./react.css";

import { EasyPopsProvider, useDialogs } from "../main/bindings/react/index.js";
import type { EasyPopsConfig } from "../main/bindings/react/index.js";
import type { ActionButtonType } from "../main/index.js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// -------------------------------------------------------------------
// The model
// -------------------------------------------------------------------

// `.meta()` is where the label lives. It is part of the schema rather than the markup for
// the same reason the messages are: a field is described once, in one place.
//
// `born` is a plain string rather than z.iso.date() because an untouched date input reads
// as "", which is not a date. `.optional()` is still what makes it non-mandatory below,
// and `format` in the meta is what makes it render as a date picker.
const model = z.object({
  username: z
    .string()
    .min(3, "At least three characters.")
    .refine((v) => v.trim().toLowerCase() !== "admin", '"admin" is reserved.')
    .meta({ title: "Username" }),
  fullName: z
    .string()
    .min(2, "At least two characters.")
    .meta({ title: "Full name" }),
  email: z.email("That is not a valid email address.").meta({ title: "Email" }),
  // The options live in the model too, so the dropdown has nothing to declare either.
  gender: z
    .enum(["female", "male", "other"], "Please choose one.")
    .meta({ title: "Gender" }),
  born: z
    .string()
    .nullable()
    .optional()
    .refine((v) => v == null || v === "" || v <= today(), "That date is in the future.")
    .meta({ title: "Date of birth", format: "date" }),
});

type Values = z.infer<typeof model>;

// The one place the form is looser than the model: "nothing chosen yet" is a state the
// dropdown can be in and the schema rejects, which is exactly what makes it a required
// field the user has to answer.
type FormValues = Omit<Values, "gender"> & { gender: Values["gender"] | "" };

// The model, read as data. JSON Schema is zod's own standard view of it: `required` lists
// the mandatory paths, `title` carries the label, `format` says what the value is.
const shape = z.toJSONSchema(model, { unrepresentable: "any" });
const mandatory = new Set(shape.required ?? []);
const properties = (shape.properties ?? {}) as Record<
  string,
  { title?: string; format?: string; enum?: string[] }
>;

// Only the formats this form uses. `date` is absent on purpose: that field is rendered by
// Mantine's DateInput, which brings its own editor, and an input type would fight it.
const INPUT_TYPES: Record<string, string> = { email: "email" };

// Inline SVG rather than the CSS-mask trick the error badge uses: that one decorates an
// element Mantine renders and we cannot pass anything to, so it had to be done from a
// stylesheet. Here the component takes an element, which is the simpler answer.
function FieldIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1.1em"
      height="1.1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** One glyph per format the model can describe. */
const FORMAT_ICONS: Record<string, ReactNode> = {
  date: (
    <FieldIcon>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </FieldIcon>
  ),
  email: (
    <FieldIcon>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 8 9 6 9-6" />
    </FieldIcon>
  ),
};

// Hand a click on the icon to the field it decorates. The section sits next to the input
// inside Mantine's wrapper, so the wrapper is the nearest thing that holds both.
function focusOwnInput(event: { currentTarget: HTMLElement }): void {
  event.currentTarget
    .closest(".mantine-Input-wrapper")
    ?.querySelector("input")
    ?.focus();
}

/** Everything an input can learn about itself from the model. */
function fromModel(field: string) {
  const spec = properties[field] ?? {};
  return {
    name: field, // so the library's FormData view still sees the field
    label: spec.title,
    required: mandatory.has(field),
    type: INPUT_TYPES[spec.format ?? ""] ?? "text",
    // Only a schema with an enum has options, and only a Select reads them - so this is
    // absent everywhere else rather than an empty array nobody wants.
    ...(spec.enum ? { data: spec.enum } : {}),
    // Same idea for the glyphs: the model names a format, and that format has a picture.
    //
    // The section stays clickable rather than pointer-events: none, because a cursor can
    // only be shown for something the pointer can actually hit - and the icon should look
    // like part of the field, not like a sticker on top of it. Being clickable then has to
    // mean something, so a click is handed on to the input: for the date field that opens
    // the picker, for the others it puts the caret where the user just aimed.
    ...(spec.format && FORMAT_ICONS[spec.format]
      ? {
          rightSection: FORMAT_ICONS[spec.format],
          rightSectionProps: { onClick: focusOwnInput },
        }
      : {}),
  };
}

// -------------------------------------------------------------------
// The dialog
// -------------------------------------------------------------------

// The form object lives above <EasyPopsProvider>, so the dialog's portal is inside it.
// Handing it to the content as a prop instead would freeze it at the value it had when
// the dialog opened, and the errors would never appear.
const FormContext = createContext<UseFormReturnType<FormValues> | null>(null);
const useDialogForm = () => use(FormContext)!;

// One line per field. Everything else - label, asterisk, error message, input type,
// aria-invalid, aria-describedby, the red border - comes from the model by way of
// enhanceGetInputProps, or from Mantine.
function Fields() {
  const form = useDialogForm();
  return (
    <>
      <TextInput {...form.getInputProps("username")} />
      <TextInput {...form.getInputProps("fullName")} />
      <TextInput {...form.getInputProps("email")} />
      {/* Still one line each: the options come from the model's enum, and the popup lands
          in the top layer because of wrapContent below - not because of anything here. */}
      <Select {...form.getInputProps("gender")} />
      <DateInput {...form.getInputProps("born")} />
    </>
  );
}

function Page() {
  const dialogs = useDialogs();
  const form = useDialogForm();
  const [log, setLog] = useState<string[]>([]);

  async function edit() {
    form.reset();

    const dialog = dialogs.form({
      title: "Edit customer",
      content: <Fields />,
      // No `styles`: Mantine renders the fields, so the dialog needs no CSS of its own.
      // The error-message animation is page-level and lives in react.css.
      nativeValidation: false,
      validator: {
        // Mantine writes the messages into form.errors and re-renders <Fields/> itself;
        // returning false is all easypops needs to hear. The promise is the library's
        // own - while it is pending the confirm button spins and further clicks are
        // dropped, and Cancel and Escape stay live.
        validate: async () => !(await form.validate()).hasErrors,
      },
    });

    for await (const dialogAttempt of dialog) {
      // The inputs carry a `name`, so the library's own FormData view works. Mantine's
      // form.getValues() is the typed alternative.
      const username = dialogAttempt.data.string("username", "");
      // Fake server round-trip, so the confirm button shows its spinner meanwhile.
      await new Promise((resolve) => setTimeout(resolve, 800));
      if (username === "nope") {
        dialogAttempt.reject(
          "That username is already taken.",
          "Could not save",
        );
      } else {
        dialogAttempt.accept();
      }
    }

    const result = await dialog;
    setLog((prev) =>
      [
        result.canceled
          ? `canceled (aborted: ${result.aborted})`
          : `saved: ${result.data.string("username", "")}`,
        ...prev,
      ].slice(0, 6),
    );
  }

  return (
    <main>
      <h1>React demo</h1>
      <Group>
        <Button id="open" onClick={edit}>
          Edit customer
        </Button>
      </Group>
      <p>
        Try a two-letter username, "admin", a broken email, or a birthday in the
        future. Submitting the username "nope" is rejected by the "server".
      </p>
      <ul id="log">
        {log.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </main>
  );
}

// -------------------------------------------------------------------
// The library config
// -------------------------------------------------------------------

// Everything a Mantine popup needs to work inside a modal dialog, and the reason it is
// needed. A <dialog> opened with showModal() lives in the browser's top layer, which paints
// above the whole document; Mantine's popups portal to document.body, which does not - so
// by default a dropdown or a calendar renders *behind* the dialog, and is inert with it.
//
// Pointing the portal at a node inside the dialog fixes both: the panel is then part of the
// dialog's subtree, so it inherits the top layer and stays interactive. `floatingStrategy`
// takes it out of flow so the dialog's own scrolling cannot clip it.
//
// The target has to come from inside the dialog, which is why this is a component and not a
// line in the app's theme: the app root has one theme and no idea which dialog anything is
// in. MantineThemeProvider merges with the theme above it rather than replacing it, so
// nothing outside dialogs is affected.
function DialogPopups({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const popup = {
    portalProps: { target: target ?? undefined },
    floatingStrategy: "fixed",
  } as const;

  return (
    <MantineThemeProvider
      theme={{
        components: {
          Select: { defaultProps: { comboboxProps: popup } },
          DateInput: { defaultProps: { popoverProps: popup } },
        },
      }}
    >
      <div ref={setTarget} />
      {children}
    </MantineThemeProvider>
  );
}

// The library's three button roles, mapped onto Mantine's.
const MANTINE_BUTTON: Record<
  ActionButtonType,
  { variant?: string; color?: string }
> = {
  primary: {},
  secondary: { variant: "default" },
  danger: { color: "red" },
};

// Every dialog this app opens is built from Mantine components. A render override is
// all or nothing: easypops draws no chrome of its own for a part that has one, and slots
// the returned element in instead. So each override owns the states the library's own
// version had - the confirm button's spinner, the close button's accessible name.
//
// Nothing here depends on component state, so it is a module constant rather than a
// literal in the tree: rebuilding it on every render would hand the provider a new
// config object each time.
const EASYPOPS_CONFIG: EasyPopsConfig = {
  dialogs: {
    icons: true,
    // Installed once here rather than wrapped around every `content`: forgetting one
    // dialog would put its popups behind the backdrop, and nothing would say so. Skipped
    // for dialogs with no form, which have nothing that opens a popup.
    wrapContent: (content, { hasForm }) =>
      hasForm ? <DialogPopups>{content}</DialogPopups> : content,
    render: {
      actionButton: ({ text, variant, loading, onClick }) => (
        <Button {...MANTINE_BUTTON[variant]} loading={loading} onClick={onClick}>
          {text}
        </Button>
      ),
      // The descriptor carries only the handler, so the label is ours to supply - the
      // library's own X has one, and leaving it off would make the override less
      // accessible than what it replaced.
      closeButton: ({ onClose }) => (
        <CloseButton aria-label="Close" onClick={onClose} />
      ),
    },
  },
};

function App() {
  const form = useForm<FormValues>({
    initialValues: {
      username: "janedoe",
      fullName: "Jane Doe",
      email: "jane@example.com",
      gender: "female",
      born: "",
    },
    // No resolver package: zod implements Standard Schema, which is what this takes.
    // Async by default, so form.validate() below returns a promise.
    validate: schemaResolver(model),
    // The one hook that makes a field a single line: every input gets the props the
    // model already knows about it.
    enhanceGetInputProps: ({ field }) => ({
      ...fromModel(field as string),
      // Not from the model - a demo form has nothing worth remembering, and the
      // browser's saved-value dropdown would cover the fields underneath it. Set per
      // field because the <form> belongs to the library and a caller cannot reach it.
      autoComplete: "off",
    }),
  });

  return (
    <MantineProvider>
      <FormContext value={form}>
        <EasyPopsProvider config={EASYPOPS_CONFIG}>
          <Page />
        </EasyPopsProvider>
      </FormContext>
    </MantineProvider>
  );
}

createRoot(document.getElementById("app")!).render(<App />);
