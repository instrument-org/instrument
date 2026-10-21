import { APP_BUNDLE_ID } from "@instrument-org/shared";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { notificationSettingsTarget } from "./notification-settings";

let withSettingsApp: string;
let withoutSettingsApp: string;

beforeAll(async () => {
  withSettingsApp = await mkdtemp(path.join(tmpdir(), "settings-app-"));
  withoutSettingsApp = await mkdtemp(path.join(tmpdir(), "no-settings-app-"));
  const program = path.join(withSettingsApp, "gnome-control-center");
  await writeFile(program, "#!/bin/sh\n");
  await chmod(program, 0o755);
});

afterAll(async () => {
  await rm(withSettingsApp, { force: true, recursive: true });
  await rm(withoutSettingsApp, { force: true, recursive: true });
});

describe("notificationSettingsTarget", () => {
  it("opens System Settings at the running app's row on macOS", async () => {
    expect(
      await notificationSettingsTarget({
        bundleId: "com.github.Electron",
        env: {},
        platform: "darwin",
      }),
    ).toEqual({
      kind: "url",
      url: "x-apple.systempreferences:com.apple.preference.notifications?id=com.github.Electron",
    });
  });

  it("opens the build's row on macOS when the app's own is unknown", async () => {
    expect(
      await notificationSettingsTarget({ env: {}, platform: "darwin" }),
    ).toEqual({
      kind: "url",
      url: `x-apple.systempreferences:com.apple.preference.notifications?id=${APP_BUNDLE_ID}`,
    });
  });

  it("opens the Notifications page of Settings on Windows", async () => {
    expect(
      await notificationSettingsTarget({ env: {}, platform: "win32" }),
    ).toEqual({ kind: "url", url: "ms-settings:notifications" });
  });

  it.each(["GNOME", "ubuntu:GNOME", "Pop:GNOME"])(
    "opens GNOME Settings at Notifications under %s",
    async (desktop) => {
      expect(
        await notificationSettingsTarget({
          env: { PATH: withSettingsApp, XDG_CURRENT_DESKTOP: desktop },
          platform: "linux",
        }),
      ).toEqual({
        args: ["notifications"],
        command: path.join(withSettingsApp, "gnome-control-center"),
        kind: "command",
      });
    },
  );

  it.each([
    ["GNOME without its Settings app", withoutSettingsApp, "GNOME"],
    ["another desktop", "SETTINGS_APP", "KDE"],
    ["no desktop named", "SETTINGS_APP", undefined],
  ])("has nothing to open under %s", async (_case, dir, desktop) => {
    expect(
      await notificationSettingsTarget({
        env: {
          PATH: dir === "SETTINGS_APP" ? withSettingsApp : dir,
          XDG_CURRENT_DESKTOP: desktop,
        },
        platform: "linux",
      }),
    ).toBeUndefined();
  });
});
