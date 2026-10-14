import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { ChatIdSchema } from "../schemas/chat-id";
import { StoreId } from "../schemas/store-id";
import { chatFor } from "../test/helpers/chat-record";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { ensureWorkFolder, initializeChat } from "./initialize-chat";
import { chatDir } from "./record-folders";
import { workDir } from "./work-dir";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T[\d:.]+Z/g;

let rootDir: string;

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "initialize-chat-"));
  // The settings file is snapshotted whole, and it carries the activity stamp
  // a new task starts with.
});

afterEach(async () => {
  await fs.rm(rootDir, { force: true, recursive: true });
});

/**
 * A workspace of the test's own, with its machine folder beside it, as the
 * app keeps one outside the workspace.
 */
function useWorkspaceOfItsOwn() {
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatTemplateDir: AbsolutePathSchema.parse(
      path.resolve(import.meta.dirname, "../../templates/default"),
    ),
    chatsDir: AbsolutePathSchema.parse(
      path.join(rootDir, "workspace", "chats"),
    ),
    rootDir: WorkspaceDirSchema.parse(path.join(rootDir, "workspace")),
    workFoldersDir: AbsolutePathSchema.parse(
      path.join(rootDir, "machine", "work"),
    ),
    workspaceMachineDir: AbsolutePathSchema.parse(
      path.join(rootDir, "machine"),
    ),
  });
}

describe("initializeChat", () => {
  it("makes a chat's record folder, and no work folder until its agent needs one", async () => {
    const chatId = ChatIdSchema.parse("test-task");
    createMockChatConfigForDir(path.join(rootDir, "tasks", "unused"), {
      unplaced: true,
    });
    useWorkspaceOfItsOwn();

    const result = await initializeChat({
      chatId,
      initialSettings: {},
      sessionId: StoreId.SessionSchema.parse("ses_01M3AX9RF3C2E9RTATMB602W0B"),
      workspaceConfig: getWorkspaceConfig(),
    });

    expect(result.isOk()).toBe(true);
    expect(await listPaths(chatDir(chatId))).toMatchInlineSnapshot(`
      [
        "chat.db",
        "settings.json",
      ]
    `);
    await expect(fs.access(workDir(chatId))).rejects.toMatchObject({
      code: "ENOENT",
    });
    // Stamps normalized rather than frozen: faking the clock for a snapshot
    // leaves every real timer in the file faked too, which is a flake waiting
    // for the suite to run under load.
    const settings = await fs.readFile(
      path.join(chatDir(chatId), "settings.json"),
      "utf8",
    );
    expect(settings.replaceAll(ISO_TIMESTAMP, "<when>")).toMatchInlineSnapshot(`
      "{
        "chatSessionId": "ses_01M3AX9RF3C2E9RTATMB602W0B",
        "createdAt": "<when>",
        "createdWithAppVersion": "0.0.0-test",
        "lastActivityAt": "<when>"
      }"
    `);
  });
});

async function listPaths(dir: string) {
  const paths: string[] = [];

  async function walk(relativeDir: string) {
    const entries = await fs.readdir(path.join(dir, relativeDir), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      const relativePath = path.join(relativeDir, entry.name);
      paths.push(entry.isDirectory() ? `${relativePath}/` : relativePath);
      if (entry.isDirectory()) {
        await walk(relativePath);
      }
    }
  }

  await walk("");
  return paths.sort();
}

describe("ensureWorkFolder", () => {
  it("scaffolds a chat's work folder from the bundled default template, and leaves a scaffolded one alone", async () => {
    useWorkspaceOfItsOwn();
    // A chat as initializeChat leaves one: its records alone.
    const chatId = chatFor();
    expect(await listPaths(chatDir(chatId))).toEqual(["settings.json"]);

    await ensureWorkFolder(chatId, getWorkspaceConfig());
    expect(await listPaths(workDir(chatId))).toMatchInlineSnapshot(`
      [
        ".gitignore",
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "work/",
      ]
    `);
    expect(await listPaths(chatDir(chatId))).toEqual(["settings.json"]);
    await expect(
      fs.readFile(path.join(workDir(chatId), "package.json"), "utf8"),
    ).resolves.toContain('"name": "@instrument-org/chat"');
    // Snapshotted in full so the supply-chain settings a task installs under
    // stay visible: weakening the age gate or the build allowlist has to show
    // up as a diff here.
    await expect(
      fs.readFile(path.join(workDir(chatId), "pnpm-workspace.yaml"), "utf8"),
    ).resolves.toMatchInlineSnapshot(`
      "minimumReleaseAge: 10080
      # Declared empty so the key resolves here rather than from a task-local .npmrc,
      # a \`pnpm_config_*\` env var, or the host's global pnpm config, any of which
      # could otherwise punch per-package holes in the age gate above.
      minimumReleaseAgeExclude: []

      allowBuilds:
        sharp: true
      dlxCacheMaxAge: 259200 # 180 days in minutes, so npx/pnpx stay warm across tasks
      # The task root is both the workspace root and the only package anyone installs
      # into, so pnpm's "did you mean to add to the root?" guard has nothing to guard.
      # Without this, every \`pnpm add\` in a task fails until it is retried with \`-w\`.
      ignoreWorkspaceRootCheck: true
      # Loaded skills are copied in as their own packages so their declared
      # dependencies install into the skill's own folder rather than the task's.
      packages:
        - work/skills/*
        - work/skills/*/*
      # Unapproved build scripts are skipped with a warning instead of failing the
      # install, so a package the agent adds mid-task cannot dead-end it. The bash
      # tool turns that warning into instructions for extending allowBuilds.
      strictDepBuilds: false
      # The agent runs its dev server and other pnpm commands concurrently against a
      # shared store. pnpm 11 defaults this to "install", which makes every
      # \`pnpm run\`/\`pnpm exec\` verify deps and silently spawn a competing install;
      # those race and deadlock. Install only when the agent explicitly installs.
      verifyDepsBeforeRun: false
      updateNotifier: false
      "
    `);

    await fs.writeFile(
      path.join(workDir(chatId), "package.json"),
      '{"name":"mine"}',
    );
    await ensureWorkFolder(chatId, getWorkspaceConfig());
    await expect(
      fs.readFile(path.join(workDir(chatId), "package.json"), "utf8"),
    ).resolves.toBe('{"name":"mine"}');
  });
});
