import { html, render } from "lit";

import {
  createDialogsController,
  createToastController,
  litToastAdapter,
  litDialogAdapter,
} from "../main/index.js";

import type {
  DialogType,
  FormDialogResult,
  Placement,
  ToastAppearance,
  ToastSize,
  ToastType,
} from "../main/index.js";

// Assigned after the page template is rendered into #app (bottom of this file).
let logEl: HTMLPreElement;

function log(label: string, value?: unknown): void {
  const time = new Date().toLocaleTimeString();
  const body = value === undefined ? "" : " " + JSON.stringify(value, null, 2);
  logEl.textContent = `[${time}] ${label}${body}\n\n` + logEl.textContent;
}

// `data` only exists on the non-canceled member of the result union, so narrow
// before reading it.
function logFormResult(label: string, result: FormDialogResult): void {
  if (result.canceled) {
    log(`${label} (canceled)`, result);
  } else {
    log(label, {
      canceled: false,
      action: result.action,
      data: result.data.toRecord(),
    });
  }
}

const plusIcon = html`
  <svg
    viewBox="0 0 16 16"
    width="1em"
    height="1em"
    fill="currentColor"
    aria-hidden="true"
  >
    <path
      d="M8 2a.75.75 0 0 1 .75.75V7.25h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2"
    />
  </svg>
`;

const pencilIcon = html`
  <svg
    viewBox="0 0 16 16"
    width="1em"
    height="1em"
    fill="currentColor"
    aria-hidden="true"
  >
    <path
      d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207zM12.793 5.5 10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325"
    />
  </svg>
`;

const trashIcon = html`
  <svg
    viewBox="0 0 16 16"
    width="1em"
    height="1em"
    fill="currentColor"
    aria-hidden="true"
  >
    <path
      d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"
    />
    <path
      fill-rule="evenodd"
      d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"
    />
  </svg>
`;

// `appearance` and `placement` are both read once, when the controller is built, so the
// pickers below can't just reassign them — each change has to tear the controller down
// and build a fresh one. Hence mutable module state plus a factory.
const INITIAL_APPEARANCE: ToastAppearance = "light";
const INITIAL_PLACEMENT: Placement = "top-end";
const INITIAL_SIZE: ToastSize = "medium";

// Annotated, not inferred: TypeScript narrows the consts above to their literal types,
// so `let appearance = INITIAL_APPEARANCE` would be typed `"light"` and reject any other
// appearance.
let appearance: ToastAppearance = INITIAL_APPEARANCE;
let placement: Placement = INITIAL_PLACEMENT;
let size: ToastSize = INITIAL_SIZE;

function createToasts() {
  return createToastController({
    adapter: litToastAdapter,
    maxVisible: 4,
    autoTitles: false,
    autoIcons: true,
    appearance,
    placement,
    size,
    overflow: "evict",
  });
}

let toasts = createToasts();

// destroy() clears the outgoing controller's timers and listeners and removes its stack
// container, so any toasts currently on screen go with it.
function rebuildToasts(): void {
  toasts.destroy();
  toasts = createToasts();
}

// A single controller for the whole page. getText / getDialogIcon are optional;
// omitting them uses the library's built-in English texts and default icons, and the
// library's own (native) action buttons.
const dialogs = createDialogsController({
  adapter: litDialogAdapter,
  autoIcons: true,
});

// Example form content, built from plain native form controls — no component library
// involved, which is the point: the dialog only needs a `name` per field and leans on
// native constraint validation, so `required` here is what blocks the confirm button.
const formContent = () => html`
  <label class="field">
    <span class="label-text">Name</span>
    <input
      name="name"
      placeholder="Jane Doe"
      required
      autofocus
      autocomplete="off"
    />
  </label>
  <label class="field">
    <span class="label-text">Email</span>
    <input
      type="email"
      name="email"
      placeholder="jane@example.com"
      autocomplete="off"
    />
  </label>
  <label class="field">
    <span class="label-text">Date of birth</span>
    <input type="date" name="dateOfBirth" required autocomplete="off" />
  </label>
  <label class="check">
    <input type="checkbox" name="subscribe" value="yes" />
    Subscribe to updates
  </label>
`;

// The dialog wraps slotted content in a `.content` element; this lays the fields out in
// a column and gives the native controls a look that matches the dialog chrome. Content
// is light DOM, so these plain selectors reach the inputs directly.
const formStyles = `
  .content { display: flex; flex-direction: column; gap: 1rem; }
  .field { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.9rem; }

  /* Checkbox rows read left-to-right, so they get their own class rather than .field. */
  .check { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; }

  /* Mandatory marker, selected off the input's own "required" attribute via :has()
     rather than hand-written into each label — so it can't drift out of sync with what
     actually blocks the confirm button. Decorative on purpose: "required" is what
     assistive tech announces, which is why this is a pseudo-element rather than text in
     the accessibility tree. (No backticks in here — this whole block is a JS template
     literal.) */
  .field:has(input:required) > .label-text::after {
    content: " *";
    color: #d03b3b;
  }

  .field input {
    box-sizing: border-box;
    width: 100%;
    font: inherit;
    font-size: 0.95rem;
    color: light-dark(#1f2430, #e7e9ee);
    background: light-dark(#ffffff, rgba(255, 255, 255, 0.06));
    border: 1px solid light-dark(#c3c7cf, #4a505a);
    border-radius: 3px;
    padding: 0.45em 0.6em;
    transition: border-color 120ms ease;
  }

  .field input::placeholder { color: light-dark(#8b919c, #7d848f); }

  .field input:hover { border-color: light-dark(#9aa0aa, #5c636e); }

  /* :user-invalid rather than :invalid, so an untouched required field isn't flagged
     red the moment the dialog opens. */
  .field input:user-invalid { border-color: #d03b3b; }

  /* Same focus treatment as the demo page's own buttons. */
  .field input:focus-visible,
  .check input:focus-visible {
    outline: 2px solid var(--ui-color-primary-500, #007EC6);
    outline-offset: 1px;
    border-color: var(--ui-color-primary-500, #007EC6);
  }

  .check input {
    width: 1rem;
    height: 1rem;
    margin: 0;
    accent-color: var(--ui-color-primary-500, #007EC6);
  }
`;

async function openByType(type: DialogType): Promise<void> {
  switch (type) {
    case "info":
      log(
        "Info result",
        await dialogs.info({
          content: `
            The XML document has been validated.
            Everything is fine.
          `,
        }),
      );
      break;
    case "success":
      log(
        "Success result",
        await dialogs.success({
          content: html`
            The temporary data files in directory <i>"tmp/data"</i><br />
            have been deleted successfully.
          `,
        }),
      );
      break;
    case "warn":
      log(
        "Warn result",
        await dialogs.warn({ content: "This action needs your attention." }),
      );
      break;
    case "error":
      log(
        "Error result",
        await dialogs.error({
          content:
            "Unexpected error: Invalid operation.\nTask could not be performed",
        }),
      );
      break;
    case "confirm":
      log(
        "Confirm result",
        await dialogs.confirm({
          content: "Are you sure you want to continue?",
        }),
      );
      break;
    case "confirmCritical":
      log(
        "Confirm critical result",
        await dialogs.confirmCritical({
          title: "Delete user",
          subtitle: "User: superuser",
          content:
            "Are you really sure that you want to delete the superuser?\n" +
            "You cannot undo this later.",
          buttons: { confirm: "Delete" },
        }),
      );
      break;
    case "decide":
      log(
        "Decide result",
        await dialogs.decide({ content: "Do you want to save your changes?" }),
      );
      break;
    case "decideCritical":
      log(
        "Decide critical result",
        await dialogs.decideCritical({
          content: "Discard unsaved changes before leaving?",
        }),
      );
      break;
    case "form": {
      const result = await dialogs.form({
        intro: "Please fill out the form.",
        content: formContent(),
        styles: formStyles,
      });
      logFormResult("Form result", result);
      break;
    }
    case "formCritical": {
      const result = await dialogs.formCritical({
        intro: "Confirm the destructive form.",
        content: formContent(),
        styles: formStyles,
        buttons: { confirm: "Apply" },
      });
      logFormResult("Form critical result", result);
      break;
    }
  }
}

// "confirmCritical" -> "Confirm critical" for the demo button labels.
function humanize(type: string): string {
  const spaced = type.replace(/-/g, " ").replace(/([A-Z])/g, " $1").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// A demo trigger button; uniform grayish look, clicks wired in the template below.
const notifier = (type: Exclude<ToastType, "loading">) => html`
  <button
    class="demo-btn"
    @click=${() =>
      void toasts[type]({
        message: "Toast sent at " + new Date().toLocaleTimeString(),
        actions: [
          {
            label: "Click me",
            onClick: () => alert("Woohoo"),
          },
        ],
      })}
  >
    ${humanize(type)}
  </button>
`;

// Loading -> success/error the declarative way, via promise(): hand it the promise plus
// content for the three phases and it owns the transition, including the failure path.
// The toast is sticky while in flight (loading toasts have no countdown) and the same
// toast is swapped in place when the promise settles. The 3s timeout stands in for a
// request; `success` is written as a function to show it receiving the resolved value.
async function runLoadingToast(): Promise<void> {
  const work = new Promise<string>((resolve) =>
    setTimeout(() => resolve("Report ready"), 3000),
  );

  const handle = toasts.promise(work, {
    loading: "Generating report…",
    success: (value) => value,
    error: "Could not generate the report",
  });

  // handle.result rejects whenever the input promise does; this one always resolves, so
  // there's nothing to catch here.
  log("Toast promise settled", await handle.result);
}

// The same transition driven by hand, via the loading() primitive that promise() is built
// on. Worth showing separately because the imperative form can do something promise()
// structurally cannot: keep updating the toast while the work is still in flight.
//
// The try/catch is not optional here — nothing reaps a loading toast, so a throw between
// loading() and the settle would strand it on screen. (This particular loop can't throw,
// but the shape is the point.)
async function runLoadingWithProgress(): Promise<void> {
  const toast = toasts.loading({
    message: "Uploading 0%",
    // Unclosable while in flight, so the upload can't be dismissed halfway.
    dismissible: false,
  });

  try {
    for (let percent = 20; percent <= 100; percent += 20) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      toast.update({ message: `Uploading ${percent}%` });
    }
    // dismissible has to be switched back on by hand: settling patches only the fields
    // it's handed, so the `false` above would otherwise carry over and leave a settled
    // toast the user can't close (it would still auto-dismiss on the countdown).
    toast.success({ message: "Upload complete", dismissible: true });
    log("Toast loading settled", "success");
  } catch (error) {
    toast.error({ message: `Upload failed: ${String(error)}`, dismissible: true });
    log("Toast loading settled", "error");
  }
}

const APPEARANCES: readonly ToastAppearance[] = ["light", "solid", "dark"];
const SIZES: readonly ToastSize[] = ["small", "medium", "large"];

const PLACEMENTS: readonly Placement[] = [
  "top-start",
  "top-center",
  "top-end",
  "bottom-start",
  "bottom-center",
  "bottom-end",
];

// Shared by the appearance and size rows, which are structurally identical.
//
// Radios rather than checkboxes: the values in each group are mutually exclusive, and a
// native radio group also gets arrow-key navigation and "1 of 3" announcements for free.
// The browser owns the checked state, so a pick only has to update module state and
// rebuild — the page itself is rendered once and never re-rendered.
//
// role="group" on a plain div, not <fieldset>/<legend>: a styled <legend> is laid out
// out-of-flow by the UA and won't sit as a flex item in the row.
function radioGroup<T extends string>(
  name: string,
  label: string,
  options: readonly T[],
  initial: T,
  pick: (value: T) => void,
) {
  return html`
    <div class="choice-group" role="group" aria-labelledby="${name}-label">
      <span class="choice-group-label" id="${name}-label">${label}</span>
      ${options.map(
        (option) => html`
          <label class="choice-option">
            <input
              type="radio"
              name=${name}
              value=${option}
              ?checked=${option === initial}
              autocomplete="off"
              @change=${() => {
                pick(option);
                rebuildToasts();
                log(`Toast ${label.toLowerCase()}`, option);
              }}
            />
            ${humanize(option)}
          </label>
        `,
      )}
    </div>
  `;
}

const appearancePicker = () =>
  radioGroup(
    "toast-appearance",
    "Appearance",
    APPEARANCES,
    INITIAL_APPEARANCE,
    (value) => {
      appearance = value;
    },
  );

const sizePicker = () =>
  radioGroup("toast-size", "Size", SIZES, INITIAL_SIZE, (value) => {
    size = value;
  });

// A <select> here rather than a radio row like the two groups above: six options with
// two-word labels would wrap across several lines in this column, where a select stays
// one compact control. Same one-of-many semantics either way.
const placementPicker = () => html`
  <div class="choice-group">
    <label class="choice-group-label" for="toast-placement">Placement</label>
    <select
      id="toast-placement"
      class="demo-select"
      autocomplete="off"
      @change=${(event: Event) => {
        placement = (event.target as HTMLSelectElement).value as Placement;
        rebuildToasts();
        log("Toast placement", placement);
      }}
    >
      ${PLACEMENTS.map(
        (option) => html`
          <option value=${option} ?selected=${option === INITIAL_PLACEMENT}>
            ${humanize(option)}
          </option>
        `,
      )}
    </select>
  </div>
`;

// A demo trigger button; native <button> with the outline look from demo.css.
const trigger = (type: DialogType) => html`
  <button class="demo-btn" @click=${() => void openByType(type)}>
    ${humanize(type)}
  </button>
`;

// Scope demo: two dialogs sharing one surface, torn down at the end.
async function runWizard(): Promise<void> {
  const scope = dialogs.open();
  try {
    const step1 = await scope.confirm({
      title: "Step 1 of 2",
      content: "Proceed to the form?",
    });
    if (step1.canceled) {
      log("wizard canceled at step 1", step1);
      return;
    }

    // Simulate async work between steps. The step-1 dialog stays open the whole
    // time (the scope always shows a dialog), so the pressed button shows its
    // 150ms-delayed spinner for these 2 seconds.
    await new Promise((r) => setTimeout(r, 2000));

    const step2 = await scope.form({
      title: "Step 2 of 2",
      intro: "Enter your details.",
      content: formContent(),
      styles: formStyles,
    });

    logFormResult("Wizard finished", step2);
  } finally {
    scope.close();
  }
}

// "Slow open": open a scope but delay the first dialog past the placeholder delay
// (~300ms) so the round spinner dialog appears and then morphs into the real one.
async function runSlow(): Promise<void> {
  const scope = dialogs.open();
  try {
    await new Promise((r) => setTimeout(r, 2000));
    const result = await scope.confirmCritical({
      title: "Delete directory",
      content:
        'Do you really want to the delete the directory "/var/app/data"?\nIt contains 125 files which will also be deleted.',
      buttons: {
        confirm: "Delete",
      },
    });

    if (result.canceled) {
      return;
    }

    await new Promise((r) => setTimeout(r, 1500));

    await scope.success({
      content: "The directory has been deleted successfully.",
    });
    log("slow open result", result);
  } finally {
    scope.close();
  }
}

// Login with retry: the form is an async-iterable "interaction". Each iteration is
// a submit attempt; the caller does async work and then accept()s or reject()s it.
// reject() keeps the *same* dialog open (entered values preserved) and shows a reject
// message.
// Awaiting the interaction after the loop yields the final result (accepted or canceled).
async function runLogin(): Promise<void> {
  const session = dialogs.open();
  try {
    const login = session.formAttempts({
      title: "Sign in",
      content: html`
        <label class="field">
          <span class="label-text">Email</span>
          <input
            type="email"
            name="email"
            required
            value="jane.doe@gmail.com"
            autofocus
            autocomplete="off"
          />
        </label>
        <label class="field">
          <span class="label-text">Password</span>
          <!-- "new-password", not "off": browsers deliberately ignore
               autocomplete="off" on password fields, but treating this as a *new*
               password does keep the password manager from filling a saved one. -->
          <input
            type="password"
            name="password"
            required
            value="xyz"
            autocomplete="new-password"
          />
        </label>
      `,
      styles: formStyles,
      buttons: { confirm: "Sign in" },
    });

    for await (const attempt of login) {
      const password = attempt.data.string("password", "");

      // Fake server round-trip — the Sign in button shows its spinner meanwhile.
      await new Promise((r) => setTimeout(r, 1500));

      if (password === "secret") {
        attempt.accept(); // resolves the interaction and ends the loop
      } else {
        attempt.reject(
          "Wrong email or password. Please try again.",
          "Login failed",
        );
      }
    }

    if (!login.result?.canceled) {
      await session.success({
        content: "Congratulations! You are logged in.",
      });
    }

    // After the loop, `result` says whether the form was confirmed or canceled.
    const result = login.result;
    if (!result || result.canceled) {
      log("login canceled", result);
    } else {
      log("Login result", {
        ...result,
        data: result.data.toRecord(),
      });
    }
  } finally {
    session.close();
  }
}

// The drawer surface: the same form contract as runLogin() above, on a full-height panel
// at the inline-end edge. Uses drawerAttempts() rather than drawer(), which is the point
// of the pair — a wide edit panel is exactly where you don't want to close on submit and
// lose what was typed.
async function runDrawer(): Promise<void> {
  const drawer = dialogs.drawerAttempts({
    title: "Edit customer",
    content: formContent(),
    styles: formStyles,
    buttons: { confirm: "Save" },
  });

  for await (const attempt of drawer) {
    // Stand-in for a server round-trip; the Save button shows its spinner meanwhile.
    await new Promise((resolve) => setTimeout(resolve, 1200));

    if (attempt.data.string("name", "") === "nope") {
      attempt.reject("That name is already taken.", "Could not save");
    } else {
      attempt.accept();
    }
  }

  logFormResult("Drawer result", await drawer);
}

// -------------------------------------------------------------------
// Page template — the whole demo UI lives here; index.html only hosts #app.
// -------------------------------------------------------------------

const page = html`
  <main class="page">
    <div>
      <section>
        <h2>Toasts</h2>
        <div class="row">
          ${notifier("info")} ${notifier("success")} ${notifier("warn")}
          ${notifier("error")}
          <button class="demo-btn featured" @click=${() => void runLoadingToast()}>
            Loading → Success
          </button>
          <button class="demo-btn featured" @click=${() => void runLoadingWithProgress()}>
            Loading with progress
          </button>
        </div>
        <div class="row">${appearancePicker()}</div>
        <div class="row">${sizePicker()}</div>
        <div class="row">${placementPicker()}</div>
      </section>

      <section>
        <h2>Message dialogs</h2>
        <div class="row">
          ${trigger("info")} ${trigger("success")} ${trigger("warn")}
          ${trigger("error")}
        </div>
      </section>

      <section>
        <h2>Confirm &amp; decide</h2>
        <div class="row">
          ${trigger("confirm")} ${trigger("confirmCritical")}
          ${trigger("decide")} ${trigger("decideCritical")}
        </div>
      </section>

      <section>
        <h2>Forms</h2>
        <div class="row">
          ${trigger("form")} ${trigger("formCritical")}
        </div>
      </section>

      <section>
        <h2>Scope (sequential dialogs sharing one surface)</h2>
        <div class="row">
          <button class="demo-btn featured" @click=${() => void runWizard()}>
            Run 2-step wizard
          </button>
          <button class="demo-btn featured" @click=${() => void runSlow()}>
            Slow open (shows spinner placeholder)
          </button>
        </div>
      </section>

      <section>
        <h2>Drawer</h2>
        <div class="row">
          <button class="demo-btn featured" @click=${() => void runDrawer()}>
            Edit in drawer (reject on name "nope")
          </button>
        </div>
      </section>

      <section>
        <h2>Form retry with reject message</h2>
        <div class="row">
          <button class="demo-btn" @click=${() => void runLogin()}>
            Login (retry until password is "secret")
          </button>
        </div>
      </section>
    </div>
    <section class="results">
      <h2>Result log</h2>
      <pre id="log" aria-live="polite"></pre>
    </section>
  </main>
`;

render(page, document.getElementById("app")!);
logEl = document.getElementById("log") as HTMLPreElement;
