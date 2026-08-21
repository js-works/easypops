// camelCase key -> `--kebab-case` custom property, e.g. `infoAccent` -> `--info-accent`.
// Shared by any part of the library that projects a theme object onto CSS variables.
export function toCssVariable(key: string): string {
  return "--" + key.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());
}
