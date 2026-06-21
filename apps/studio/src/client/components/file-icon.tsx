import { FileAudioIcon, FileCIcon, FileCodeIcon, FileCppIcon, FileCSharpIcon, FileCssIcon, FileCsvIcon, FileDocIcon, FileHtmlIcon, FileIniIcon, FileJpgIcon, FileJsIcon, FileJsxIcon, FileMdIcon, FilePdfIcon, FilePngIcon, FilePptIcon, FilePyIcon, FileRsIcon, FileSqlIcon, FileSvgIcon, FileTextIcon, FileTsIcon, FileTsxIcon, FileTxtIcon, FileVideoIcon, FileVueIcon, FileXlsIcon, FileZipIcon, type Icon, FileIcon as PhFileIcon } from "@phosphor-icons/react";
import { BsFileBinary, BsFileCode, BsFileEarmarkFont, BsFileEarmarkImage, BsFileEarmarkPpt, BsFileEarmarkRichtext, BsFileEarmarkSpreadsheet, BsFileEarmarkWord } from "react-icons/bs";
import { type IconType } from "react-icons/lib";

import { EXTENSION_MAP } from "../lib/file-extension-to-language";

type AnyIcon = Icon | IconType;

const EXTENSION_ICON_MAP: Record<string, AnyIcon | null> = {
  // --- Phosphor first-class file icons ---
  c: FileCIcon,
  cc: FileCppIcon,
  cjs: FileJsIcon,
  cpp: FileCppIcon,
  cs: FileCSharpIcon,
  css: FileCssIcon,
  csv: FileCsvIcon,
  cts: FileTsIcon,
  cxx: FileCppIcon,
  doc: FileDocIcon,
  docx: FileDocIcon,
  h: FileCIcon,
  hpp: FileCppIcon,
  htm: FileHtmlIcon,
  html: FileHtmlIcon,
  ini: FileIniIcon,
  jpeg: FileJpgIcon,
  jpg: FileJpgIcon,
  js: FileJsIcon,
  jsx: FileJsxIcon,
  md: FileMdIcon,
  mdx: FileMdIcon,
  mjs: FileJsIcon,
  mts: FileTsIcon,
  pdf: FilePdfIcon,
  png: FilePngIcon,
  ppt: FilePptIcon,
  pptx: FilePptIcon,
  py: FilePyIcon,
  rs: FileRsIcon,
  sql: FileSqlIcon,
  svg: FileSvgIcon,
  toml: FileIniIcon,
  ts: FileTsIcon,
  tsx: FileTsxIcon,
  txt: FileTxtIcon,
  vue: FileVueIcon,
  xls: FileXlsIcon,
  xlsx: FileXlsIcon,
  yaml: FileCodeIcon,
  yml: FileCodeIcon,

  // --- Archives ---
  "7z": FileZipIcon,
  gz: FileZipIcon,
  rar: FileZipIcon,
  tar: FileZipIcon,
  zip: FileZipIcon,

  // --- Audio (Phosphor FileAudioIcon) ---
  aac: FileAudioIcon,
  flac: FileAudioIcon,
  m4a: FileAudioIcon,
  mp3: FileAudioIcon,
  ogg: FileAudioIcon,
  wav: FileAudioIcon,

  // --- Video (Phosphor FileVideoIcon) ---
  avi: FileVideoIcon,
  mkv: FileVideoIcon,
  mov: FileVideoIcon,
  mp4: FileVideoIcon,
  webm: FileVideoIcon,

  // --- Images not covered by Phosphor specifics ---
  ai: BsFileEarmarkImage,
  bmp: BsFileEarmarkImage,
  gif: BsFileEarmarkImage,
  heic: BsFileEarmarkImage,
  psd: BsFileEarmarkImage,
  raw: BsFileEarmarkImage,
  tif: BsFileEarmarkImage,
  tiff: BsFileEarmarkImage,
  webp: BsFileEarmarkImage,

  // --- Office / docs ---
  epub: BsFileEarmarkRichtext,
  key: BsFileEarmarkPpt,
  numbers: BsFileEarmarkSpreadsheet,
  odf: BsFileEarmarkRichtext,
  odp: BsFileEarmarkPpt,
  ods: BsFileEarmarkSpreadsheet,
  odt: BsFileEarmarkWord,
  odw: BsFileEarmarkWord,
  pages: BsFileEarmarkWord,
  rtf: BsFileEarmarkRichtext,
  tsv: BsFileEarmarkSpreadsheet,

  // --- Fonts ---
  otf: BsFileEarmarkFont,
  ttf: BsFileEarmarkFont,
  woff: BsFileEarmarkFont,
  woff2: BsFileEarmarkFont,

  // --- Binary / executable ---
  dll: BsFileBinary,
  // cspell:ignore dylib
  dylib: BsFileBinary,
  exe: BsFileBinary,
  so: BsFileBinary,
};

// Populate all code-language extensions that aren't already explicitly mapped
// above with BsFileCode as a generic code fallback.
for (const ext of Object.keys(EXTENSION_MAP)) {
  if (!(ext in EXTENSION_ICON_MAP)) {
    EXTENSION_ICON_MAP[ext] = BsFileCode;
  }
}

const FILENAME_ICON_MAP: Record<string, AnyIcon | null> = {
  ".env": FileIniIcon,
  ".gitignore": FileCodeIcon,
  changelog: FileTxtIcon,
  dockerfile: FileCodeIcon,
  license: FileTxtIcon,
  makefile: FileCodeIcon,
  readme: FileMdIcon,
};

export function FileIcon({
  className = "size-5",
  fallbackExtension,
  filename,
  mimeType,
}: {
  className?: string;
  fallbackExtension?: string;
  filename: string;
  mimeType?: string;
}) {
  const lowerName = filename.toLowerCase();
  let IconComponent: AnyIcon = PhFileIcon;

  if (FILENAME_ICON_MAP[lowerName]) {
    IconComponent = FILENAME_ICON_MAP[lowerName];
  } else {
    const ext = getFileExtension(filename);
    if (ext && EXTENSION_ICON_MAP[ext]) {
      IconComponent = EXTENSION_ICON_MAP[ext] ?? IconComponent;
    } else if (
      fallbackExtension &&
      EXTENSION_ICON_MAP[fallbackExtension.toLowerCase()]
    ) {
      IconComponent =
        EXTENSION_ICON_MAP[fallbackExtension.toLowerCase()] ?? IconComponent;
    } else if (mimeType?.startsWith("text/")) {
      IconComponent = FileTextIcon;
    }
  }

  return <IconComponent className={className} />;
}

function getFileExtension(filename: string): string {
  const lowerName = filename.toLowerCase();
  const lastDotIndex = lowerName.lastIndexOf(".");
  if (lastDotIndex === -1 || lastDotIndex === 0) {
    return "";
  }
  return lowerName.slice(lastDotIndex + 1);
}
