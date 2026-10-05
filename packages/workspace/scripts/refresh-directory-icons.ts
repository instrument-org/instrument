/**
 * Fetches the directory's bundled icons from the sources `manifest.json`
 * pins, and writes one `<slug>.svg` or `<slug>.png` per entry beside it.
 *
 * Each SVG is cleaned of anything that could run or reach out (scripts, event
 * handlers, links and references outside the file), padded to a square
 * viewBox, and, when the collection draws the mark separately for a dark
 * background or the mark is one color a theme's ground would swallow,
 * carries both halves behind a `prefers-color-scheme` switch. A
 * PNG is kept as fetched once it is square and at least 128px. A file that
 * comes out the same is left alone, and a file whose slug left the manifest
 * is removed, so a run with nothing upstream changed changes nothing.
 *
 * The contact sheet draws every icon on a light and a dark plate at the
 * sizes the app uses, so a review approves pictures rather than paths. It is
 * written wherever `--sheet` says, never into the repository.
 *
 * Usage:
 *   pnpm --filter @instrument-org/workspace script:refresh-directory-icons --sheet <file.html> [--only <slug>,<slug>]
 */

import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  DIRECTORY_ICON_MANIFEST_FILE_NAME,
  DIRECTORY_ICONS_DIR_NAME,
  type DirectoryIconEntry,
  DirectoryIconManifestSchema,
  directoryIconFileName,
} from "../src/lib/apps/directory-icon";
import { checkAppIcon } from "../src/lib/apps/icon";
import { themeHalves } from "./lib/icon-contrast";

const ICONS_DIR = path.resolve(
  import.meta.dirname,
  "..",
  DIRECTORY_ICONS_DIR_NAME,
);
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
/** App Store artwork, asked for at the size the app ever draws it. */
const APP_STORE_ARTWORK_SIZE = 256;
const CONCURRENCY = 8;
/** Elements that run, reach out, or only describe the file. */
const DROPPED_ELEMENTS = String.raw`script|foreignObject|metadata|title|desc|sodipodi:[\w-]+|inkscape:[\w-]+`;

const { values } = parseArgs({
  options: {
    only: { type: "string" },
    sheet: { type: "string" },
  },
});

if (!values.sheet) {
  console.error(
    "Usage: script:refresh-directory-icons --sheet <file.html> [--only <slug>,<slug>]",
  );
  process.exit(2);
}

process.exitCode = await main(path.resolve(values.sheet));

async function main(sheetPath: string): Promise<number> {
  const manifest = DirectoryIconManifestSchema.parse(
    JSON.parse(
      await fs.readFile(
        path.join(ICONS_DIR, DIRECTORY_ICON_MANIFEST_FILE_NAME),
        "utf8",
      ),
    ),
  );
  const only = values.only?.split(",").map((slug) => slug.trim());
  const entries = Object.entries(manifest).filter(
    ([slug]) => !only || only.includes(slug),
  );

  const failures: string[] = [];
  let written = 0;
  await forEachLimited(entries, CONCURRENCY, async ([slug, entry]) => {
    try {
      const icon = await buildIcon(entry);
      const check = checkAppIcon(icon.bytes);
      if ("error" in check) {
        throw new Error(check.error);
      }
      if (await writeIfChanged(slug, icon)) {
        written += 1;
        console.log(`wrote ${directoryIconFileName(slug, icon.kind)}`);
      }
    } catch (error) {
      failures.push(
        `${slug}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  if (!only) {
    for (const file of await fs.readdir(ICONS_DIR)) {
      const slug = /^(.+)\.(?:png|svg)$/.exec(file)?.[1];
      if (slug && !(slug in manifest)) {
        await fs.rm(path.join(ICONS_DIR, file));
        console.log(`removed ${file}`);
      }
    }
  }

  await fs.writeFile(sheetPath, await contactSheet(manifest));
  console.log(
    `${written} written, ${entries.length - written - failures.length} unchanged; contact sheet at ${sheetPath}`,
  );
  if (failures.length > 0) {
    console.error(`failed, kept what was there:\n  ${failures.join("\n  ")}`);
    return 1;
  }
  return 0;
}

async function buildIcon(
  entry: DirectoryIconEntry,
): Promise<{ bytes: Buffer; kind: "png" | "svg" }> {
  switch (entry.source) {
    case "app-store": {
      const lookup = (await (
        await fetchOk(`https://itunes.apple.com/lookup?id=${entry.id}`)
      ).json()) as { results?: { artworkUrl512?: string }[] };
      const artwork = lookup.results?.[0]?.artworkUrl512;
      if (!artwork) {
        throw new Error(`App Store has no app ${entry.id}`);
      }
      const url = artwork.replace(
        /\/[^/]+$/,
        `/${APP_STORE_ARTWORK_SIZE}x${APP_STORE_ARTWORK_SIZE}bb.png`,
      );
      return { bytes: await fetchBytes(url), kind: "png" };
    }
    case "iconify-logos": {
      const set = (await (
        await fetchOk(
          `https://cdn.jsdelivr.net/npm/@iconify-json/logos@${entry.version}/icons.json`,
        )
      ).json()) as {
        height?: number;
        icons: Record<
          string,
          { body: string; height?: number; width?: number } | undefined
        >;
        width?: number;
      };
      const icon = set.icons[entry.path];
      if (!icon) {
        throw new Error(`no ${entry.path} in @iconify-json/logos`);
      }
      const width = icon.width ?? set.width ?? 16;
      const height = icon.height ?? set.height ?? 16;
      return svgIcon(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${icon.body}</svg>`,
      );
    }
    case "site": {
      const bytes = await fetchBytes(entry.url);
      return bytes.subarray(0, 8).equals(PNG_SIGNATURE)
        ? { bytes, kind: "png" }
        : svgIcon(bytes.toString("utf8"));
    }
    default: {
      const base = collectionBase(entry.source, entry.version);
      const light = (await fetchBytes(base + entry.path)).toString("utf8");
      const dark = entry.dark
        ? (await fetchBytes(base + entry.dark)).toString("utf8")
        : undefined;
      return svgIcon(light, dark);
    }
  }
}

function collectionBase(
  source: "dashboard-icons" | "lobe-icons" | "logos" | "svgl" | "thesvg",
  version: string,
): string {
  switch (source) {
    case "dashboard-icons": {
      return `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@${version}/`;
    }
    case "lobe-icons": {
      return `https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@${version}/icons/`;
    }
    case "logos": {
      return `https://cdn.jsdelivr.net/gh/gilbarbara/logos@${version}/logos/`;
    }
    case "svgl": {
      return `https://cdn.jsdelivr.net/gh/pheralb/svgl@${version}/static/library/`;
    }
    case "thesvg": {
      return `https://cdn.jsdelivr.net/gh/glincker/thesvg@${version}/public/`;
    }
  }
}

/**
 * A mark with no dark version from its collection gets one made when it is
 * a single color that one theme's ground would swallow (`icon-contrast.ts`).
 */
function svgIcon(light: string, dark?: string): { bytes: Buffer; kind: "svg" } {
  const cleaned = cleanSvg(light);
  const halves =
    dark === undefined
      ? themeHalves(cleaned)
      : { dark: cleanSvg(dark), light: cleaned };
  const svg =
    halves === undefined
      ? squareSvg(cleaned)
      : themedSvg(
          squareSvg(scopeNames(halves.light, "l")),
          squareSvg(scopeNames(halves.dark, "d")),
        );
  return { bytes: Buffer.from(`${svg}\n`), kind: "svg" };
}

/**
 * The SVG with nothing in it that runs or reaches outside the file, and
 * without the editor's leftovers. The app draws these as images, where none
 * of it would run anyway; the files are cleaned so that stays true wherever
 * they end up.
 */
function cleanSvg(svg: string): string {
  const start = svg.search(/<svg\b/i);
  if (start === -1) {
    throw new Error("not an SVG");
  }
  const cleaned = svg
    .slice(start)
    .replaceAll(/<!--[\s\S]*?-->/g, "")
    .replaceAll(
      new RegExp(String.raw`<(?:${DROPPED_ELEMENTS})\b[^>]*\/>`, "gi"),
      "",
    )
    .replaceAll(
      new RegExp(
        String.raw`<(${DROPPED_ELEMENTS})\b[^>]*>[\s\S]*?<\/\1\s*>`,
        "gi",
      ),
      "",
    )
    // A link's children stay; the link goes.
    .replaceAll(/<\/?a\b[^>]*>/gi, "")
    .replaceAll(
      /\s(?:on[\w-]+|(?:sodipodi|inkscape):[\w-]+)\s*=\s*(?:"[^"]*"|'[^']*')/gi,
      "",
    )
    .replaceAll(/\s(?:xlink:)?href\s*=\s*(?:"(?!#)[^"]*"|'(?!#)[^']*')/gi, "")
    .replaceAll(/@import[^;]*;/gi, "")
    .replaceAll(/url\(\s*(?!['"]?#)[^)]*\)/gi, "none")
    .replaceAll(/>\s+</g, "><")
    .trim();
  if (/<image\b/i.test(cleaned)) {
    throw new Error("embeds a raster image, which would not draw");
  }
  return cleaned;
}

/** The SVG with a square viewBox, the mark centered in it, and no fixed size. */
function squareSvg(svg: string): string {
  const open = /^<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!open) {
    throw new Error("no root <svg>");
  }
  const box = viewBoxOf(open);
  const size = Math.max(box.width, box.height);
  const x = box.x - (size - box.width) / 2;
  const y = box.y - (size - box.height) / 2;
  const attributes = open
    .replace(/^<svg\b/i, "")
    .replace(/\/?>$/, "")
    .replaceAll(
      /\s(?:viewBox|width|height|x|y|preserveAspectRatio)\s*=\s*(?:"[^"]*"|'[^']*')/gi,
      "",
    );
  // An SVG drawn as an image draws nothing without its namespace.
  const namespace = /\sxmlns\s*=/.test(attributes)
    ? ""
    : ' xmlns="http://www.w3.org/2000/svg"';
  return `<svg${namespace}${attributes} viewBox="${round(x)} ${round(y)} ${round(size)} ${round(size)}">${svg.slice(open.length)}`;
}

function viewBoxOf(open: string): {
  height: number;
  width: number;
  x: number;
  y: number;
} {
  const viewBox = /\sviewBox\s*=\s*["']([^"']+)["']/i.exec(open)?.[1];
  if (viewBox) {
    const [
      x = Number.NaN,
      y = Number.NaN,
      width = Number.NaN,
      height = Number.NaN,
    ] = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (
      [x, y, width, height].every(Number.isFinite) &&
      width > 0 &&
      height > 0
    ) {
      return { height, width, x, y };
    }
  }
  const width = Number.parseFloat(
    /\swidth\s*=\s*["']([\d.]+)/i.exec(open)?.[1] ?? "",
  );
  const height = Number.parseFloat(
    /\sheight\s*=\s*["']([\d.]+)/i.exec(open)?.[1] ?? "",
  );
  if (width > 0 && height > 0) {
    return { height, width, x: 0, y: 0 };
  }
  throw new Error("neither a viewBox nor a width and height");
}

function round(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/**
 * Ids and class names prefixed, so the light and dark halves of one file
 * cannot reach each other's gradients, clip paths, or styles.
 */
function scopeNames(svg: string, prefix: string): string {
  const ids = [...svg.matchAll(/\sid\s*=\s*["']([^"']+)["']/g)].map(
    (match) => match[1] ?? "",
  );
  let scoped = svg;
  for (const id of ids) {
    const escaped = id.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    scoped = scoped
      .replaceAll(
        new RegExp(String.raw`(\sid\s*=\s*["'])${escaped}(["'])`, "g"),
        `$1${prefix}-${id}$2`,
      )
      .replaceAll(
        new RegExp(String.raw`#${escaped}(?![\w-])`, "g"),
        `#${prefix}-${id}`,
      );
  }
  return scoped
    .replaceAll(
      /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
      (_, open: string, css: string, close: string) =>
        open +
        css.replaceAll(/\.(-?[_a-zA-Z][\w-]*)/g, `.${prefix}-$1`) +
        close,
    )
    .replaceAll(
      /(\sclass\s*=\s*["'])([^"']*)(["'])/g,
      (_, open: string, names: string, close: string) =>
        open +
        names
          .split(/\s+/)
          .filter(Boolean)
          .map((name) => `${prefix}-${name}`)
          .join(" ") +
        close,
    );
}

/**
 * One file holding both halves, each in its own square viewport: the light
 * one unless the page drawing it is dark.
 */
function themedSvg(light: string, dark: string): string {
  const style =
    "<style>.dark{display:none}@media (prefers-color-scheme:dark){.light{display:none}.dark{display:inline}}</style>";
  const nest = (svg: string, className: string) =>
    `<g class="${className}">${svg.replace(/^<svg\b/i, '<svg width="100%" height="100%"')}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">${style}${nest(light, "light")}${nest(dark, "dark")}</svg>`;
}

async function writeIfChanged(
  slug: string,
  icon: { bytes: Buffer; kind: "png" | "svg" },
): Promise<boolean> {
  const target = path.join(ICONS_DIR, directoryIconFileName(slug, icon.kind));
  const other = path.join(
    ICONS_DIR,
    directoryIconFileName(slug, icon.kind === "svg" ? "png" : "svg"),
  );
  await fs.rm(other, { force: true });
  const existing = await fs.readFile(target).catch(() => undefined);
  if (existing?.equals(icon.bytes)) {
    return false;
  }
  await fs.writeFile(target, icon.bytes);
  return true;
}

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh)" },
  });
  if (!response.ok) {
    throw new Error(`${response.status} from ${url}`);
  }
  return response;
}

async function fetchBytes(url: string): Promise<Buffer> {
  return Buffer.from(await (await fetchOk(url)).arrayBuffer());
}

async function forEachLimited<T>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<void>,
) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        await run(item);
      }
    }),
  );
}

async function contactSheet(
  manifest: Record<string, DirectoryIconEntry>,
): Promise<string> {
  const cells: string[] = [];
  for (const [slug, entry] of Object.entries(manifest)) {
    const file = await findFile(slug);
    const src = file
      ? `data:${file.kind === "svg" ? "image/svg+xml" : "image/png"};base64,${file.bytes.toString("base64")}`
      : "";
    const plates = (["light", "dark"] as const)
      .map(
        (theme) =>
          `<div class="plate ${theme}">${src ? `<img class="lg" src="${src}"><img class="sm" src="${src}">` : "missing"}</div>`,
      )
      .join("");
    const note = [
      entry.source,
      entry.license,
      entry.override ? `override: ${entry.override}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    cells.push(
      `<figure>${plates}<figcaption><b>${escapeHtml(slug)}</b><br>${escapeHtml(note)}</figcaption></figure>`,
    );
  }
  return `<!doctype html><meta charset="utf-8"><title>Directory icons</title>
<style>
body{font:12px system-ui;margin:24px;background:#f4f4f5}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
figure{margin:0;padding:10px;background:#fff;border-radius:12px}
.plate{display:inline-flex;align-items:center;gap:10px;padding:10px;border-radius:12px;margin-right:6px}
.plate.light{background:#fff;color-scheme:light;box-shadow:inset 0 0 0 1px #e4e4e7}
.plate.dark{background:#1c1c1e;color-scheme:dark}
img.lg{width:32px;height:32px;padding:6px;border-radius:9px;box-shadow:inset 0 0 0 1px #8884;object-fit:contain}
img.sm{width:16px;height:16px;border-radius:3px;object-fit:contain}
figcaption{margin-top:6px;color:#555}
</style>
<h1>Directory icons (${Object.keys(manifest).length})</h1>
<main>${cells.join("\n")}</main>
`;
}

async function findFile(
  slug: string,
): Promise<undefined | { bytes: Buffer; kind: "png" | "svg" }> {
  for (const kind of ["svg", "png"] as const) {
    const bytes = await fs
      .readFile(path.join(ICONS_DIR, directoryIconFileName(slug, kind)))
      .catch(() => undefined);
    if (bytes) {
      return { bytes, kind };
    }
  }
  return undefined;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
