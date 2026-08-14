import {
  type FileIconToken,
  getFileIconToken,
} from "@/client/lib/get-file-icon-token";
import { type Icon } from "@phosphor-icons/react";
import { BinaryIcon } from "@phosphor-icons/react/Binary";
import { BookOpenTextIcon } from "@phosphor-icons/react/BookOpenText";
import { CalendarBlankIcon } from "@phosphor-icons/react/CalendarBlank";
import { DatabaseIcon } from "@phosphor-icons/react/Database";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/EnvelopeSimple";
import { FileIcon as PhFileIcon } from "@phosphor-icons/react/File";
import { FileArchiveIcon } from "@phosphor-icons/react/FileArchive";
import { FileAudioIcon } from "@phosphor-icons/react/FileAudio";
import { FileCIcon } from "@phosphor-icons/react/FileC";
import { FileCodeIcon } from "@phosphor-icons/react/FileCode";
import { FileCppIcon } from "@phosphor-icons/react/FileCpp";
import { FileCSharpIcon } from "@phosphor-icons/react/FileCSharp";
import { FileCssIcon } from "@phosphor-icons/react/FileCss";
import { FileCsvIcon } from "@phosphor-icons/react/FileCsv";
import { FileDocIcon } from "@phosphor-icons/react/FileDoc";
import { FileHtmlIcon } from "@phosphor-icons/react/FileHtml";
import { FileImageIcon } from "@phosphor-icons/react/FileImage";
import { FileIniIcon } from "@phosphor-icons/react/FileIni";
import { FileJpgIcon } from "@phosphor-icons/react/FileJpg";
import { FileJsIcon } from "@phosphor-icons/react/FileJs";
import { FileJsxIcon } from "@phosphor-icons/react/FileJsx";
import { FileMdIcon } from "@phosphor-icons/react/FileMd";
import { FilePdfIcon } from "@phosphor-icons/react/FilePdf";
import { FilePngIcon } from "@phosphor-icons/react/FilePng";
import { FilePptIcon } from "@phosphor-icons/react/FilePpt";
import { FilePyIcon } from "@phosphor-icons/react/FilePy";
import { FileRsIcon } from "@phosphor-icons/react/FileRs";
import { FileSqlIcon } from "@phosphor-icons/react/FileSql";
import { FileSvgIcon } from "@phosphor-icons/react/FileSvg";
import { FileTextIcon } from "@phosphor-icons/react/FileText";
import { FileTsIcon } from "@phosphor-icons/react/FileTs";
import { FileTsxIcon } from "@phosphor-icons/react/FileTsx";
import { FileTxtIcon } from "@phosphor-icons/react/FileTxt";
import { FileVideoIcon } from "@phosphor-icons/react/FileVideo";
import { FileVueIcon } from "@phosphor-icons/react/FileVue";
import { FileXlsIcon } from "@phosphor-icons/react/FileXls";
import { FileZipIcon } from "@phosphor-icons/react/FileZip";
import { IdentificationCardIcon } from "@phosphor-icons/react/IdentificationCard";
import { PresentationIcon } from "@phosphor-icons/react/Presentation";
import { SubtitlesIcon } from "@phosphor-icons/react/Subtitles";
import { TableIcon } from "@phosphor-icons/react/Table";
import { TextAaIcon } from "@phosphor-icons/react/TextAa";

// One icon set, so every glyph carries the same stroke weight. Where the set
// draws no page for a format, the token takes the icon that names the thing
// itself -- a database, an envelope, a table -- rather than a page from
// elsewhere that would sit heavier than its neighbors.
const TOKEN_ICONS: Record<FileIconToken, Icon> = {
  archive: FileArchiveIcon,
  audio: FileAudioIcon,
  binary: BinaryIcon,
  c: FileCIcon,
  calendar: CalendarBlankIcon,
  code: FileCodeIcon,
  config: FileCodeIcon,
  contact: IdentificationCardIcon,
  cpp: FileCppIcon,
  csharp: FileCSharpIcon,
  css: FileCssIcon,
  csv: FileCsvIcon,
  database: DatabaseIcon,
  document: FileTextIcon,
  ebook: BookOpenTextIcon,
  email: EnvelopeSimpleIcon,
  font: TextAaIcon,
  html: FileHtmlIcon,
  image: FileImageIcon,
  ini: FileIniIcon,
  javascript: FileJsIcon,
  jpg: FileJpgIcon,
  jsx: FileJsxIcon,
  markdown: FileMdIcon,
  pdf: FilePdfIcon,
  png: FilePngIcon,
  presentation: FilePptIcon,
  python: FilePyIcon,
  richtext: FileTextIcon,
  rust: FileRsIcon,
  slides: PresentationIcon,
  spreadsheet: FileXlsIcon,
  sql: FileSqlIcon,
  subtitle: SubtitlesIcon,
  svg: FileSvgIcon,
  table: TableIcon,
  text: FileTextIcon,
  tsx: FileTsxIcon,
  txt: FileTxtIcon,
  typescript: FileTsIcon,
  unknown: PhFileIcon,
  video: FileVideoIcon,
  vue: FileVueIcon,
  word: FileDocIcon,
  zip: FileZipIcon,
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
  const IconComponent =
    TOKEN_ICONS[getFileIconToken({ fallbackExtension, filename, mimeType })];

  return <IconComponent className={className} />;
}
