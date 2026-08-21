// Register a custom element under the first free `${prefix}-N` tag (N starting at 1),
// skipping any name already taken — e.g. by a second copy of this library on the same
// page. Returns the chosen tag plus its index; the index doubles as a per-load id seed
// (used to scope one library load's styles apart from another's).
export function registerFirstFreeTag(
  prefix: string,
  ctor: CustomElementConstructor,
): { tag: string; index: number } {
  let index = 1;
  let tag = `${prefix}-${index}`;
  while (customElements.get(tag)) {
    index += 1;
    tag = `${prefix}-${index}`;
  }
  customElements.define(tag, ctor);
  return { tag, index };
}
