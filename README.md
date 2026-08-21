# EasyPops

A small, framework-agnostic browser library for **dialogs** (modal info / confirm / decide / form flows) and **toasts** (transient, auto-dismissing messages).

The idea is modest: most apps need a handful of well-behaved dialogs and a decent toast stack, and reaching for a big UI framework (or hand-rolling them for the hundredth time) both feel like too much. EasyPops tries to be the small, focused piece in between — it owns the accessibility, focus handling, animation and stacking, and stays out of your way on everything else.

> ⚠️ **Early days.** This is pre-`1.0` and still moving around a lot — public APIs, theming tokens, and defaults may change without notice, and there's no stable release yet. This README is a friendly placeholder; a proper one will be written from scratch once things settle down. The examples below show the current shape of things, but please treat them as a sketch rather than a contract.

## Highlights

- **Framework-agnostic core.** The core only ever deals with plain DOM `Node`s (and strings/primitives). It has no idea what React or Lit are.
- **Bring your own rendering.** Want to pass a Lit template or a React element as dialog/toast content? You hand the controller a small *content adapter* and the framework stays a detail on your side of the boundary — it never becomes a dependency of the library.
- **Two focused features.** Dialogs and toasts are developed together but kept cleanly separated, each behind its own entry point.
- **Themeable, per feature.** Each feature has its own small theme type with sensible, dark-mode-aware defaults. You override only the tokens you care about.
- **Optional i18n.** Text is overridable directly, and there's optional wiring for the [`js-lingo`](https://www.npmjs.com/package/js-lingo) translation library if you already use it.
- **SSR-friendly imports.** Importing the package never touches the DOM, so it's safe to pull into a server/SSR module graph; the DOM is only needed once you actually create a controller in the browser.
- **ESM, typed, no fuss.** Ships as an ESM package with TypeScript types and per-feature subpath exports.

## The two features

### Dialogs

A single controller exposes one-shot methods for the common modal patterns — `info`, `success`, `warn`, `error`, `confirm`, `decide`, and `form` — each with a `*Critical` variant for destructive actions (no accidental Enter-to-confirm, danger styling).

A few things it takes care of for you:

- **Typed results.** Each call resolves to a small discriminated union so you always know whether the user acted or canceled before you read any data.
- **Forms with retry.** A form dialog can be awaited for its first valid submit, or iterated (`for await`) so you can validate each attempt server-side and either accept it or reject it in place with an inline notice — without losing what the user typed.
- **Scopes.** Several dialogs can share one modal surface (the backdrop stays up between them), which is handy for wizard-like flows.
- **Cancellation.** Everything flows through `AbortSignal`, at both the scope and per-dialog level.

### Toasts

A controller with `info` / `success` / `warn` / `error`, each returning a handle you can later `update` or `dismiss`. There's also a `promise()` helper for the familiar loading → success / error pattern, plus `clear()` and `destroy()`.

The toast stack handles the fiddly bits — placement, a cap on how many are visible at once, hover-to-pause, swipe-to-dismiss, the shuffle animation as toasts come and go, and a countdown indicator.

## Installation

```bash
npm install easypops
```

## A quick look

> Again — sketch, not contract. Details will shift before release.

Dialogs, using the Lit content adapter:

```ts
import { createDialogsController, litDialogAdapter } from "easypops";

const dialogs = createDialogsController({
  adapter: litDialogAdapter,
  autoIcons: true,
});

// A simple message.
await dialogs.info({ content: "The document has been validated." });

// A confirmation — the result tells you what happened.
const result = await dialogs.confirm({ content: "Continue?" });
if (!result.canceled && result.action === "confirm") {
  // ...proceed
}

// A destructive action gets the critical variant.
await dialogs.confirmCritical({
  title: "Delete user",
  content: "This cannot be undone.",
  buttons: { confirm: "Delete" },
});
```

Toasts:

```ts
import { createToastController, litToastAdapter } from "easypops";

const toasts = createToastController({
  adapter: litToastAdapter,
  placement: "top-end",
  maxVisible: 4,
});

const handle = toasts.success({ message: "Saved." });
handle.dismiss();

// loading → success / error in one call
await toasts.promise(saveThing(), {
  loading: "Saving…",
  success: "Saved.",
  error: "Could not save.",
});
```

If you don't pass an adapter, a controller is simply **text-only** — it accepts strings and DOM nodes, which is all you need for plenty of cases.

## Content adapters

The core inserts `Node`s. To let it accept framework content, you give it an adapter that turns that content into a `Node`. A few come in the box:

- a **Lit** adapter (used throughout the demo),
- a **vanilla** adapter (strings / nodes),
- a **React** adapter, where React is injected by you rather than imported by the library, so React never sneaks into the dependency tree.

## Theming

Theming is split per feature — dialogs and toasts genuinely speak different visual vocabularies, so each has its own theme type, defaults, and a small factory to build one. You pass a partial theme to the controller and override only what you want; the defaults are dark-mode aware out of the box.

The exact theming *mechanism* is one of the parts still being cleaned up, so expect the internals here to change even if the public theme shapes mostly hold.

## Internationalisation (optional)

All user-facing text can be overridden directly on the controller. On top of that, there are optional entry points that wire the built-in text namespaces into [`js-lingo`](https://www.npmjs.com/package/js-lingo) (a peer dependency) — import them only if you're already using it.

## Server-side rendering

Importing the package is side-effect-free with respect to the DOM: no globals like `document` or `HTMLElement` are dereferenced at load time. That means it can sit in an SSR module graph (Next.js and friends) without throwing. The DOM only comes into play once you create a controller in the browser.

## Package layout

The package root re-exports both features, and there are subpath exports for the optional i18n wiring:

- `easypops` — the main entry (dialogs + toasts)
- `easypops/picolingo`, `easypops/picolingo/english`, `easypops/picolingo/german` — optional picolingo namespaces
- `easypops/picolingo/xwiki` — an integration stub (work in progress)

## Development

```bash
npm run dev        # Vite dev server serving the demo — the easiest way to try things by hand
npm run typecheck  # type-check everything; this is also the lint gate
npm run build      # emit the library to dist/
npm run preview    # preview the built demo
```

There's a hands-on demo under `src/demo/` that wires both features up with the Lit adapters and a component library, which is also the reference for the intended integration pattern.

There's intentionally no separate linter and no test runner yet — a clean type-check is currently the bar for "it passes". Tests are on the list.

## Status & caveats

- No published release, no stable API, and essentially no automated tests yet.
- Names, defaults, and theming details are actively changing.
- It's being built for a real use case first and generalised as it goes, so some rough edges are expected.

Feedback and ideas are very welcome. Just please don't build anything important on it quite yet.

## License

[MIT](./LICENSE).
