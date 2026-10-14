import { existsSync, mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { execa } from "execa";
import { describe, expect, it } from "vitest";

import { ChatDirSchema } from "../../schemas/paths";
import {
  bwrapArgs,
  seatbeltAvailable,
  wrapNativeCommand,
} from "../native-sandbox";
import { runtimeLayout } from "../runtime-dir";
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
const runtimeDir = getWorkspaceConfig().runtimeDir;
const runtime = runtimeLayout(runtimeDir);
const inRuntime = (folders: readonly string[]) =>
  folders
    .filter((folder) => folder.startsWith(runtimeDir))
    .map((folder) => path.relative(runtimeDir, folder).replaceAll("\\", "/"));

describe("nativeReachFor", () => {
  it("opens the runtime caches and config, and the managed Pythons and bin links only for reading", () => {
    expect({
      readOnly: inRuntime(reach.readOnly),
      readWrite: inRuntime(reach.readWrite),
    }).toMatchInlineSnapshot(`
      {
        "readOnly": [
          "skills",
          "bin",
          "python",
        ],
        "readWrite": [
          "caches",
          "config",
        ],
      }
    `);
  });

  it("binds the runtime caches and config read-write, made first if missing, and the managed Pythons read-only under bubblewrap", () => {
    mkdirSync(runtime.python, { recursive: true });
    const args = bwrapArgs(reach).join(" ");
    expect(existsSync(runtime.caches)).toBe(true);
    expect(existsSync(runtime.config)).toBe(true);
    for (const folder of [runtime.caches, runtime.config]) {
      const real = realpathSync(folder);
      expect(args).toContain(`--bind ${real} ${real}`);
    }
    const python = realpathSync(runtime.python);
    expect(args).toContain(`--ro-bind ${python} ${python}`);
  });
});

describe.runIf(seatbeltAvailable())("a chat's command on this Mac", () => {
  mkdirSync(runtime.python, { recursive: true });
  mkdirSync(runtime.bin, { recursive: true });

  it.each([
    ["refuses a file in the managed Pythons", runtime.python, 1],
    ["refuses a file among the bin links", runtime.bin, 1],
    ["writes uv's cache", path.join(runtime.caches, "uv"), 0],
    ["writes the models' cache", path.join(runtime.caches, "huggingface"), 0],
    ["writes matplotlib's folder", path.join(runtime.caches, "matplotlib"), 0],
    ["writes a program's settings", path.join(runtime.config, "pnpm"), 0],
    ["writes the chat's own folder", chatRoot, 0],
  ])("%s", async (_name, folder, exitCode) => {
    const spawned = wrapNativeCommand(
      "/bin/sh",
      ["-c", `mkdir -p "${folder}" && echo x > "${folder}/planted"`],
      reach,
    );
    const result = await execa(spawned.file, spawned.args, { reject: false });
    expect(result.exitCode === 0 ? 0 : 1).toBe(exitCode);
  });
});
