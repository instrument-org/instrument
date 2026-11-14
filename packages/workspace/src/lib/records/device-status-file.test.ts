import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DeviceIdSchema } from "./device-id";
import {
  DEVICE_STATUS_FILE_NAME,
  type DeviceStatus,
  deviceStatusFile,
  isDarkWake,
  isSameDeviceStatus,
  parseSystemCapabilities,
  writeDeviceStatusFile,
  writeDeviceStatusFileSync,
} from "./device-status-file";

const device = DeviceIdSchema.parse("dev_7Q2M4K9X");

const awake: DeviceStatus = {
  app: "2.4.0",
  busy: 1,
  darkWake: false,
  locked: false,
  power: "plugged-in",
  since: new Date("2026-11-12T17:40:00.000Z"),
  state: "awake",
};

const writtenAt = new Date("2026-11-12T18:04:00.000Z");

let devicesDir: string;

beforeEach(() => {
  devicesDir = fs.mkdtempSync(path.join(os.tmpdir(), "devices-"));
});

afterEach(() => {
  fs.rmSync(devicesDir, { force: true, recursive: true });
});

const read = () =>
  fs.readFileSync(
    path.join(devicesDir, device, DEVICE_STATUS_FILE_NAME),
    "utf8",
  );

describe("deviceStatusFile", () => {
  it("writes the status in the file's order", () => {
    expect(deviceStatusFile(awake, writtenAt)).toMatchInlineSnapshot(`
      {
        "app": "2.4.0",
        "busy": 1,
        "darkWake": false,
        "format": 1,
        "locked": false,
        "power": "plugged-in",
        "since": "2026-11-12T17:40:00.000Z",
        "state": "awake",
        "writtenAt": "2026-11-12T18:04:00.000Z",
      }
    `);
  });
});

describe("writeDeviceStatusFile", () => {
  it("writes the file beside the device's own", async () => {
    await writeDeviceStatusFile({
      device,
      devicesDir,
      status: awake,
      writtenAt,
    });

    expect(read()).toMatchInlineSnapshot(`
      "{
        "format": 1,
        "writtenAt": "2026-11-12T18:04:00.000Z",
        "state": "awake",
        "since": "2026-11-12T17:40:00.000Z",
        "darkWake": false,
        "power": "plugged-in",
        "locked": false,
        "busy": 1,
        "app": "2.4.0"
      }"
    `);
  });

  // A Mac whose ioreg could not be read says nothing about dark wake rather
  // than what it read last time.
  it("drops a dark wake it no longer knows", async () => {
    await writeDeviceStatusFile({
      device,
      devicesDir,
      status: awake,
      writtenAt,
    });
    await writeDeviceStatusFile({
      device,
      devicesDir,
      status: { ...awake, darkWake: undefined },
      writtenAt,
    });

    expect(JSON.parse(read())).not.toHaveProperty("darkWake");
  });

  // The quit's write reads nothing, and keeps what a newer build wrote
  // through the file the last write left.
  it("writes closed over the last file it wrote", async () => {
    fs.mkdirSync(path.join(devicesDir, device), { recursive: true });
    fs.writeFileSync(
      path.join(devicesDir, device, DEVICE_STATUS_FILE_NAME),
      JSON.stringify({ thermal: "nominal" }),
    );
    const written = await writeDeviceStatusFile({
      device,
      devicesDir,
      status: awake,
      writtenAt,
    });
    writeDeviceStatusFileSync({
      device,
      devicesDir,
      status: { ...awake, busy: 0, darkWake: undefined, state: "closed" },
      written,
      writtenAt,
    });

    expect(JSON.parse(read())).toMatchInlineSnapshot(`
      {
        "app": "2.4.0",
        "busy": 0,
        "format": 1,
        "locked": false,
        "power": "plugged-in",
        "since": "2026-11-12T17:40:00.000Z",
        "state": "closed",
        "thermal": "nominal",
        "writtenAt": "2026-11-12T18:04:00.000Z",
      }
    `);
  });
});

describe("isSameDeviceStatus", () => {
  it.each([
    ["the same status", awake, true],
    ["another busy count", { ...awake, busy: 2 }, false],
    ["a dark wake", { ...awake, darkWake: true }, false],
    ["an unknown dark wake", { ...awake, darkWake: undefined }, false],
    ["a new since", { ...awake, since: writtenAt }, false],
  ] satisfies [string, DeviceStatus, boolean][])("%s", (_, other, same) => {
    expect(isSameDeviceStatus(awake, { ...other })).toBe(same);
  });
});

describe("parseSystemCapabilities", () => {
  const ioreg = (
    capabilities: string,
  ) => `+-o IOPMrootDomain  <class IOPMrootDomain, id 0x100000100, registered, matched, active, busy 0 (0 ms), retain 47>
    {
      "Supported Features" = {"Low Power Mode"=1}
      "IOSleepSupported" = Yes
      "System Capabilities" = ${capabilities}
      "IOPowerManagement" = {"ChildrenPowerState"=0,"CapabilityFlags"=2,"MaxPowerState"=4}
    }`;

  it.each([
    ["a full wake", "15", 15, false],
    ["a dark wake", "9", 9, true],
  ])("reads %s", (_, written, capabilities, dark) => {
    const parsed = parseSystemCapabilities(ioreg(written));
    expect(parsed).toBe(capabilities);
    expect(isDarkWake(capabilities)).toBe(dark);
  });

  it("reads nothing from output without the property", () => {
    expect(parseSystemCapabilities("")).toBeUndefined();
  });
});
