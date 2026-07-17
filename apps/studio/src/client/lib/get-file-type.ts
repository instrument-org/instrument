import { isTextMimeType } from "./is-text-mime-type";

type FileType =
  | "audio"
  | "code"
  | "html"
  | "image"
  | "markdown"
  | "pdf"
  | "text"
  | "unknown"
  | "video";

function fileKindLabel(fileType: FileType): string {
  switch (fileType) {
    case "audio": {
      return "Audio";
    }
    case "code": {
      return "Code";
    }
    case "html": {
      return "HTML";
    }
    case "image": {
      return "Image";
    }
    case "markdown": {
      return "Markdown";
    }
    case "pdf": {
      return "PDF";
    }
    case "text": {
      return "Text file";
    }
    case "video": {
      return "Video";
    }
    default: {
      return "File";
    }
  }
}

// cspell:ignore dotm ipynb mhtml mobi xlsb zstandard
const EXTENSION_KIND_LABELS: Record<string, string> = {
  "7z": "7Z archive",
  ass: "Subtitle file",
  avro: "Avro data",
  bib: "Bibliography",
  bz2: "Bzip2 archive",
  csv: "CSV data",
  db: "Database",
  doc: "Word document",
  docm: "Word document",
  docx: "Word document",
  dot: "Word template",
  dotm: "Word template",
  dotx: "Word template",
  eml: "Email message",
  epub: "E-book",
  geojson: "GeoJSON data",
  gml: "XML data",
  gz: "Gzip archive",
  ics: "Calendar file",
  ipynb: "Jupyter notebook",
  json: "JSON data",
  jsonc: "JSON data",
  jsonl: "JSON data",
  key: "Keynote presentation",
  kml: "XML data",
  latex: "LaTeX document",
  log: "Log file",
  mhtml: "Web archive",
  mobi: "E-book",
  msg: "Outlook message",
  ndjson: "JSON data",
  numbers: "Numbers spreadsheet",
  odf: "OpenDocument formula",
  odp: "OpenDocument presentation",
  ods: "OpenDocument spreadsheet",
  odt: "OpenDocument text",
  odw: "OpenDocument text",
  pages: "Pages document",
  parquet: "Parquet data",
  pot: "PowerPoint template",
  potm: "PowerPoint template",
  potx: "PowerPoint template",
  pps: "PowerPoint slideshow",
  ppsm: "PowerPoint slideshow",
  ppsx: "PowerPoint slideshow",
  ppt: "PowerPoint presentation",
  pptm: "PowerPoint presentation",
  pptx: "PowerPoint presentation",
  rar: "RAR archive",
  ris: "Citation data",
  rss: "XML data",
  rtf: "Rich text document",
  sql: "SQL file",
  sqlite: "Database",
  sqlite3: "Database",
  srt: "Subtitle file",
  ssa: "Subtitle file",
  tar: "Tar archive",
  tex: "LaTeX document",
  tgz: "Tar archive",
  tsv: "TSV data",
  vcf: "Contact file",
  vtt: "Subtitle file",
  xhtml: "HTML",
  xls: "Excel spreadsheet",
  xlsb: "Excel spreadsheet",
  xlsm: "Excel spreadsheet",
  xlsx: "Excel spreadsheet",
  xlt: "Excel template",
  xltm: "Excel template",
  xltx: "Excel template",
  xml: "XML data",
  xz: "XZ archive",
  zip: "ZIP archive",
  zst: "Zstandard archive",
};

// cspell:ignore subrip vcard
const MIME_KIND_LABELS: Record<string, string> = {
  "application/epub+zip": "E-book",
  "application/geo+json": "GeoJSON data",
  "application/gml+xml": "XML data",
  "application/json": "JSON data",
  "application/ld+json": "JSON data",
  "application/rss+xml": "XML data",
  "application/vnd.apache.parquet": "Parquet data",
  "application/vnd.google-earth.kml+xml": "XML data",
  "application/vnd.ms-outlook": "Outlook message",
  "application/vnd.sqlite3": "Database",
  "application/x-ipynb+json": "Jupyter notebook",
  "application/x-sqlite3": "Database",
  "application/x-subrip": "Subtitle file",
  "application/xml": "XML data",
  "message/rfc822": "Email message",
  "text/calendar": "Calendar file",
  "text/csv": "CSV data",
  "text/tab-separated-values": "TSV data",
  "text/vcard": "Contact file",
  "text/x-vcard": "Contact file",
};

const CONFIG_EXTENSIONS = new Set([
  "env",
  "ini",
  "properties",
  "toml",
  "yaml",
  "yml",
]);

export function getFileKindLabel({
  filename,
  mimeType,
}: {
  filename: string;
  mimeType?: string;
}): string {
  const extensionStart = filename.lastIndexOf(".");
  const extension =
    extensionStart === -1
      ? undefined
      : filename.slice(extensionStart + 1).toLowerCase();

  if (extension) {
    const extensionLabel = EXTENSION_KIND_LABELS[extension];
    if (extensionLabel) {
      return extensionLabel;
    }

    if (CONFIG_EXTENSIONS.has(extension)) {
      return "Configuration file";
    }
  }

  if (mimeType) {
    const mimeLabel = MIME_KIND_LABELS[mimeType];
    if (mimeLabel) {
      return mimeLabel;
    }
  }

  return fileKindLabel(getFileType({ filename, mimeType }));
}

export function getFileType({
  filename,
  mimeType,
}: {
  filename: string;
  mimeType?: string;
}): FileType {
  const lowerFilename = filename.toLowerCase();

  if (mimeType) {
    if (mimeType.startsWith("image/")) {
      return "image";
    }

    if (mimeType.startsWith("video/")) {
      return "video";
    }

    if (mimeType.startsWith("audio/")) {
      return "audio";
    }

    if (mimeType === "application/pdf") {
      return "pdf";
    }

    if (mimeType === "text/html") {
      return "html";
    }
  }

  if (isMarkdown({ filename, mimeType })) {
    return "markdown";
  }

  if (/\.html?$/i.test(lowerFilename)) {
    return "html";
  }

  if (isTextMimeType(mimeType)) {
    if (isReadableText({ filename, mimeType })) {
      return "text";
    }
    return "code";
  }

  if (isReadableText({ filename, mimeType })) {
    return "text";
  }

  return "unknown";
}

function isMarkdown({
  filename,
  mimeType,
}: {
  filename: string;
  mimeType?: string;
}): boolean {
  const lowerFilename = filename.toLowerCase();
  return (
    mimeType === "text/markdown" ||
    /\.(?:md|markdown|mdown|mkd|mdx)$/i.test(lowerFilename)
  );
}

function isMarkupFile(filename: string): boolean {
  // cspell:disable-next-line
  return /\.(?:rst|rest|adoc|asciidoc|textile|org|wiki|mediawiki|creole)$/i.test(
    filename.toLowerCase(),
  );
}

function isReadableText({
  filename,
  mimeType,
}: {
  filename: string;
  mimeType?: string;
}): boolean {
  const lowerFilename = filename.toLowerCase();
  const hasNoExtension = !lowerFilename.includes(".");
  const isTextFile =
    lowerFilename.endsWith(".txt") || lowerFilename.endsWith(".text");

  return (
    isTextFile ||
    (hasNoExtension && mimeType === "text/plain") ||
    isMarkdown({ filename, mimeType }) ||
    isMarkupFile(filename)
  );
}
