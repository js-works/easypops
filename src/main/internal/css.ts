/**
 * Marks a template literal as CSS. At runtime it only joins the pieces — the point is the
 * tag itself, which `scripts/strip-css-comments.mts` looks for after the build to drop the
 * comments from what ships. They stay in `src`; only `dist` loses them.
 *
 * A tag rather than a filename convention because the stripper has to be sure a string is
 * CSS before touching it, and because a stylesheet may live in a module that also holds
 * ordinary strings (see toasts/element.ts).
 */
export function css(
  strings: TemplateStringsArray,
  ...values: unknown[]
): string {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    out += String(values[i]) + strings[i + 1];
  }
  return out;
}

// camelCase key -> `--kebab-case` custom property, e.g. `infoAccent` -> `--info-accent`.
// Shared by any part of the library that projects a theme object onto CSS variables.
export function toCssVariable(key: string): string {
  return "--" + key.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());
}
