// -------------------------------------------------------------------
// Post-build: drop the comments from the CSS that ships.
// -------------------------------------------------------------------
//
// The stylesheets are template literals, and a JS minifier never touches the inside of a
// string — to it that is payload, not code. So every comment in them reaches the browser.
// In this library that is around 5 kB brotli, roughly a quarter of the core.
//
// Only `dist` is rewritten. `src` keeps its comments, which is the whole point: the
// stylesheets stay as documented as the rest of the code and cost the user nothing.
//
// # Why this scans instead of parsing
//
// The obvious tools are all shut out here. TypeScript 7 dropped the JS compiler API, so
// there is no createSourceFile to lean on; @literals/parser and the @literals minifier
// built on it both call exactly that API and therefore cannot run in this project either.
// What is left is a scanner — with three things that keep it honest, all of which fail the
// build rather than degrade quietly:
//
//   1. It never guesses. Anything it does not fully understand (a nested template inside a
//      `${…}`, an unterminated literal, an unterminated comment) throws.
//   2. Afterwards it re-reads its own output and asserts that no comment is left inside a
//      stylesheet — the end-to-end check, independent of what the steps believed they did.
//   3. Every rewritten file is handed to `node --check`. A wrong boundary produces a syntax
//      error, and the original is restored before the build stops.
//
// Silence was the wrong default here: a skipped file still builds, still passes, and simply
// ships the comments again — invisible until someone measures the bundle.
//
// The CSS itself is never parsed. Nothing here can misread a modern function like
// contrast-color() or light-dark() and quietly discard it — the only bytes that can be
// removed are the ones between a /* and its */.

import { execFile } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const DIST = "dist";

/** A css`…` body found in the source, as an offset range into it. */
interface Region {
  start: number;
  end: number;
}

/**
 * Find the bodies of every css`…` literal. Returns null if anything is ambiguous; the
 * caller turns that into a build failure rather than risking a bad edit.
 */
function cssRegions(code: string): Region[] | null {
  const regions: Region[] = [];
  // tsc emits the tag with a space — `css \`…\`` — so the gap has to be tolerated.
  const tag = /\bcss\s*`/g;

  for (let match = tag.exec(code); match; match = tag.exec(code)) {
    // `css` must be the whole identifier, not the tail of `myCss`.
    const before = code[match.index - 1];
    if (before && /[\w$.]/.test(before)) continue;

    let i = match.index + match[0].length;
    const start = i;

    for (;;) {
      if (i >= code.length) return null; // unterminated
      const ch = code[i];

      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "`") break;
      if (ch === "$" && code[i + 1] === "{") {
        // Skip the substitution. Braces nest; quotes inside it may contain braces of
        // their own. A backtick in here would mean a nested template, which is where the
        // scanner's understanding ends.
        i += 2;
        let depth = 1;
        let quote: string | null = null;
        for (; depth > 0; i++) {
          if (i >= code.length) return null;
          const c = code[i];
          if (quote) {
            if (c === "\\") i++;
            else if (c === quote) quote = null;
            continue;
          }
          if (c === '"' || c === "'") quote = c;
          else if (c === "`") return null;
          else if (c === "{") depth++;
          else if (c === "}") depth--;
        }
        continue;
      }
      i++;
    }

    regions.push({ start, end: i });
    tag.lastIndex = i;
  }

  return regions;
}

/**
 * Remove CSS comments, leaving quoted strings alone: a `/*` inside a url() or a content:
 * value is data, not a comment. CSS comments do not nest, so no depth counter is needed.
 */
function stripComments(css: string): string {
  let out = "";
  let quote: string | null = null;

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];

    if (quote) {
      out += ch;
      if (ch === "\\") out += css[++i] ?? "";
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end === -1) {
        // Either the stylesheet is malformed or the region boundaries are wrong. Both are
        // build-time bugs; shipping the comments instead would hide them.
        throw new Error("unterminated CSS comment");
      }
      i = end + 1;
      continue;
    }
    out += ch;
  }

  // A comment on its own line leaves that line behind. Collapse the blank runs, but keep
  // single newlines: they cost almost nothing after compression, and a stylesheet on one
  // endless line is miserable to read in devtools.
  return out.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n");
}

async function* jsFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* jsFiles(full);
    else if (entry.name.endsWith(".js")) yield full;
  }
}

let touched = 0;
let saved = 0;

for await (const file of jsFiles(DIST)) {
  const code = await readFile(file, "utf8");
  if (!/\bcss\s*`/.test(code)) continue;

  const regions = cssRegions(code);
  if (regions === null || regions.length === 0) {
    throw new Error(
      `strip-css-comments: ${file} tags a stylesheet with css\`…\` but its literals could ` +
        `not be read — a nested template inside a \${…}, or an unterminated one. Failing ` +
        `rather than shipping the comments, which would be invisible until someone measured.`,
    );
  }

  // Back to front, so an earlier rewrite cannot shift a later range.
  let out = code;
  for (const { start, end } of regions.reverse()) {
    try {
      out =
        out.slice(0, start) + stripComments(out.slice(start, end)) + out.slice(end);
    } catch (error) {
      throw new Error(`strip-css-comments: ${file}: ${(error as Error).message}`);
    }
  }

  // The end-to-end assertion, and the one that actually matters: whatever the steps above
  // believed they did, no comment may remain inside a stylesheet. A stylesheet that simply
  // has none is fine and lands here unchanged.
  for (const { start, end } of cssRegions(out) ?? []) {
    if (out.slice(start, end).includes("/*")) {
      throw new Error(
        `strip-css-comments: ${file} still contains a CSS comment after stripping.`,
      );
    }
  }

  if (out === code) continue;

  await writeFile(file, out);
  try {
    await run(process.execPath, ["--check", file]);
  } catch (error) {
    await writeFile(file, code); // put the good version back before failing
    throw new Error(
      `strip-css-comments: rewriting ${file} produced invalid syntax; restored the original.\n${String(error)}`,
    );
  }

  touched++;
  saved += code.length - out.length;
}

console.log(
  `strip-css-comments: ${touched} file(s) rewritten, ${(saved / 1024).toFixed(1)} kB of comments dropped`,
);
