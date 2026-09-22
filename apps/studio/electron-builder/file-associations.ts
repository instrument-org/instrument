import { APP_NAME } from "@instrument-org/shared";
import { type FileAssociation } from "electron-builder";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  DOCUMENT_EXTENSIONS,
  fileKindLabel,
  type FileType,
  MEDIA_EXTENSIONS,
} from "../src/client/lib/get-file-type";

/** Every extension a viewer opens, by the viewer that opens it. */
const VIEWED_EXTENSIONS: Record<string, FileType> = {
  ...DOCUMENT_EXTENSIONS,
  ...MEDIA_EXTENSIONS,
  htm: "html",
  html: "html",
  markdown: "markdown",
  md: "markdown",
  mdown: "markdown",
  mdx: "markdown",
  mkd: "markdown",
};

const viewedByType = new Map<FileType, string[]>();
for (const [extension, fileType] of Object.entries(VIEWED_EXTENSIONS)) {
  viewedByType.set(fileType, [
    ...(viewedByType.get(fileType) ?? []),
    extension,
  ]);
}

/**
 * Instrument in the Finder's Open With for everything it can show, and the
 * default for none of it: an Alternate rank never takes a type from the app
 * that has it. Viewer until there is an editor to open a file into.
 */
export const macFileAssociations = [...viewedByType].map(
  ([fileType, ext]): FileAssociation => ({
    ext,
    name: fileKindLabel(fileType),
    rank: "Alternate",
    role: "Viewer",
  }),
);

/**
 * The extensions Windows offers Instrument for. Text and JSON are named here
 * because Windows has no content type that covers them the way macOS does.
 */
export const WINDOWS_EXTENSIONS = [
  ...Object.keys(VIEWED_EXTENSIONS),
  "json",
  "txt",
].toSorted();

const PROG_ID = `${APP_NAME}.File`;

/** The installed executable's file name, as NSIS knows it. */
 
const NSIS_EXECUTABLE = "${APP_EXECUTABLE_FILENAME}";

/**
 * The NSIS hooks that put Instrument in Explorer's Open With for each
 * extension and take it out again on uninstall.
 *
 * Written by hand because electron-builder's own association macro also sets
 * each extension's default value to its class, which makes the app the
 * default wherever the user never chose one, and its uninstaller deletes the
 * class while leaving the extension pointing at it. These write only the two
 * lists Open With reads, `OpenWithProgids` and the application's
 * `SupportedTypes`, and never an extension's default.
 */
export function windowsFileAssociationsScript(extensions: string[]) {
  const applicationKey = `Software\\Classes\\Applications\\${NSIS_EXECUTABLE}`;
  const classKey = `Software\\Classes\\${PROG_ID}`;
  const extensionKey = (extension: string) =>
    String.raw`Software\Classes\.${extension}\OpenWithProgids`;
  const refresh = `  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)"`;
  return [
    "!macro customInstall",
    `  WriteRegStr SHELL_CONTEXT "${classKey}" "" "${APP_NAME} file"`,
    String.raw`  WriteRegStr SHELL_CONTEXT "${classKey}\DefaultIcon" "" "$appExe,0"`,
    String.raw`  WriteRegStr SHELL_CONTEXT "${classKey}\shell\open\command" "" '"$appExe" "%1"'`,
    String.raw`  WriteRegStr SHELL_CONTEXT "${applicationKey}\shell\open\command" "" '"$appExe" "%1"'`,
    ...extensions.flatMap((extension) => [
      `  WriteRegNone SHELL_CONTEXT "${extensionKey(extension)}" "${PROG_ID}"`,
      String.raw`  WriteRegStr SHELL_CONTEXT "${applicationKey}\SupportedTypes" ".${extension}" ""`,
    ]),
    refresh,
    "!macroend",
    "",
    "!macro customUnInstall",
    ...extensions.map(
      (extension) =>
        `  DeleteRegValue SHELL_CONTEXT "${extensionKey(extension)}" "${PROG_ID}"`,
    ),
    `  DeleteRegKey SHELL_CONTEXT "${classKey}"`,
    `  DeleteRegKey SHELL_CONTEXT "${applicationKey}"`,
    refresh,
    "!macroend",
    "",
  ].join("\n");
}

/**
 * The hooks written where NSIS can include them. electron-builder takes the
 * include as a path, and the script is derived from the viewer tables rather
 * than kept beside them.
 */
export function writeWindowsFileAssociationsScript() {
  const file = path.join(tmpdir(), `${APP_NAME}-file-associations.nsh`);
  writeFileSync(file, windowsFileAssociationsScript(WINDOWS_EXTENSIONS));
  return file;
}
