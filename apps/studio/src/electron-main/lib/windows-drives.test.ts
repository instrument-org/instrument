import { describe, expect, it, vi } from "vitest";

import { driveNamesOf, windowsDriveNames } from "./windows-drives";

const runHelper = vi.hoisted(() =>
  vi.fn<(options: { args: string[]; file: string }) => Promise<string>>(),
);

vi.mock("./file-open-target/helper-process", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("./file-open-target/helper-process")
  >()),
  runHelper,
}));

it("has PowerShell answer in UTF-8, so a label with accents arrives whole", async () => {
  runHelper.mockResolvedValue("");
  await windowsDriveNames();
  expect(runHelper.mock.calls[0]?.[0].args.at(-1)).toMatch(
    /^\[Console\]::OutputEncoding = New-Object System\.Text\.UTF8Encoding \$false\n/,
  );
});

describe("driveNamesOf", () => {
  it("names each drive Windows reports the way File Explorer lists it", () => {
    expect(
      driveNamesOf(
        JSON.stringify([
          { DeviceID: "C:", DriveType: 3, ProviderName: null, VolumeName: "" },
          {
            DeviceID: "D:",
            DriveType: 3,
            ProviderName: null,
            VolumeName: "Data",
          },
          {
            DeviceID: "E:",
            DriveType: 2,
            ProviderName: null,
            VolumeName: null,
          },
          {
            DeviceID: "F:",
            DriveType: 5,
            ProviderName: null,
            VolumeName: null,
          },
          {
            DeviceID: "Z:",
            DriveType: 4,
            ProviderName: "\\\\nas\\Public",
            VolumeName: "NAS",
          },
        ]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "C:\\": "Local Disk (C:)",
        "D:\\": "Data (D:)",
        "E:\\": "USB Drive (E:)",
        "F:\\": "DVD Drive (F:)",
        "Z:\\": "Public (\\\\nas) (Z:)",
      }
    `);
  });

  it("reads a lone drive, which PowerShell writes as an object", () => {
    expect(
      driveNamesOf(
        JSON.stringify({ DeviceID: "C:", DriveType: 3, VolumeName: "Windows" }),
      ),
    ).toEqual({ "C:\\": "Windows (C:)" });
  });
});
