import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEVICE_FILE_NAME, writeDeviceFile } from "./device-file";
import { DeviceIdSchema } from "./device-id";

const device = DeviceIdSchema.parse("dev_7Q2M4K9X");

let devicesDir: string;

beforeEach(() => {
  devicesDir = fs.mkdtempSync(path.join(os.tmpdir(), "devices-"));
});

afterEach(() => {
  fs.rmSync(devicesDir, { force: true, recursive: true });
});

const file = () => path.join(devicesDir, device, DEVICE_FILE_NAME);
const read = () => JSON.parse(fs.readFileSync(file(), "utf8")) as unknown;

describe("writeDeviceFile", () => {
  it("names the computer in the device's own folder", async () => {
    await writeDeviceFile({
      device,
      devicesDir,
      file: { name: "Studio", platform: "darwin" },
    });

    expect(read()).toEqual({ name: "Studio", platform: "darwin" });
  });

  it("leaves the file alone when nothing it says changed", async () => {
    await writeDeviceFile({
      device,
      devicesDir,
      file: { name: "Studio", platform: "darwin" },
    });
    fs.utimesSync(file(), new Date(0), new Date(0));

    await writeDeviceFile({
      device,
      devicesDir,
      file: { name: "Studio", platform: "darwin" },
    });

    expect(fs.statSync(file()).mtimeMs).toBe(0);
  });

  // A person a service vouches for is written by that service, and a rename
  // of the computer keeps it.
  it("carries forward what this build does not write", async () => {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(
      file(),
      JSON.stringify({
        name: "Studio",
        person: { id: "u1", issuer: "example.com", name: "Sam" },
        platform: "darwin",
      }),
    );

    await writeDeviceFile({
      device,
      devicesDir,
      file: { name: "Sam's Studio", platform: "darwin" },
    });

    expect(read()).toEqual({
      name: "Sam's Studio",
      person: { id: "u1", issuer: "example.com", name: "Sam" },
      platform: "darwin",
    });
  });
});
