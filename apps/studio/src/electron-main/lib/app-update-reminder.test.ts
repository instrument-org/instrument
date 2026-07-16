import { describe, expect, it } from "vitest";

import { deriveUpdateReminder } from "./app-update-reminder";

const HOUR = 60 * 60 * 1000;

const base = {
  hasStagedUpdate: true,
  isPackaged: true,
  now: 25 * HOUR,
  ready: { firstSeenAt: 0, version: "1.2.3" },
  reminderAfterHours: 24,
};

describe("deriveUpdateReminder", () => {
  it("shows once a staged update has been ignored past the threshold", () => {
    expect(deriveUpdateReminder(base)).toEqual({
      show: true,
      version: "1.2.3",
    });
  });

  it("shows exactly at the threshold", () => {
    expect(deriveUpdateReminder({ ...base, now: 24 * HOUR })).toEqual({
      show: true,
      version: "1.2.3",
    });
  });

  it("stays quiet below the threshold", () => {
    expect(deriveUpdateReminder({ ...base, now: 23 * HOUR })).toEqual({
      show: false,
    });
  });

  it("never nudges dev/unpacked builds", () => {
    expect(deriveUpdateReminder({ ...base, isPackaged: false })).toEqual({
      show: false,
    });
  });

  it("waits for an update actually staged this session", () => {
    expect(deriveUpdateReminder({ ...base, hasStagedUpdate: false })).toEqual({
      show: false,
    });
  });

  it("needs a persisted first-seen marker", () => {
    expect(deriveUpdateReminder({ ...base, ready: undefined })).toEqual({
      show: false,
    });
  });
});
