import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { execa } from "execa";
import { describe, expect, it } from "vitest";

import { ChatDirSchema, WorkDirSchema } from "../../schemas/paths";
import {
  bwrapArgs,
  launchNative,
  seatbeltAvailable,
  wrapNativeCommand,
} from "../native-sandbox";
import { runtimeLayout } from "../runtime-dir";
import { getWorkspaceConfig } from "../workspace-config";
import { workspaceLayout } from "../workspace-layout";
import { buildWorkspaceFsLayout } from "../workspace-fs-layout";
import { nativeReachFor } from "./chat-rules";

const chatRoot = WorkDirSchema.parse(
  realpathSync(mkdtempSync(path.join(os.tmpdir(), "chat-rules-"))),
);
const reach = nativeReachFor(
  { home: os.homedir(), rules: [], dangerouslyAllowEveryFolder: false },
  buildWorkspaceFsLayout({ chatHostRoot: chatRoot }),
);
const runtimeDir = getWorkspaceConfig().runtimeDir;
const runtime = runtimeLayout(runtimeDir);
const inRuntime = (folders: readonly string[]) =>
  folders
    .filter((folder) => folder.startsWith(runtimeDir))
    .map((folder) => path.relative(runtimeDir, folder).replaceAll("\\", "/"));

describe("nativeReachFor", () => {
  it("opens the runtime caches and config, and the managed Pythons, skill environments, preload and bin links only for reading", () => {
    expect({
      readOnly: inRuntime(reach.readOnly),
      readWrite: inRuntime(reach.readWrite),
    }).toMatchInlineSnapshot(`
      {
        "readOnly": [
          "skills",
          "bin",
          "python",
          "environments",
          "preload",
          "python-base",
        ],
        "readWrite": [
          "caches",
          "config",
        ],
      }
    `);
  });

  it("binds the runtime caches and config read-write, made first if missing, and the managed Pythons and the preload read-only under bubblewrap", () => {
    mkdirSync(runtime.python, { recursive: true });
    mkdirSync(runtime.preload, { recursive: true });
    const args = bwrapArgs(reach).join(" ");
    expect(existsSync(runtime.caches)).toBe(true);
    expect(existsSync(runtime.config)).toBe(true);
    for (const folder of [runtime.caches, runtime.config]) {
      const real = realpathSync(folder);
      expect(args).toContain(`--bind ${real} ${real}`);
    }
    for (const folder of [runtime.python, runtime.preload]) {
      const real = realpathSync(folder);
      expect(args).toContain(`--ro-bind ${real} ${real}`);
    }
    expect(args).not.toContain(path.join(runtimeDir, "build"));
  });
});

describe.runIf(seatbeltAvailable())("a chat's command on this Mac", () => {
  mkdirSync(runtime.python, { recursive: true });
  mkdirSync(runtime.bin, { recursive: true });
  mkdirSync(runtime.preload, { recursive: true });

  it.each([
    ["refuses a file in the managed Pythons", runtime.python, 1],
    ["refuses a file among the bin links", runtime.bin, 1],
    ["refuses a file beside the preload", runtime.preload, 1],
    ["refuses a file in the build caches", runtime.buildCaches, 1],
    ["refuses a file in the build config", runtime.buildConfig, 1],
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
    const launch = launchNative(spawned, { env: {} });
    const result = await execa(launch.file, launch.args, { reject: false });
    expect(result.exitCode === 0 ? 0 : 1).toBe(exitCode);
  });
});

// The chat's record folder sits in the workspace, which the app's own rules
// keep from the agent; what the person sent and the handoff notes are opened
// in it by the rules the profile is built from, and nothing else.
describe.runIf(seatbeltAvailable())(
  "a chat's record folder on this Mac",
  () => {
    const { rootDir, workspaceMachineDir } = getWorkspaceConfig();
    const name = path.basename(chatRoot);
    const record = path.join(workspaceLayout(rootDir).chatsDir, name);
    const work = path.join(workspaceMachineDir, "work", name);
    mkdirSync(path.join(record, "attachments"), { recursive: true });
    mkdirSync(work, { recursive: true });
    writeFileSync(path.join(record, "attachments", "sent.txt"), "sent");
    writeFileSync(path.join(record, "settings.json"), "{}");
    const layout = buildWorkspaceFsLayout({
      chatHostRoot: WorkDirSchema.parse(work),
      recordHostRoot: ChatDirSchema.parse(record),
    });
    const recordReach = nativeReachFor(layout.rules, layout);

    it.each([
      ["reads what the person sent", `cat "${record}/attachments/sent.txt"`, 0],
      ["refuses the settings", `cat "${record}/settings.json"`, 1],
      [
        "refuses a change to what the person sent",
        `echo x > "${record}/attachments/planted"`,
        1,
      ],
      ["writes the handoff notes", `echo x > "${record}/handoff-notes.md"`, 0],
      [
        "refuses a file planted in the record folder",
        `echo x > "${record}/planted"`,
        1,
      ],
      ["writes the work folder", `echo x > "${work}/planted"`, 0],
    ])("%s", async (_name, command, exitCode) => {
      const spawned = wrapNativeCommand(
        "/bin/sh",
        ["-c", command],
        recordReach,
      );
      const result = await execa(
        spawned.file,
        launchNative(spawned, { env: {} }).args,
        { reject: false },
      );
      expect(result.exitCode === 0 ? 0 : 1).toBe(exitCode);
    });
  },
);
