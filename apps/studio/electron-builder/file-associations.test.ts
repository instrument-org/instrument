import { describe, expect, it } from "vitest";

import {
  WINDOWS_EXTENSIONS,
  windowsFileAssociationsScript,
} from "./file-associations";

describe("windowsFileAssociationsScript", () => {
  it("adds Instrument to Open With and takes it out on uninstall", () => {
    expect(windowsFileAssociationsScript(["md"])).toMatchInlineSnapshot(`
      "!macro customInstall
        WriteRegStr SHELL_CONTEXT "Software\\Classes\\Instrument.File" "" "Instrument file"
        WriteRegStr SHELL_CONTEXT "Software\\Classes\\Instrument.File\\DefaultIcon" "" "$appExe,0"
        WriteRegStr SHELL_CONTEXT "Software\\Classes\\Instrument.File\\shell\\open\\command" "" '"$appExe" "%1"'
        WriteRegStr SHELL_CONTEXT "Software\\Classes\\Applications\\\${APP_EXECUTABLE_FILENAME}\\shell\\open\\command" "" '"$appExe" "%1"'
        WriteRegNone SHELL_CONTEXT "Software\\Classes\\.md\\OpenWithProgids" "Instrument.File"
        WriteRegStr SHELL_CONTEXT "Software\\Classes\\Applications\\\${APP_EXECUTABLE_FILENAME}\\SupportedTypes" ".md" ""
        System::Call "shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)"
      !macroend

      !macro customUnInstall
        DeleteRegValue SHELL_CONTEXT "Software\\Classes\\.md\\OpenWithProgids" "Instrument.File"
        DeleteRegKey SHELL_CONTEXT "Software\\Classes\\Instrument.File"
        DeleteRegKey SHELL_CONTEXT "Software\\Classes\\Applications\\\${APP_EXECUTABLE_FILENAME}"
        System::Call "shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)"
      !macroend
      "
    `);
  });

  it("never writes an extension's own default", () => {
    const script = windowsFileAssociationsScript(WINDOWS_EXTENSIONS);
    const extensionWrites = script
      .split("\n")
      .filter((line) =>
        /^\s*Write\w+ SHELL_CONTEXT "Software\\Classes\\\./.test(line),
      );
    expect(extensionWrites).toHaveLength(WINDOWS_EXTENSIONS.length);
    for (const line of extensionWrites) {
      expect(line).toMatch(/\\OpenWithProgids" "Instrument\.File"$/);
    }
  });
});
