import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEVICE_FILE_NAME,
  whenWorkspaceHasPhone,
  workspaceHasPhone,
  writeDeviceFile,
} from "./device-file";
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

const day = 24 * 60 * 60 * 1000;
const launch = new Date("2026-11-26T12:00:00.000Z");
const later = (days: number) => new Date(launch.getTime() + days * day);

describe("writeDeviceFile", () => {
  it("names the computer in the device's own folder, and when it ran", async () => {
    await writeDeviceFile({
      device,
      devicesDir,
      file: { name: "Studio", platform: "darwin" },
      now: launch,
    });

    expect(read()).toEqual({
      name: "Studio",
      platform: "darwin",
      seenAt: "2026-11-26T12:00:00.000Z",
    });
  });

  it("leaves the file alone when nothing it says changed within a week", async () => {
    await writeDeviceFile({
      device,
      devicesDir,
      file: { name: "Studio", platform: "darwin" },
      now: launch,
    });
    fs.utimesSync(file(), new Date(0), new Date(0));

    await writeDeviceFile({
      device,
      devicesDir,
      file: { name: "Studio", platform: "darwin" },
      now: later(6),
    });

    expect(fs.statSync(file()).mtimeMs).toBe(0);

    await writeDeviceFile({
      device,
      devicesDir,
      file: { name: "Studio", platform: "darwin" },
      now: later(8),
    });

    expect(read()).toMatchObject({ seenAt: later(8).toISOString() });
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
      now: launch,
    });

    expect(read()).toEqual({
      name: "Sam's Studio",
      person: { id: "u1", issuer: "example.com", name: "Sam" },
      platform: "darwin",
      seenAt: launch.toISOString(),
    });
  });
});

const phone = DeviceIdSchema.parse("dev_P40NE111");

/** Writes a device's `device.json` as its own app would. */
function says(id: string, platform: string) {
  fs.mkdirSync(path.join(devicesDir, id), { recursive: true });
  fs.writeFileSync(
    path.join(devicesDir, id, DEVICE_FILE_NAME),
    JSON.stringify({ name: "Somebody's device", platform }),
  );
}

describe("workspaceHasPhone", () => {
  it.each([
    { has: false, wrote: [] },
    { has: false, wrote: [[device, "darwin"]] },
    {
      has: true,
      wrote: [
        [device, "darwin"],
        [phone, "ios"],
      ],
    },
    // A folder that is not a device's is not read.
    { has: false, wrote: [["not-a-device", "ios"]] },
  ] satisfies { has: boolean; wrote: [string, string][] }[])(
    "answers $has for $wrote",
    async ({ has, wrote }) => {
      for (const [id, platform] of wrote) {
        says(id, platform);
      }
      expect(await workspaceHasPhone(devicesDir)).toBe(has);
    },
  );

  it("answers false for a devices folder that is not there", async () => {
    expect(await workspaceHasPhone(path.join(devicesDir, "missing"))).toBe(
      false,
    );
  });

  it("reads past a device file it cannot parse", async () => {
    fs.mkdirSync(path.join(devicesDir, device), { recursive: true });
    fs.writeFileSync(file(), "{");
    says(phone, "ios");
    expect(await workspaceHasPhone(devicesDir)).toBe(true);
  });
});

describe("whenWorkspaceHasPhone", () => {
  it("answers at once when a phone has already used the workspace", async () => {
    says(phone, "ios");
    expect(await whenWorkspaceHasPhone({ devicesDir })).toBe(true);
  });

  it("answers once a phone's device file arrives", async () => {
    says(device, "darwin");
    let found: boolean | undefined;
    void whenWorkspaceHasPhone({ devicesDir, settleMs: 10 }).then((answer) => {
      found = answer;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(found).toBeUndefined();

    says(phone, "ios");
    await vi.waitFor(() => {
      expect(found).toBe(true);
    });
  });

  it("answers false when stopped before a phone arrives", async () => {
    const controller = new AbortController();
    const answer = whenWorkspaceHasPhone({
      devicesDir,
      signal: controller.signal,
    });
    controller.abort();
    expect(await answer).toBe(false);
  });
});
