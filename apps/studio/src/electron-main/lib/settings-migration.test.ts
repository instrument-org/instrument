import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  migrateMachineSettings,
  migrateWorkspaceSettings,
  workspaceSettingsDirOf,
} from "./settings-migration";
import {
  defaultWorkspacePath,
  readWorkspaceIdentity,
  type ResolvedWorkspace,
} from "./workspaces";

let userDataDir: string;

beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "settings-migration-"));
});

afterEach(() => {
  fs.rmSync(userDataDir, { force: true, recursive: true });
});

function read(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function write(relative: string, value: unknown) {
  const file = path.join(userDataDir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    typeof value === "string" ? value : JSON.stringify(value),
  );
}

const defaultWorkspace = (): ResolvedWorkspace => ({
  id: "default",
  isDefault: true,
  path: defaultWorkspacePath(userDataDir),
  pinned: false,
});

const LEGACY_PREFERENCES = {
  agentCompletionNotifications: "always",
  defaultModelURI: "instrument/auto",
  developerMode: true,
  enableUsageMetrics: false,
  lastLaunchedVersion: "2.0.0-beta.39",
  lastUpdateCheck: 42,
  preferApiKeyOverAccount: true,
  releaseChannel: "beta",
  theme: "dark",
};
const LEGACY_APP_STATE = {
  hasCompletedProviderSetup: true,
  lastMigratedVersion: "2.0.0-beta.39",
  telemetryId: "anon-1",
};

function migrateBoth(workspace = defaultWorkspace()) {
  return [
    ...migrateMachineSettings(userDataDir),
    ...migrateWorkspaceSettings({ userDataDir, workspace }),
  ];
}

function seedLegacy(flavor: "dev" | "packaged") {
  write("preferences.json", LEGACY_PREFERENCES);
  write("app-state.json", LEGACY_APP_STATE);
  write("window-state.json", { zoom: 1.1 });
  write("features.json", {});
  write("app-connections.json", { connections: {} });
  if (flavor === "dev") {
    write("session-dev.json", { apiBearerToken: "token" });
    write("providers.json", { providers: [] });
  } else {
    write("session.json.enc", "ciphertext");
    write("providers.json.enc", "ciphertext");
  }
  write("page-thumbnails/a.jpg", "jpeg");
  write("Local Storage/leveldb/000003.log", "tabs");
}

describe("settings migration", () => {
  it.each(["dev", "packaged"] as const)(
    "splits and moves a %s install into machine and default workspace stores",
    (flavor) => {
      seedLegacy(flavor);
      migrateBoth();

      const settings = workspaceSettingsDirOf(defaultWorkspacePath(userDataDir));
      expect(read(path.join(userDataDir, "machine-preferences.json"))).toEqual({
        enableUsageMetrics: false,
        releaseChannel: "beta",
      });
      expect(read(path.join(userDataDir, "machine-state.json"))).toEqual({
        lastLaunchedVersion: "2.0.0-beta.39",
        lastMigratedVersion: "2.0.0-beta.39",
        lastUpdateCheck: 42,
        telemetryId: "anon-1",
      });
      expect(read(path.join(settings, "preferences.json"))).toEqual({
        agentCompletionNotifications: "always",
        defaultModelURI: "instrument/auto",
        developerMode: true,
        theme: "dark",
      });
      expect(read(path.join(settings, "state.json"))).toEqual({
        hasCompletedProviderSetup: true,
      });
      expect(fs.readdirSync(settings).toSorted()).toEqual(
        [
          "app-connections.json",
          "features.json",
          "preferences.json",
          "state.json",
          "window-state.json",
          ...(flavor === "dev"
            ? ["providers.json", "session-dev.json"]
            : ["providers.json.enc", "session.json.enc"]),
        ].toSorted(),
      );
      expect(
        fs.readFileSync(
          path.join(
            defaultWorkspacePath(userDataDir),
            ".instrument/app-session/Local Storage/leveldb/000003.log",
          ),
          "utf8",
        ),
      ).toBe("tabs");
      expect(
        fs.existsSync(
          path.join(
            defaultWorkspacePath(userDataDir),
            ".instrument/page-thumbnails/a.jpg",
          ),
        ),
      ).toBe(true);

      const root = fs.readdirSync(userDataDir).toSorted();
      expect(root).toEqual(
        [
          "Local Storage",
          "machine-preferences.json",
          "machine-state.json",
          "workspace",
        ].toSorted(),
      );
      expect(readWorkspaceIdentity(defaultWorkspacePath(userDataDir))).toEqual({
        color: "gray",
        createdBy: { kind: "person" },
        name: "Default",
        settingsVersion: 1,
      });
    },
  );

  it("does nothing on a second run", () => {
    seedLegacy("dev");
    migrateBoth();
    expect(migrateBoth()).toEqual([]);
  });

  it("never overwrites a store that is already in the workspace", () => {
    seedLegacy("dev");
    const settings = workspaceSettingsDirOf(defaultWorkspacePath(userDataDir));
    fs.mkdirSync(settings, { recursive: true });
    fs.writeFileSync(path.join(settings, "session-dev.json"), "newer");
    migrateBoth();
    expect(fs.readFileSync(path.join(settings, "session-dev.json"), "utf8")).toBe(
      "newer",
    );
  });

  it("leaves the legacy files for the default workspace when another opens first", () => {
    seedLegacy("dev");
    const other = path.join(userDataDir, "workspaces", "byok");
    migrateBoth({ id: "byok", isDefault: false, path: other, pinned: false });

    expect(fs.existsSync(path.join(userDataDir, "preferences.json"))).toBe(true);
    expect(fs.existsSync(path.join(userDataDir, "session-dev.json"))).toBe(true);
    expect(fs.existsSync(workspaceSettingsDirOf(other))).toBe(false);
    expect(readWorkspaceIdentity(other).settingsVersion).toBe(1);

    migrateBoth();
    expect(fs.existsSync(path.join(userDataDir, "preferences.json"))).toBe(false);
  });

  it("starts a fresh install with nothing to move", () => {
    expect(migrateBoth()).toEqual(["settings at version 1"]);
  });
});
