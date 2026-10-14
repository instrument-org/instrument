import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type Worker } from "node:worker_threads";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MountedFolder } from "../schemas/mounted-folder";
import {
  AbsolutePathSchema,
  ChatDirSchema,
  WorkspaceDirSchema,
} from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { createTsxBashWorker } from "../test/helpers/tsx-bash-worker";
import { createRemoteBash, setBashWorkerFactory } from "./bash-worker/client";
import { type BashEnvOptions, createLocalBashEnv } from "./create-bash-env";
import { updatePermissionSettings } from "./permissions/rules";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

/**
 * A read the rules refuse says `Permission denied`, the way a builtin prints
 * the error's own code, on this thread and in the bash worker the app runs
 * the agent's shell in. A model told the file is missing gives up on it
 * instead of waiting on the card the refusal raised.
 */

// The worker compiles from source under tsx, which takes seconds the first
// time.
const WORKER_TIMEOUT_MS = 60_000;

const workers: Worker[] = [];
let tmpDir: string;
let docs: string;
let elsewhere: string;
let closed: string;
let chatId: ChatId;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "permission-denied-"));
  const chatRoot = path.join(tmpDir, "tasks", "test");
  docs = path.join(tmpDir, "Docs");
  elsewhere = path.join(tmpDir, "Elsewhere");
  closed = path.join(tmpDir, "Closed");
  await fs.mkdir(path.join(chatRoot, "work"), { recursive: true });
  await fs.mkdir(path.join(docs, "locked"), { recursive: true });
  await fs.writeFile(path.join(docs, "locked", "secret.txt"), "secret\n");
  await fs.mkdir(elsewhere);
  await fs.writeFile(path.join(elsewhere, "open.txt"), "open\n");
  await fs.mkdir(closed);
  await fs.mkdir(path.join(docs, "asks"));
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot));
  // Settings live in the workspace's machine folder, which the app hands the
  // bash worker with the rest of the config, so the worker's cases fail if
  // it reads them anywhere else. The mock chats share their workspace across
  // test files, so this file keeps its own.
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(path.join(tmpDir, "workspace")),
    workspaceMachineDir: AbsolutePathSchema.parse(path.join(tmpDir, "machine")),
  });
  await updatePermissionSettings((settings) => ({
    ...settings,
    folders: [
      {
        addedAt: new Date(),
        level: "never",
        path: AbsolutePathSchema.parse(path.join(docs, "locked")),
      },
      {
        addedAt: new Date(),
        level: "never",
        path: AbsolutePathSchema.parse(closed),
      },
      {
        addedAt: new Date(),
        level: "ask",
        path: AbsolutePathSchema.parse(path.join(docs, "asks")),
      },
    ],
  }));
  setBashWorkerFactory((workerOptions) => {
    const worker = createTsxBashWorker(workerOptions);
    workers.push(worker);
    return worker;
  });
});

afterAll(async () => {
  await Promise.all(workers.map((worker) => worker.terminate()));
  await fs.rm(tmpDir, { force: true, recursive: true });
});

function options(): BashEnvOptions {
  return {
    folders: {
      Docs: {
        access: "read-write",
        id: MountedFolder.IdSchema.parse("docs-id"),
        path: ChatDirSchema.parse(docs),
      },
    },
    sessionId: StoreId.newSessionId(),
    chatId,
  };
}

const shells = {
  "on this thread": () => createLocalBashEnv(options()),
  "in the bash worker": () => {
    const bashOptions = options();
    return Promise.resolve(
      createRemoteBash(bashOptions, () => createLocalBashEnv(bashOptions)),
    );
  },
};

afterAll(() => {
  // The worker's cases ran in one.
  expect(workers).toHaveLength(1);
});

describe.each(Object.entries(shells))(
  "a refused read %s",
  { timeout: WORKER_TIMEOUT_MS },
  (_where, shell) => {
    it("says Permission denied for a file and a folder the rules close", async () => {
      const bash = await shell();
      const result = await bash.exec(
        `cat ${docs}/locked/secret.txt; ls ${docs}/locked`,
      );
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(
        `cat: ${docs}/locked/secret.txt: Permission denied\n`,
      );
      expect(result.stderr).toContain(
        `ls: ${docs}/locked: Permission denied\n`,
      );
      expect(result.stderr).not.toContain("No such file or directory");
    });

    it("reads outside every mount where the rules allow, and says Permission denied where they close", async () => {
      const bash = await shell();
      const result = await bash.exec(`cat ${elsewhere}/open.txt; ls ${closed}`);
      expect(result.stdout).toBe("open\n");
      expect(result.stderr).toContain(`ls: ${closed}: Permission denied\n`);
    });

    it("raises a card for a folder a later command lists, and none for one a walk passes", async () => {
      const bash = await shell();
      const walked = await bash.exec(`find ${docs} -name x`);
      expect(walked.stderr).not.toContain("Waiting on the person");
      const listed = await bash.exec(`ls ${docs}; ls ${docs}/asks`);
      expect(listed.stderr).toContain(
        `Waiting on the person to allow ${path.join(docs, "asks")}.`,
      );
    });

    it("refuses the workspace's machine folder plainly, its folder rules with it", async () => {
      const bash = await shell();
      const result = await bash.exec(`cat ${tmpDir}/machine/permissions.json`);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Permission denied");
      expect(result.stderr).toContain("Instrument's own data");
      expect(result.stderr).not.toContain("Waiting on the person");
    });

    it("still says a missing file is missing", async () => {
      const bash = await shell();
      const result = await bash.exec(`cat ${docs}/missing.txt`);
      expect(result.stderr).toBe(
        `cat: ${docs}/missing.txt: No such file or directory\n`,
      );
    });
  },
);
