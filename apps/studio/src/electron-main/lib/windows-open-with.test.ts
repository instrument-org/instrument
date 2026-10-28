import { describe, expect, it } from "vitest";

import { openWithRegistryFile } from "./windows-open-with";

const exePath = String.raw`C:\Users\windows-user\AppData\Local\Instrument\current\Instrument.exe`;

describe("openWithRegistryFile", () => {
  it("lists Instrument in Open With without taking any extension's default", () => {
    expect(
      openWithRegistryFile({ exePath, extensions: ["md", "pdf"] }).split(
        "\r\n",
      ),
    ).toMatchInlineSnapshot(`
      [
        "Windows Registry Editor Version 5.00",
        "",
        "[HKEY_CURRENT_USER\\Software\\Classes\\Instrument.File]",
        "@="Instrument file"",
        "",
        "[HKEY_CURRENT_USER\\Software\\Classes\\Instrument.File\\DefaultIcon]",
        "@="C:\\\\Users\\\\windows-user\\\\AppData\\\\Local\\\\Instrument\\\\current\\\\Instrument.exe,0"",
        "",
        "[HKEY_CURRENT_USER\\Software\\Classes\\Instrument.File\\shell\\open\\command]",
        "@="\\"C:\\\\Users\\\\windows-user\\\\AppData\\\\Local\\\\Instrument\\\\current\\\\Instrument.exe\\" \\"%1\\""",
        "",
        "[HKEY_CURRENT_USER\\Software\\Classes\\Applications\\Instrument.exe\\shell\\open\\command]",
        "@="\\"C:\\\\Users\\\\windows-user\\\\AppData\\\\Local\\\\Instrument\\\\current\\\\Instrument.exe\\" \\"%1\\""",
        "",
        "[HKEY_CURRENT_USER\\Software\\Classes\\Applications\\Instrument.exe\\SupportedTypes]",
        "".md"=""",
        "".pdf"=""",
        "",
        "[HKEY_CURRENT_USER\\Software\\Classes\\.md\\OpenWithProgids]",
        ""Instrument.File"=hex(0):",
        "",
        "[HKEY_CURRENT_USER\\Software\\Classes\\.pdf\\OpenWithProgids]",
        ""Instrument.File"=hex(0):",
        "",
      ]
    `);
  });

  it("takes out exactly what it put in", () => {
    expect(
      openWithRegistryFile({
        exePath,
        extensions: ["md", "pdf"],
        remove: true,
      }).split("\r\n"),
    ).toMatchInlineSnapshot(`
      [
        "Windows Registry Editor Version 5.00",
        "",
        "[HKEY_CURRENT_USER\\Software\\Classes\\.md\\OpenWithProgids]",
        ""Instrument.File"=-",
        "",
        "[HKEY_CURRENT_USER\\Software\\Classes\\.pdf\\OpenWithProgids]",
        ""Instrument.File"=-",
        "",
        "[-HKEY_CURRENT_USER\\Software\\Classes\\Instrument.File]",
        "",
        "[-HKEY_CURRENT_USER\\Software\\Classes\\Applications\\Instrument.exe]",
        "",
      ]
    `);
  });
});
