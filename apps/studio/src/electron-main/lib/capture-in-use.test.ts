import { describe, expect, it } from "vitest";

import { captureInUseFromRegistry } from "./capture-in-use";

// What `reg query <ConsentStore>\microphone /s /v LastUsedTimeStop` prints:
// a key per app that used the device, and 0 for one still using it.
const KEY =
  "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged\\C:#Program Files#App#app.exe";

describe("reading the microphone and camera from the registry", () => {
  it.each([
    [
      "an app still using it",
      `\r\n${KEY}\r\n    LastUsedTimeStop    REG_QWORD    0x0\r\n`,
      true,
    ],
    [
      "apps that stopped",
      `\r\n${KEY}\r\n    LastUsedTimeStop    REG_QWORD    0x1db4a2f6c3e5b10\r\n\r\nEnd of search: 1 match(es) found.\r\n`,
      false,
    ],
    ["a device never used", "", false],
  ])("reads %s as %s", (_, output, inUse) => {
    expect(captureInUseFromRegistry(output)).toBe(inUse);
  });
});
