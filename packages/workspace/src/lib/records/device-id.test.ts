import { describe, expect, it } from "vitest";

import {
  chooseDeviceId,
  DeviceIdSchema,
  hardwareIdOf,
  newDeviceId,
} from "./device-id";
import { DEVICE_A, DEVICE_B } from "./test-records";

const MACHINE = "4C4C4544-0035-3010-8052-B4C04F4E4D32";
const OTHER_MACHINE = "1A2B3C4D-0000-1111-2222-333344445555";

const newId = () => DEVICE_B;

describe("newDeviceId", () => {
  it("makes a dev_ id of eight Crockford base32 characters", () => {
    const ids = Array.from({ length: 200 }, newDeviceId);

    for (const id of ids) {
      expect(DeviceIdSchema.safeParse(id).success).toBe(true);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("hardwareIdOf", () => {
  it("hashes the machine's id, ignoring the newline a file ends it with", () => {
    expect(hardwareIdOf(`${MACHINE}\n`)).toBe(hardwareIdOf(MACHINE));
    expect(hardwareIdOf(MACHINE)).toMatch(/^[0-9a-f]{64}$/);
    expect(hardwareIdOf(MACHINE)).not.toContain(MACHINE.toLowerCase());
  });
});

describe("chooseDeviceId", () => {
  it.each([
    [
      "keeps the stored id on the hardware it was made on",
      { deviceId: DEVICE_A, hardwareId: hardwareIdOf(MACHINE) },
      MACHINE,
      {
        deviceId: DEVICE_A,
        hardwareId: hardwareIdOf(MACHINE),
        reason: "kept",
        store: false,
      },
    ],
    [
      "makes one on a first launch",
      undefined,
      MACHINE,
      {
        deviceId: DEVICE_B,
        hardwareId: hardwareIdOf(MACHINE),
        reason: "new-install",
        store: true,
      },
    ],
    [
      "makes one when the stored id is not one",
      { deviceId: "laptop", hardwareId: hardwareIdOf(MACHINE) },
      MACHINE,
      {
        deviceId: DEVICE_B,
        hardwareId: hardwareIdOf(MACHINE),
        reason: "new-install",
        store: true,
      },
    ],
    [
      "makes one on other hardware, as after a restore or a migration",
      { deviceId: DEVICE_A, hardwareId: hardwareIdOf(OTHER_MACHINE) },
      MACHINE,
      {
        deviceId: DEVICE_B,
        hardwareId: hardwareIdOf(MACHINE),
        reason: "other-hardware",
        store: true,
      },
    ],
    [
      "makes one when no hardware hash was stored",
      { deviceId: DEVICE_A },
      MACHINE,
      {
        deviceId: DEVICE_B,
        hardwareId: hardwareIdOf(MACHINE),
        reason: "other-hardware",
        store: true,
      },
    ],
    [
      "keeps the stored id when the machine's id cannot be read",
      { deviceId: DEVICE_A, hardwareId: hardwareIdOf(MACHINE) },
      undefined,
      {
        deviceId: DEVICE_A,
        hardwareId: hardwareIdOf(MACHINE),
        reason: "kept-machine-id-unreadable",
        store: false,
      },
    ],
    [
      "makes one with no hardware hash when there is nothing to keep or hash",
      undefined,
      undefined,
      {
        deviceId: DEVICE_B,
        reason: "new-machine-id-unreadable",
        store: true,
      },
    ],
  ])("%s", (_name, stored, machineId, expected) => {
    expect(chooseDeviceId(stored, machineId, newId)).toEqual(expected);
  });
});
