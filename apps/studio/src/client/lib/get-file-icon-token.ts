import { EXTENSION_MAP } from "./file-extension-to-language";

// What a file *is*, independent of which glyph draws it. Extensions resolve to
// a token here and the token resolves to an icon at the point of render, so the
// two questions stay separable: which formats belong together is a fact about
// file formats, while which glyph says "spreadsheet" is a fact about whichever
// icon set is in front of us. Several tokens share a glyph today where the set
// has nothing better; that is a gap in the artwork, not a claim the formats are
// the same thing.
export type FileIconToken =
  | "archive"
  | "audio"
  | "binary"
  | "c"
  | "calendar"
  | "code"
  | "config"
  | "contact"
  | "cpp"
  | "csharp"
  | "css"
  | "csv"
  | "database"
  | "document"
  | "ebook"
  | "email"
  | "font"
  | "html"
  | "image"
  | "ini"
  | "javascript"
  | "jpg"
  | "jsx"
  | "markdown"
  | "pdf"
  | "png"
  | "presentation"
  | "python"
  | "richtext"
  | "rust"
  | "slides"
  | "spreadsheet"
  | "sql"
  | "subtitle"
  | "svg"
  | "table"
  | "text"
  | "tsx"
  | "txt"
  | "typescript"
  | "unknown"
  | "video"
  | "vue"
  | "word"
  | "zip";

const EXTENSION_TOKENS: Record<string, FileIconToken> = {
  // --- Source ---
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cts: "typescript",
  cxx: "cpp",
  h: "c",
  hpp: "cpp",
  htm: "html",
  html: "html",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  mts: "typescript",
  py: "python",
  rs: "rust",
  sql: "sql",
  svg: "svg",
  ts: "typescript",
  tsx: "tsx",
  vue: "vue",

  // Structured data that reads as source rather than as a document. JSON Lines
  // and its aliases parse a line at a time, so they group with JSON rather than
  // with the tabular formats they are often exported alongside.
  geojson: "code",
  ipynb: "code",
  jsonl: "code",
  ndjson: "code",

  // --- Config ---
  ini: "ini",
  toml: "ini",
  yaml: "config",
  yml: "config",

  // --- Prose ---
  bib: "text",
  log: "text",
  markdown: "markdown",
  md: "markdown",
  mdx: "markdown",
  mhtml: "html",
  pdf: "pdf",
  ris: "text",
  rtf: "richtext",
  txt: "txt",

  // --- Office and iWork ---
  doc: "word",
  docm: "word",
  docx: "word",
  dot: "word",
  dotm: "word",
  dotx: "word",
  key: "slides",
  numbers: "table",
  odf: "richtext",
  odp: "slides",
  ods: "table",
  odt: "document",
  odw: "document",
  pages: "document",
  pot: "presentation",
  potm: "presentation",
  potx: "presentation",
  pps: "presentation",
  ppsm: "presentation",
  ppsx: "presentation",
  ppt: "presentation",
  pptm: "presentation",
  pptx: "presentation",
  xls: "spreadsheet",
  xlsb: "spreadsheet",
  xlsm: "spreadsheet",
  xlsx: "spreadsheet",
  xlt: "spreadsheet",
  xltm: "spreadsheet",
  xltx: "spreadsheet",

  // --- Tabular and columnar data ---
  avro: "table",
  csv: "csv",
  parquet: "table",
  tsv: "table",

  // --- Databases ---
  // No registered mime type identifies one, so the extension is all there is.
  db: "database",
  sqlite: "database",
  sqlite3: "database",

  // --- Archives ---
  // Only `.zip` gets the lettered zip glyph; the rest are different containers
  // and a page reading "ZIP" misnames them.
  "7z": "archive",
  bz2: "archive",
  gz: "archive",
  rar: "archive",
  tar: "archive",
  tgz: "archive",
  xz: "archive",
  zip: "zip",
  zst: "archive",

  // --- Audio ---
  aac: "audio",
  aiff: "audio",
  flac: "audio",
  m4a: "audio",
  mp3: "audio",
  oga: "audio",
  ogg: "audio",
  opus: "audio",
  wav: "audio",

  // --- Video ---
  avi: "video",
  m4v: "video",
  mkv: "video",
  mov: "video",
  mp4: "video",
  ogv: "video",
  webm: "video",

  // --- Subtitles ---
  ass: "subtitle",
  srt: "subtitle",
  ssa: "subtitle",
  vtt: "subtitle",

  // --- Images ---
  ai: "image",
  avif: "image",
  bmp: "image",
  gif: "image",
  heic: "image",
  heif: "image",
  ico: "image",
  jpeg: "jpg",
  jpg: "jpg",
  png: "png",
  psd: "image",
  raw: "image",
  tif: "image",
  tiff: "image",
  webp: "image",

  // --- Personal information ---
  eml: "email",
  ics: "calendar",
  msg: "email",
  vcf: "contact",

  // --- E-books ---
  epub: "ebook",
  mobi: "ebook",

  // --- Fonts ---
  otf: "font",
  ttf: "font",
  woff: "font",
  woff2: "font",

  // --- Binary / executable ---
  dll: "binary",
  dylib: "binary",
  exe: "binary",
  so: "binary",
};

// Every code-language extension without a token of its own falls back to the
// generic code page.
for (const ext of Object.keys(EXTENSION_MAP)) {
  if (!(ext in EXTENSION_TOKENS)) {
    EXTENSION_TOKENS[ext] = "code";
  }
}

const FILENAME_TOKENS: Record<string, FileIconToken> = {
  ".env": "ini",
  ".gitignore": "config",
  changelog: "txt",
  dockerfile: "config",
  license: "txt",
  makefile: "config",
  readme: "markdown",
};

/**
 * The token standing for what a file is, from its name alone where possible.
 *
 * `fallbackExtension` covers the surfaces holding a file whose name carries no
 * extension of its own -- a download named by its URL, an attachment named by
 * the user -- but which know the type from elsewhere.
 */
export function getFileIconToken({
  fallbackExtension,
  filename,
  mimeType,
}: {
  fallbackExtension?: string;
  filename: string;
  mimeType?: string;
}): FileIconToken {
  const filenameToken = FILENAME_TOKENS[filename.toLowerCase()];
  if (filenameToken) {
    return filenameToken;
  }

  const extensionToken = EXTENSION_TOKENS[getFileExtension(filename)];
  if (extensionToken) {
    return extensionToken;
  }

  const fallbackToken = fallbackExtension
    ? EXTENSION_TOKENS[fallbackExtension.toLowerCase()]
    : undefined;
  if (fallbackToken) {
    return fallbackToken;
  }

  if (mimeType?.startsWith("text/")) {
    return "text";
  }

  return "unknown";
}

function getFileExtension(filename: string): string {
  const lowerName = filename.toLowerCase();
  const lastDotIndex = lowerName.lastIndexOf(".");
  if (lastDotIndex === -1 || lastDotIndex === 0) {
    return "";
  }
  return lowerName.slice(lastDotIndex + 1);
}
