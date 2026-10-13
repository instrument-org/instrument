import { describe, expect, it } from "vitest";

import { driveNamesOf } from "./windows-drives";

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
