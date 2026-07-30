/**
 * Regenerate the `@theme` block that wireframes compile Tailwind against, from
 * Studio's own stylesheet, so a wireframe drawn a year ago still shows the
 * colours the product actually ships.
 *
 * Wireframes cannot import globals.css: it pulls @fontsource packages and the
 * Tailwind entry through the bundler, and these files have to open from disk
 * and from a sandboxed Notion iframe with no build step. So the tokens are
 * copied in, and this script is what keeps the copy honest.
 *
 *   node .agents/skills/product-wireframe/scripts/sync-theme.ts
 *   node .agents/skills/product-wireframe/scripts/sync-theme.ts --check
 *   node .agents/skills/product-wireframe/scripts/sync-theme.ts path/to/one.html
 *
 * Targets the template plus every docs/plans/active/wireframes-*.html unless
 * paths are given. `--check` writes nothing and exits non-zero when a file is
 * stale.
 */
import { globSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const GLOBALS = "apps/studio/src/client/styles/globals.css";
const TEMPLATE = ".agents/skills/product-wireframe/template.html";
const WIREFRAMES = "docs/plans/active/wireframes-*.html";

const START = "/* sync:start */";
const END = "/* sync:end */";
const INDENT = " ".repeat(8);

/** Ramps emitted whole, in the order a reader expects to scan them. */
const RAMPS = [
  "gray",
  "brand",
  "error",
  "warning",
  "success",
  "yellow",
  "brown",
];

/** Semantic aliases worth having as Tailwind colours in a wireframe. */
const SEMANTIC = [
  "background",
  "foreground",
  "card",
  "popover",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
];

function applyTo(file: string, block: string, check: boolean): boolean {
  const absolute = path.join(REPO_ROOT, file);
  const source = readFileSync(absolute, "utf8");
  const from = source.indexOf(START);
  const to = source.indexOf(END);
  if (from === -1 || to === -1) {
    throw new Error(
      `${file} has no ${START} / ${END} markers around its @theme tokens.`,
    );
  }
  const updated =
    source.slice(0, from + START.length) +
    "\n" +
    block +
    "\n" +
    INDENT +
    source.slice(to);

  if (updated === source) return false;
  if (!check) writeFileSync(absolute, updated);
  return true;
}

function buildThemeBlock(globalsCss: string): string {
  const lightStart = globalsCss.indexOf("LIGHT MODE THEME");
  const darkStart = globalsCss.indexOf("DARK MODE THEME");
  if (lightStart === -1 || darkStart === -1) {
    throw new Error(
      `Could not find the light/dark theme markers in ${GLOBALS}. If those comments were renamed, update this script.`,
    );
  }
  const light = declarations(globalsCss.slice(lightStart, darkStart));
  // Fonts live in the `@theme inline` block above the light theme.
  const all = declarations(globalsCss);

  const lines: string[] = [];
  const push = (name: string, value: string) =>
    lines.push(`${INDENT}${name}: ${value};`);

  for (const key of ["--font-sans", "--font-mono"]) {
    const value = all.get(key);
    if (value) push(key, withWebFontNames(value));
  }
  lines.push("");

  const radius = light.get("--radius");
  if (radius) {
    push("--radius", radius);
    push("--radius-sm", "calc(var(--radius) - 4px)");
    push("--radius-md", "calc(var(--radius) - 2px)");
    push("--radius-lg", "var(--radius)");
    push("--radius-xl", "calc(var(--radius) + 4px)");
    lines.push("");
  }

  for (const [shadow, elevation] of [
    ["--shadow-sm", "--elevation-sm"],
    ["--shadow-xl", "--elevation-xl"],
  ] as const) {
    const value = light.get(elevation);
    if (value) push(shadow, value);
  }
  lines.push("");

  for (const ramp of RAMPS) {
    const stops = [...light.keys()]
      .filter((key) => new RegExp(`^--${ramp}-\\d+$`).test(key))
      .sort((a, b) => Number(a.split("-").pop()) - Number(b.split("-").pop()));
    for (const stop of stops) {
      push(`--color-${stop.slice(2)}`, resolve(light.get(stop)!, light));
    }
    if (stops.length > 0) lines.push("");
  }

  for (const name of SEMANTIC) {
    const value = light.get(`--${name}`);
    if (value) push(`--color-${name}`, resolve(value, light));
  }

  return lines.join("\n");
}

function declarations(css: string): Map<string, string> {
  const out = new Map<string, string>();
  // Split on `;` rather than matching per line: the elevation ramps are
  // multi-line values and a line-anchored regex silently truncates them.
  for (const chunk of css.split(";")) {
    // Match only the property name, then slice the value off by index. A regex
    // greedy enough to also capture a multi-line value backtracks badly, and
    // the first colon in a chunk is not always the property's (a chunk can
    // open with `:root {`).
    const name = /(--[a-z0-9-]+)\s*:/.exec(chunk);
    if (!name?.[1]) continue;
    const value = chunk
      .slice(name.index + name[0].length)
      .replaceAll(/\s+/g, " ")
      .trim();
    if (value.length > 0) out.set(name[1], value);
  }
  return out;
}

/** Follow `var(--x)` indirection so wireframes carry literal values. */
function resolve(value: string, vals: Map<string, string>, depth = 0): string {
  const match = /^var\((--[a-z0-9-]+)\)$/.exec(value.trim());
  const target = match?.[1] && vals.get(match[1]);
  return target && depth < 5 ? resolve(target, vals, depth + 1) : value.trim();
}

/**
 * The app loads fonts from @fontsource, which registers families under names a
 * font CDN does not serve ("JetBrains Mono Variable" vs "JetBrains Mono").
 * Keep the app's name first so the stack stays truthful, and slot the CDN name
 * in behind it so a wireframe actually renders in the right typeface.
 */
function withWebFontNames(stack: string): string {
  return stack.replaceAll(
    /"([^"]+) Variable"/g,
    (match, family: string) => `${match}, "${family}"`,
  );
}

const args = process.argv.slice(2);
const check = args.includes("--check");
const explicit = args.filter((arg) => !arg.startsWith("--"));
const targets =
  explicit.length > 0
    ? explicit
    : [TEMPLATE, ...globSync(WIREFRAMES, { cwd: REPO_ROOT })];

const block = buildThemeBlock(
  readFileSync(path.join(REPO_ROOT, GLOBALS), "utf8"),
);

const stale = targets.filter((file) => applyTo(file, block, check));

if (check) {
  if (stale.length > 0) {
    console.error(`Stale theme block in:\n  ${stale.join("\n  ")}`);
    process.exitCode = 1;
  } else {
    console.log(`In sync with ${GLOBALS} (${targets.length} files).`);
  }
} else {
  console.log(
    stale.length > 0
      ? `Updated:\n  ${stale.join("\n  ")}`
      : `Already in sync (${targets.length} files).`,
  );
}
