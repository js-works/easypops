// -------------------------------------------------------------------
// # FormDialogData
// -------------------------------------------------------------------

/** Values treated as `false` by `boolean()`, compared case-insensitively. */
const FALSY_FORM_VALUES = new Set(["", "0", "false", "off", "no"]);

/** True if `value` is a File. Guards against `File` being undefined off the DOM. */
function isFile(value: unknown): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

/**
 * The data collected from a form dialog. Extends the standard `FormData`, so the whole
 * native API (`get`, `getAll`, `has`, `entries`, …) is available, and adds small typed
 * accessors that handle missing values and coercion for the common cases.
 */
export class FormDialogData extends FormData {
  /** First value for `key` as a string; `null` if absent (or the field is a File). */
  string(key: string): string | null;
  /** First value for `key` as a string; `fallback` if absent. */
  string(key: string, fallback: string): string;
  string(key: string, fallback: string | null = null): string | null {
    const value = this.get(key);
    return typeof value === "string" ? value : fallback;
  }

  /** Every value for `key` as strings (File entries are skipped). */
  strings(key: string): string[] {
    return this.getAll(key).filter((v): v is string => typeof v === "string");
  }

  /** First value for `key` as a number; `null` if absent, blank, or not numeric. */
  number(key: string): number | null;
  /** First value for `key` as a number; `fallback` if absent, blank, or not numeric. */
  number(key: string, fallback: number): number;
  number(key: string, fallback: number | null = null): number | null {
    const value = this.get(key);
    if (typeof value !== "string" || value.trim() === "") {
      return fallback;
    }
    const parsed = Number(value);
    return Number.isNaN(parsed) ? fallback : parsed;
  }

  /** Every value for `key` as numbers (blank / non-numeric entries are skipped). */
  numbers(key: string): number[] {
    const result: number[] = [];
    for (const value of this.strings(key)) {
      if (value.trim() === "") continue;
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) result.push(parsed);
    }
    return result;
  }

  /**
   * Interpret `key` as a boolean. Absent → `false`; present with a falsy string
   * (`""`, `"0"`, `"false"`, `"off"`, `"no"`) → `false`; otherwise `true`. This matches
   * checkbox semantics: a checked box is present (value `"on"` → `true`), an unchecked
   * box is absent (→ `false`).
   */
  boolean(key: string): boolean {
    const value = this.get(key);
    if (value == null) return false;
    if (typeof value !== "string") return true; // a submitted File counts as present
    return !FALSY_FORM_VALUES.has(value.trim().toLowerCase());
  }

  /** First value for `key` as an integer; `null` if absent, blank, or not a whole number. */
  integer(key: string): number | null;
  /** First value for `key` as an integer; `fallback` if absent, blank, or not a whole number. */
  integer(key: string, fallback: number): number;
  integer(key: string, fallback: number | null = null): number | null {
    const parsed = this.number(key);
    return parsed !== null && Number.isInteger(parsed) ? parsed : fallback;
  }

  /**
   * First value for `key` parsed as a `Date` (accepts the values produced by
   * `date` / `datetime-local` inputs); `null` if absent, blank, or unparseable.
   */
  date(key: string): Date | null;
  /** As `date(key)` but returns `fallback` instead of `null`. */
  date(key: string, fallback: Date): Date;
  date(key: string, fallback: Date | null = null): Date | null {
    const value = this.string(key);
    if (value === null || value.trim() === "") {
      return fallback;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
  }

  /** First value for `key` if it is a File; otherwise `null`. */
  file(key: string): File | null {
    const value = this.get(key);
    return isFile(value) ? value : null;
  }

  /** Every File value for `key`. */
  files(key: string): File[] {
    return this.getAll(key).filter(isFile);
  }

  /** The distinct field names present, in first-seen order. */
  fieldNames(): string[] {
    return [...new Set(this.keys())];
  }

  /**
   * A plain object of all entries: a key seen once maps to its single value, a key
   * seen more than once maps to an array of its values.
   */
  toRecord(): Record<string, FormDataEntryValue | FormDataEntryValue[]> {
    const result: Record<string, FormDataEntryValue | FormDataEntryValue[]> =
      {};

    for (const [key, value] of this) {
      const existing = result[key];

      if (existing === undefined) {
        result[key] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        result[key] = [existing, value];
      }
    }

    return result;
  }
}
