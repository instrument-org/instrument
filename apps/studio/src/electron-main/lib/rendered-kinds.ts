/**
 * Which files the app draws itself (`rendered-pictures.ts`) rather than
 * leaving to the system's thumbnailer, by extension alone, so asking costs
 * nothing and loads none of the drawing's machinery.
 */

export type RenderedKind = "code" | "markdown" | "page";

const PAGE_EXTENSIONS = new Set(["htm", "html"]);
const MARKDOWN_EXTENSIONS = new Set(["markdown", "md", "mdx"]);
/** Code and plain text, set as a sheet: highlighted where there is a grammar for it, plain where not. */
const CODE_EXTENSIONS = new Set([
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "csv",
  "go",
  "h",
  "hpp",
  "ini",
  "java",
  "js",
  "json",
  "jsx",
  "kt",
  "log",
  "lua",
  "mjs",
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
  "tsv",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
  "zsh",
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
  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return "markdown";
  }
  if (CODE_EXTENSIONS.has(extension)) {
    return "code";
  }
  return;
}
