/**
 * Which files the app draws itself (`rendered-pictures.ts`) rather than
 * leaving to the system's thumbnailer, by extension alone, so asking costs
 * nothing and loads none of the drawing's machinery. Shared with the
 * renderer, which asks for a picture of exactly these and of what the system
 * draws.
 */

import { MARKDOWN_EXTENSIONS as MARKDOWN } from "@instrument-org/shared";

export type RenderedKind =
  | "code"
  | "markdown"
  | "page"
  | "picture"
  | "table"
  | "text";

const PAGE_EXTENSIONS = new Set(["htm", "html"]);
/**
 * Pictures the system's thumbnailer draws wrong: Quick Look reads an SVG's
 * size in points as pixels, cutting the drawing short, and sets a wide one at
 * the top of a white square.
 */
const PICTURE_EXTENSIONS = new Set(["svg"]);
const MARKDOWN_EXTENSIONS = new Set(MARKDOWN);
/** Code, set as a sheet: highlighted where there is a grammar for it, plain where not. */
const CODE_EXTENSIONS = new Set([
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "go",
  "h",
  "hpp",
  "ini",
  "java",
  "js",
  "json",
  "jsonl",
  "jsx",
  "kt",
  "lua",
  "mjs",
  "ndjson",
  "php",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "swift",
  "toml",
  "ts",
  "tsx",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);

/** Delimited data, set as the viewer's table. */
const TABLE_EXTENSIONS = new Set(["csv", "tsv"]);
/** Plain text, set as the viewer reads it: in the reading typeface, never highlighted. */
const TEXT_EXTENSIONS = new Set(["log", "txt"]);

/** Every extension the app draws a picture of. */
export const RENDERED_EXTENSIONS: ReadonlySet<string> = new Set([
  ...PAGE_EXTENSIONS,
  ...PICTURE_EXTENSIONS,
  ...MARKDOWN_EXTENSIONS,
  ...CODE_EXTENSIONS,
  ...TABLE_EXTENSIONS,
  ...TEXT_EXTENSIONS,
]);

/** A file's extension, lowercased; empty for none. */
export function extensionOf(hostPath: string) {
  const name = hostPath.split(/[/\\]/).at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** How a file is drawn by the app, or nothing when it is the system's to draw. */
export function renderedKindOf(hostPath: string): RenderedKind | undefined {
  const extension = extensionOf(hostPath);
  if (PAGE_EXTENSIONS.has(extension)) {
    return "page";
  }
  if (PICTURE_EXTENSIONS.has(extension)) {
    return "picture";
  }
  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return "markdown";
  }
  if (CODE_EXTENSIONS.has(extension)) {
    return "code";
  }
  if (TABLE_EXTENSIONS.has(extension)) {
    return "table";
  }
  if (TEXT_EXTENSIONS.has(extension)) {
    return "text";
  }
  return;
}
