import { existsSync, mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { execa } from "execa";
import { describe, expect, it } from "vitest";

import { ChatDirSchema } from "../../schemas/paths";
import {
  bwrapArgs,
  launchNative,
  seatbeltAvailable,
  wrapNativeCommand,
} from "../native-sandbox";
import { getWorkspaceConfig } from "../workspace-config";
import { buildWorkspaceFsLayout } from "../workspace-fs-layout";
import { nativeReachFor } from "./chat-rules";

const chatRoot = ChatDirSchema.parse(
  realpathSync(mkdtempSync(path.join(os.tmpdir(), "chat-rules-"))),
);
const reach = nativeReachFor(
  { home: os.homedir(), rules: [], withoutAsking: false },
  buildWorkspaceFsLayout({ chatHostRoot: chatRoot }),
);
const uvData = getWorkspaceConfig().uvDataDir;
const pythons = path.join(uvData, "python");

describe("nativeReachFor", () => {
  it("keeps the managed Pythons read-only, with the rest of uv's folder writable", () => {
    expect(reach.readOnly).toContain(pythons);
    expect(reach.readWrite).toContain(uvData);
  });

  it("binds the managed Pythons read-only over uv's folder under bubblewrap, made first if missing", () => {
    const args = bwrapArgs(reach).join(" ");
    expect(existsSync(pythons)).toBe(true);
    const [data, python] = [realpathSync(uvData), realpathSync(pythons)];
    expect(args).toContain(`--bind ${data} ${data}`);
    expect(args.indexOf(`--ro-bind ${python} ${python}`)).toBeGreaterThan(
      args.indexOf(`--bind ${data} ${data}`),
    );
  });
});

describe.runIf(seatbeltAvailable())("a chat's command on this Mac", () => {
  mkdirSync(pythons, { recursive: true });

  it.each([
    ["refuses a file in the managed Pythons", pythons, 1],
    ["writes uv's cache", path.join(uvData, "cache"), 0],
    ["writes the models' cache", path.join(uvData, "cache-home"), 0],
    ["writes matplotlib's folder", path.join(uvData, "matplotlib"), 0],
    ["writes the chat's own folder", chatRoot, 0],
  ])("%s", async (_name, folder, exitCode) => {
    const spawned = wrapNativeCommand(
      "/bin/sh",
      ["-c", `mkdir -p "${folder}" && echo x > "${folder}/planted"`],
      reach,
    );
    const launch = launchNative(spawned, { env: {} });
    const result = await execa(launch.file, launch.args, { reject: false });
    expect(result.exitCode === 0 ? 0 : 1).toBe(exitCode);
  });
});
