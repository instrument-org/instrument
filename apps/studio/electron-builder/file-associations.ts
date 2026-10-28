import { APP_NAME } from "@instrument-org/shared";
import { type FileAssociation } from "electron-builder";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { fileKindLabel, type FileType } from "../src/client/lib/get-file-type";
import {
  VIEWED_EXTENSIONS,
  WINDOWS_EXTENSIONS,
  WINDOWS_PROG_ID,
} from "../src/shared/open-with";

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
 * Which of the Mac document types wear the app's own icon, by index.
 * electron-builder gives every association with no icon of its own the app's,
 * and macOS then draws a file of that type, wherever Instrument is the app it
 * goes to, as the Instrument app itself: in the Finder, and on the cursor when
 * one is dragged. With no icon named, macOS draws a document of its own.
 */
export function documentTypesWearingAppIcon(
  types: readonly { CFBundleTypeIconFile?: string }[],
  appIcon: string,
): number[] {
  return types.flatMap((type, index) =>
    type.CFBundleTypeIconFile === appIcon ? [index] : [],
  );
}

export { WINDOWS_EXTENSIONS };

const PROG_ID = WINDOWS_PROG_ID;

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
 * The installer's one include, written where NSIS can read it: the installer
 * marked DPI aware, so Windows draws its window at the display's own scale
 * rather than stretching a 96 DPI one blurry, and the file association
 * hooks. electron-builder takes the include as a path, and the hooks are
 * derived from the viewer tables rather than kept beside them.
 */
export function writeWindowsInstallerScript({
  fileAssociations,
}: {
  fileAssociations: boolean;
}) {
  const file = path.join(tmpdir(), `${APP_NAME}-installer.nsh`);
  writeFileSync(
    file,
    [
      "ManifestDPIAware true",
      ...(fileAssociations
        ? ["", windowsFileAssociationsScript(WINDOWS_EXTENSIONS)]
        : []),
    ].join("\n"),
  );
  return file;
}
