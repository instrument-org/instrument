import {
  type FileIconToken,
  getFileIconToken,
} from "@/client/lib/get-file-icon-token";
import { type Icon } from "@phosphor-icons/react";
import { CalendarBlankIcon } from "@phosphor-icons/react/CalendarBlank";
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
import {
  BsFileBinary,
  BsFileCode,
  BsFileEarmarkFont,
  BsFileEarmarkImage,
  BsFileEarmarkPerson,
  BsFileEarmarkPlay,
  BsFileEarmarkPost,
  BsFileEarmarkPpt,
  BsFileEarmarkRichtext,
  BsFileEarmarkSpreadsheet,
  BsFileEarmarkWord,
} from "react-icons/bs";
import { type IconType } from "react-icons/lib";
import { TbFileDatabase } from "react-icons/tb";

type AnyIcon = Icon | IconType;

const TOKEN_ICONS: Record<FileIconToken, AnyIcon> = {
  archive: FileArchiveIcon,
  audio: FileAudioIcon,
  binary: BsFileBinary,
  c: FileCIcon,
  calendar: CalendarBlankIcon,
  code: BsFileCode,
  config: FileCodeIcon,
  contact: BsFileEarmarkPerson,
  cpp: FileCppIcon,
  csharp: FileCSharpIcon,
  css: FileCssIcon,
  csv: FileCsvIcon,
  database: TbFileDatabase,
  document: BsFileEarmarkWord,
  ebook: BsFileEarmarkRichtext,
  email: BsFileEarmarkPost,
  font: BsFileEarmarkFont,
  html: FileHtmlIcon,
  image: BsFileEarmarkImage,
  ini: FileIniIcon,
  javascript: FileJsIcon,
  jpg: FileJpgIcon,
  jsx: FileJsxIcon,
  markdown: FileMdIcon,
  pdf: FilePdfIcon,
  png: FilePngIcon,
  presentation: FilePptIcon,
  python: FilePyIcon,
  richtext: BsFileEarmarkRichtext,
  rust: FileRsIcon,
  slides: BsFileEarmarkPpt,
  spreadsheet: FileXlsIcon,
  sql: FileSqlIcon,
  subtitle: BsFileEarmarkPlay,
  svg: FileSvgIcon,
  table: BsFileEarmarkSpreadsheet,
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
