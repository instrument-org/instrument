import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { zoomMaxSize } from "./use-app-zoom";

const CLIENT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// A viewport unit written anywhere below the app is a length the surrounding
// element's own `zoom` does not rescale, so `100vh` on a self-zoomed element
// renders `zoom x` the window and hangs off the screen. Dividing by the zoom
// factor in scope is what makes it mean "a share of the real window" again.
//
// The two names differ by who applies the zoom: `--app-zoom` on the root that
// zooms the whole tree, `--content-zoom` on a portalled element that zooms
// itself. Either one present means the author accounted for it.
const ZOOM_DIVISORS = ["var(--content-zoom)", "var(--app-zoom)"];

const VIEWPORT_UNIT = /[\d.]+v(?:h|w|max|min)\b/g;

/** Quote characters, which bound the expression a match can belong to. */
const QUOTES = ['"', "'", "`"];

/**
 * The Tailwind arbitrary value or CSS expression a match sits inside.
 *
 * Climbs out through nested CSS functions rather than stopping at the innermost
 * bracket, because the divisor answering for a unit is written outside them: a
 * length written as a `var()` fallback is divided by the `calc()` around that
 * `var()`, and reading the `var()` alone would report it as unanswered for. The
 * climb stops at the string the match is written in, so an expression can never
 * be excused by code that merely sits near it.
 */
function enclosingExpression(source: string, index: number) {
  const literal = Math.max(
    ...QUOTES.map((quote) => source.lastIndexOf(quote, index)),
  );
  let start = index;
  let end = index;
  let from = index;

  for (;;) {
    const open = Math.max(
      source.lastIndexOf("[", from),
      source.lastIndexOf("(", from),
    );
    if (open === -1 || open < literal) {
      break;
    }
    const closers = [source.indexOf("]", end), source.indexOf(")", end)].filter(
      (at) => at !== -1,
    );
    start = open;
    end = closers.length > 0 ? Math.min(...closers) + 1 : end;
    // A `[` is the Tailwind arbitrary value, which is as far out as an
    // expression goes. A `(` with a name in front of it is a CSS function,
    // which may be nested in another one.
    if (source[start] === "[" || !/[\w-]$/.test(source.slice(0, start))) {
      break;
    }
    from = start - 1;
  }

  return source.slice(start, end);
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(full);
    }
    // Test files stand up deliberately wrong markup -- oversized boxes, class
    // strings fed to `cn()` as data -- which is the opposite of a claim about
    // what the app renders. `use-app-zoom.ts` is where the divisor is built, so
    // it holds the only bare viewport units in the renderer by construction.
    return /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name) &&
      entry.name !== "use-app-zoom.ts"
      ? [full]
      : [];
  });
}

// Prose explaining a length is not a length. Comments here describe what a
// third-party default does and what the code overrides it with, and reading
// them as markup makes the check unfixable without deleting the explanation.
function withoutComments(source: string) {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("zoomMaxSize", () => {
  it("caps an intrinsic size by the window", () => {
    expect(zoomMaxSize("width", "32rem")).toMatchInlineSnapshot(
      `"min(32rem, calc((100vw - 2rem) / var(--content-zoom)))"`,
    );
  });

  it("falls back to the window when nothing intrinsic is asked for", () => {
    expect(zoomMaxSize("height")).toMatchInlineSnapshot(
      `"calc((100vh - 2rem) / var(--content-zoom))"`,
    );
  });
});

describe("viewport units in the renderer", () => {
  it("are always divided by the zoom factor in scope", () => {
    const offenders = sourceFiles(CLIENT_DIR).flatMap((file) => {
      const source = withoutComments(fs.readFileSync(file, "utf8"));
      return [...source.matchAll(VIEWPORT_UNIT)]
        .filter((match) => {
          const expression = enclosingExpression(source, match.index);
          return !ZOOM_DIVISORS.some((divisor) => expression.includes(divisor));
        })
        .map(
          (match) =>
            `${path.relative(CLIENT_DIR, file)}: ${enclosingExpression(source, match.index)}`,
        );
    });

    expect(offenders).toEqual([]);
  });
});
