import type { RPCOutput } from "@/client/rpc/client";

type SupportedLanguage = RPCOutput["syntax"]["supportedLanguages"][number];

export const EXTENSION_MAP = {
  abap: "abap",
  ada: "ada",
  astro: "astro",
  bash: "bash",
  bat: "bat",
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  clj: "clojure",
  cljs: "clojure",
  cmake: "cmake",
  coffee: "coffee",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  csv: "csv",
  cts: "typescript",
  cxx: "cpp",
  dart: "dart",
  diff: "diff",
  docker: "docker",
  dockerfile: "dockerfile",
  elm: "elm",
  env: "bash",
  erl: "erlang",
  ex: "elixir",
  exs: "elixir",
  fish: "fish",
  fs: "fsharp",
  fsx: "fsharp",
  gd: "gdscript",
  gleam: "gleam",
  glsl: "glsl",
  gml: "xml",
  go: "go",
  gql: "graphql",
  graphql: "graphql",
  groovy: "groovy",
  h: "c",
  haml: "haml",
  hbs: "handlebars",
  hpp: "cpp",
  hs: "haskell",
  htm: "html",
  html: "html",
  hx: "haxe",
  hxx: "cpp",
  ini: "ini",
  java: "java",
  jl: "julia",
  js: "javascript",
  json: "json",
  jsonc: "jsonc",
  jsx: "jsx",
  kml: "xml",
  kt: "kotlin",
  latex: "latex",
  less: "less",
  lisp: "lisp",
  lock: "json",
  lua: "lua",
  m: "matlab",
  makefile: "makefile",
  md: "markdown",
  mdx: "mdx",
  mjs: "javascript",
  ml: "ocaml",
  mts: "typescript",
  nim: "nim",
  nix: "nix",
  objc: "objective-c",
  pas: "pascal",
  patch: "diff",
  perl: "perl",
  php: "php",
  pl: "perl",
  properties: "ini",
  proto: "proto",
  ps1: "powershell",
  pug: "pug",
  py: "python",
  r: "r",
  rb: "ruby",
  rs: "rust",
  rss: "xml",
  sass: "sass",
  scala: "scala",
  scheme: "scheme",
  scss: "scss",
  sh: "bash",
  sol: "solidity",
  sql: "sql",
  styl: "stylus",
  svelte: "svelte",
  svg: "xml",
  swift: "swift",
  tcl: "tcl",
  tex: "latex",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  vb: "vb",
  vim: "vim",
  vue: "vue",
  wasm: "wasm",
  xhtml: "html",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zig: "zig",
  zsh: "bash",
} as const satisfies Record<string, SupportedLanguage>;

export function getLanguageFromFilePath(
  filePath: string,
): SupportedLanguage | undefined {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) {
    return undefined;
  }

  return EXTENSION_MAP[ext as keyof typeof EXTENSION_MAP];
}

/**
 * How a language is written where a reader sees it, for the ids that a
 * capitalized id gets wrong: acronyms, punctuation, and the names that carry a
 * capital in the middle.
 *
 * Everything absent falls back to capitalizing the id, which is the right
 * answer for most of them (`rust`, `python`, `elixir`) and a reasonable one for
 * a language nobody has written a line here for yet.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  bash: "Shell",
  c: "C",
  cmake: "CMake",
  coffee: "CoffeeScript",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  csv: "CSV",
  fsharp: "F#",
  gdscript: "GDScript",
  glsl: "GLSL",
  graphql: "GraphQL",
  html: "HTML",
  ini: "INI",
  javascript: "JavaScript",
  json: "JSON",
  jsonc: "JSONC",
  jsx: "JSX",
  latex: "LaTeX",
  matlab: "MATLAB",
  mdx: "MDX",
  "objective-c": "Objective-C",
  objective_c: "Objective-C",
  ocaml: "OCaml",
  php: "PHP",
  plaintext: "Text",
  postcss: "PostCSS",
  powershell: "PowerShell",
  proto: "Protocol Buffers",
  r: "R",
  scss: "SCSS",
  sql: "SQL",
  toml: "TOML",
  tsx: "TSX",
  typescript: "TypeScript",
  vb: "Visual Basic",
  wasm: "WebAssembly",
  xml: "XML",
  yaml: "YAML",
};

/**
 * The name to show for whatever a fence or a file called its language, which is
 * as likely to be an extension (`ts`) or an alias (`yml`) as an id.
 */
export function getLanguageDisplayName(language: string): string {
  // Widened so an unknown key reads as missing rather than as one of the
  // extensions, which is the whole question being asked of it here.
  const ids: Record<string, string> = EXTENSION_MAP;
  const lower = language.toLowerCase();
  const id = ids[lower] ?? lower;
  return LANGUAGE_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

export function toSupportedLanguage(
  language: string,
  supportedLanguages: SupportedLanguage[],
): SupportedLanguage | undefined {
  return supportedLanguages.includes(language as SupportedLanguage)
    ? (language as SupportedLanguage)
    : undefined;
}
