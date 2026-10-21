import { describe, expect, it } from "vitest";

import {
  expandEventPath,
  guardedFolderOf,
  isOurProgram,
  parseBlockEvents,
  pathsTouch,
  regDword,
} from "./windows-protection";

const HOME = String.raw`C:\Users\windows-user`;
const expand = (logged: string) =>
  expandEventPath(logged, {
    env: { LOCALAPPDATA: `${HOME}\\AppData\\Local` },
    home: HOME,
  });

/** Two of Defender's 1123 events as `wevtutil qe /f:xml /rd:true` prints them: newest first. */
const EVENTS = [
  String.raw`<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><EventID>1123</EventID><TimeCreated SystemTime='2026-10-21T19:33:13.5012878Z'/></System><EventData><Data Name='Product Name'>Microsoft Defender Antivirus</Data><Data Name='Detection Time'>2026-10-21T19:33:13.499Z</Data><Data Name='User'>DESKTOP\windows-user</Data><Data Name='Path'>%userprofile%\Documents\cfa-git-probe</Data><Data Name='Process Name'>C:\Users\windows-user\AppData\Local\Programs\Instrument\resources\app.asar.unpacked\node_modules\dugite\git\mingw64\bin\git.exe</Data></EventData></Event>`,
  String.raw`<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><EventID>1123</EventID><TimeCreated SystemTime='2026-10-21T19:33:13.5012878Z'/></System><EventData><Data Name='Product Name'>Microsoft Defender Antivirus</Data><Data Name='Detection Time'>2026-10-21T19:33:13.499Z</Data><Data Name='User'>DESKTOP\windows-user</Data><Data Name='Path'>%userprofile%\Documents\</Data><Data Name='Process Name'>C:\Users\windows-user\AppData\Local\Programs\Instrument\Instrument.exe</Data></EventData></Event>`,
].join("");

describe("parseBlockEvents", () => {
  it("reads each block's folder and program from the event's own fields, oldest first", () => {
    expect(parseBlockEvents(EVENTS, expand)).toMatchInlineSnapshot(`
      [
        {
          "path": "C:\\Users\\windows-user\\Documents",
          "program": "C:\\Users\\windows-user\\AppData\\Local\\Programs\\Instrument\\Instrument.exe",
        },
        {
          "path": "C:\\Users\\windows-user\\Documents\\cfa-git-probe",
          "program": "C:\\Users\\windows-user\\AppData\\Local\\Programs\\Instrument\\resources\\app.asar.unpacked\\node_modules\\dugite\\git\\mingw64\\bin\\git.exe",
        },
      ]
    `);
  });

  it("finds nothing in an empty answer", () => {
    expect(parseBlockEvents("", expand)).toEqual([]);
  });
});

describe("expandEventPath", () => {
  it.each([
    ["%userprofile%\\Documents\\", String.raw`C:\Users\windows-user\Documents`],
    ["%desktopdirectory%\\", String.raw`C:\Users\windows-user\Desktop`],
    [
      String.raw`%LocalAppData%\x`,
      String.raw`C:\Users\windows-user\AppData\Local\x`,
    ],
    [String.raw`%unknown%\x`, String.raw`%unknown%\x`],
  ])("%s", (logged, expanded) => {
    expect(expand(logged)).toBe(expanded);
  });
});

describe("pathsTouch", () => {
  it.each([
    [
      String.raw`C:\Users\a\Documents`,
      String.raw`c:\users\a\documents\Reports\q3.xlsx`,
      true,
    ],
    [
      String.raw`C:\Users\a\Documents\Reports\q3.xlsx`,
      "C:/Users/a/Documents",
      true,
    ],
    [
      String.raw`C:\Users\a\Documents`,
      String.raw`C:\Users\a\Documents2\x`,
      false,
    ],
    [String.raw`C:\Users\a\Desktop`, String.raw`C:\Users\a\Documents`, false],
  ])("%s and %s: %s", (a, b, touch) => {
    expect(pathsTouch(a, b)).toBe(touch);
  });
});

describe("isOurProgram", () => {
  const where = {
    installDir: String.raw`C:\Users\a\AppData\Local\Programs\Instrument`,
    runtimeDir: String.raw`C:\Users\a\.instrument\runtime`,
  };

  it.each([
    [
      String.raw`C:\Users\a\AppData\Local\Programs\Instrument\Instrument.exe`,
      true,
    ],
    [
      String.raw`c:\users\a\appdata\local\programs\instrument\resources\rg.exe`,
      true,
    ],
    [String.raw`C:\Users\a\.instrument\runtime\python\python.exe`, true],
    [
      String.raw`C:\Users\a\AppData\Local\Programs\Instrument Other\x.exe`,
      false,
    ],
    [String.raw`C:\Program Files\Git\bin\git.exe`, false],
  ])("%s: %s", (program, ours) => {
    expect(isOurProgram(program, where)).toBe(ours);
  });

  it("counts a program the call itself ran", () => {
    expect(
      isOurProgram(String.raw`C:\Program Files\Git\bin\git.exe`, {
        ...where,
        ran: ["C:/Program Files/Git/bin/git.exe"],
      }),
    ).toBe(true);
  });
});

describe("guardedFolderOf", () => {
  it.each([
    [
      String.raw`${HOME}\Documents\Reports\q3.xlsx`,
      String.raw`${HOME}\Documents`,
    ],
    [String.raw`${HOME}\Desktop`, String.raw`${HOME}\Desktop`],
    [String.raw`D:\Projects\guarded`, String.raw`D:\Projects\guarded`],
  ])("%s", (blocked, folder) => {
    expect(guardedFolderOf(blocked, HOME)).toBe(folder);
  });
});

describe("regDword", () => {
  it("reads the value reg query prints, and nothing from a key without it", () => {
    const output = [
      "",
      String.raw`HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows Defender\Windows Defender Exploit Guard\Controlled Folder Access`,
      "    EnableControlledFolderAccess    REG_DWORD    0x1",
      "",
    ].join("\r\n");
    expect(regDword(output, "EnableControlledFolderAccess")).toBe(1);
    expect(regDword("", "EnableControlledFolderAccess")).toBeUndefined();
  });
});
