import { describe, expect, it } from "vitest";

import { programDisplayName } from "./start-menu";

const apps = (id: string) => `C:\\Program Files\\WindowsApps\\${id}`;

const startMenu = [
  {
    AppID: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App",
    Name: "Calculator",
  },
  { AppID: "Microsoft.Paint_8wekyb3d8bbwe!App", Name: "Paint" },
  { AppID: "Microsoft.WindowsTerminal_8wekyb3d8bbwe!App", Name: "Terminal" },
  { AppID: "Microsoft.Windows.Photos_8wekyb3d8bbwe!App", Name: "Photos" },
  { AppID: "Example.Suite_abc123!Writer", Name: "Suite Writer" },
  { AppID: "Example.Suite_abc123!Sheets", Name: "Suite Sheets" },
  { AppID: "Example.Other_abc123!App", Name: "Other" },
  { AppID: "{1AC14E77}\\cmd.exe", Name: "Command Prompt" },
];

describe("programDisplayName", () => {
  // What a Windows 11 install's own apps said, description and all.
  it.each([
    [
      "Calculator",
      apps(
        "Microsoft.WindowsCalculator_11.2607.0.0_x64__8wekyb3d8bbwe\\CalculatorApp.exe",
      ),
      "Calculator",
    ],
    [
      "Paint",
      apps(
        "Microsoft.Paint_11.2605.81.0_x64__8wekyb3d8bbwe\\PaintApp\\mspaint.exe",
      ),
      "mspaint.exe",
    ],
    [
      "Terminal",
      apps(
        "Microsoft.WindowsTerminal_1.24.12741.0_x64__8wekyb3d8bbwe\\WindowsTerminal.exe",
      ),
      "Windows Terminal Host",
    ],
    [
      "Photos",
      apps(
        "Microsoft.Windows.Photos_2026.11090.22001.0_x64__8wekyb3d8bbwe\\Photos.exe",
      ),
      null,
    ],
    // A package with a resource in its folder's name.
    [
      "Other",
      apps("Example.Other_1.0.0.0_neutral_split.scale-100_ABC123\\Other.exe"),
      "Other Host",
    ],
    // Which of a package's entries a program is, its folder doesn't say.
    [
      "Suite Host",
      apps("Example.Suite_1.0.0.0_x64__abc123\\Suite.exe"),
      "Suite Host",
    ],
    // A package the Start menu doesn't list, and a program outside any package.
    [
      "GamingServices",
      apps(
        "Microsoft.GamingServices_39.118.30001.0_x64__8wekyb3d8bbwe\\GamingServices.exe",
      ),
      "GamingServices",
    ],
    [
      "Windows Command Processor",
      "C:\\Windows\\System32\\cmd.exe",
      "Windows Command Processor",
    ],
    [
      undefined,
      apps(
        "Microsoft.WidgetsPlatformRuntime_1.6.19.0_x64__8wekyb3d8bbwe\\WidgetService.exe",
      ),
      "WidgetService.exe",
    ],
    [undefined, "C:\\Tools\\made-by-someone.exe", null],
    [undefined, "C:\\Tools\\made-by-someone.exe", "   "],
  ])("is %s for %s, described as %s", (name, path, description) => {
    expect(programDisplayName({ description, path }, startMenu)).toBe(name);
  });
});
