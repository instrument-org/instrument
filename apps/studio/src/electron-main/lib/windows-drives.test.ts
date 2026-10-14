import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { driveNamesOf } from "./windows-drives";

const runHelper = vi.hoisted(() =>
  vi.fn<(options: { args: string[]; file: string }) => Promise<string>>(),
);

vi.mock("./file-open-target/helper-process", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("./file-open-target/helper-process")
  >()),
  runHelper,
}));

/** What the script writes for these drives. */
const answer = (...drives: { DeviceID: string; VolumeName: string }[]) =>
  JSON.stringify(drives.map((drive) => ({ DriveType: 3, ...drive })));
const C = { DeviceID: "C:", VolumeName: "Windows" };
const E = { DeviceID: "E:", VolumeName: "Photos" };

describe("windowsDriveNames", () => {
  // The names are kept in the module, so each case starts from a fresh one.
  let windowsDriveNames: (roots: string[]) => Promise<Record<string, string>>;
  beforeEach(async () => {
    vi.useFakeTimers();
    runHelper.mockReset();
    vi.resetModules();
    ({ windowsDriveNames } = await import("./windows-drives"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("has PowerShell answer in UTF-8, so a label with accents arrives whole", async () => {
    runHelper.mockResolvedValue("");
    await windowsDriveNames(["C:\\"]);
    expect(runHelper.mock.calls[0]?.[0].args.at(-1)).toMatch(
      /^\[Console\]::OutputEncoding = New-Object System\.Text\.UTF8Encoding \$false\n/,
    );
  });

  it("answers with letters in a moment while Windows is slow, and with names once it has said", async () => {
    let say = (_stdout: string) => {};
    runHelper.mockReturnValueOnce(
      new Promise((resolve) => {
        say = resolve;
      }),
    );
    const first = windowsDriveNames(["C:\\"]);
    await vi.advanceTimersByTimeAsync(500);
    await expect(first).resolves.toEqual({});

    say(answer(C));
    await vi.advanceTimersByTimeAsync(0);
    await expect(windowsDriveNames(["C:\\"])).resolves.toEqual({
      "C:\\": "Windows (C:)",
    });
    expect(runHelper).toHaveBeenCalledTimes(1);
  });

  it("keeps the names it has when asking again fails", async () => {
    runHelper.mockResolvedValueOnce(answer(C));
    await windowsDriveNames(["C:\\"]);
    vi.advanceTimersByTime(30_000);

    runHelper.mockRejectedValueOnce(new Error("timed out"));
    await expect(windowsDriveNames(["C:\\"])).resolves.toEqual({
      "C:\\": "Windows (C:)",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(runHelper).toHaveBeenCalledTimes(2);
    await expect(windowsDriveNames(["C:\\"])).resolves.toEqual({
      "C:\\": "Windows (C:)",
    });
  });

  it("asks again at once for a drive plugged in since, and names it", async () => {
    runHelper.mockResolvedValueOnce(answer(C));
    await windowsDriveNames(["C:\\"]);

    runHelper.mockResolvedValueOnce(answer(C, E));
    await expect(windowsDriveNames(["C:\\", "E:\\"])).resolves.toEqual({
      "C:\\": "Windows (C:)",
      "E:\\": "Photos (E:)",
    });
    expect(runHelper).toHaveBeenCalledTimes(2);
  });

  it("leaves a drive Windows did not name to its letter without asking again", async () => {
    runHelper.mockResolvedValueOnce(answer(C));
    await windowsDriveNames(["C:\\", "Z:\\"]);
    await expect(windowsDriveNames(["C:\\", "Z:\\"])).resolves.toEqual({
      "C:\\": "Windows (C:)",
    });
    expect(runHelper).toHaveBeenCalledTimes(1);
  });
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
          // A network drive's label is never asked for; one mapped for good
          // has its share in the registry, and one mapped for the session
          // does not.
          {
            DeviceID: "Y:",
            DriveType: 4,
            ProviderName: null,
            VolumeName: null,
          },
          {
            DeviceID: "Z:",
            DriveType: 4,
            ProviderName: "\\\\nas\\Public",
            VolumeName: null,
          },
        ]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "C:\\": "Local Disk (C:)",
        "D:\\": "Data (D:)",
        "E:\\": "USB Drive (E:)",
        "F:\\": "DVD Drive (F:)",
        "Y:\\": "Network Drive (Y:)",
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
