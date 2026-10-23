import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChatIdSchema, type ChatId } from "../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { chatFor } from "../test/helpers/chat-record";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import { createBashEnv } from "./create-bash-env";
import { workDir } from "./work-dir";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { shellPath } from "./workspace-fs-layout";
import { workspaceLayout } from "./workspace-layout";

/**
 * A chat whose rules hold a folder spelled without a drive (`/tmp`), which
 * the path schema takes on every platform and a workspace config or a
 * hand-edited settings file can carry. The rules resolve every path they
 * compare, and Windows resolves one that names no drive against the working
 * directory, which just-bash blocks while a command runs: with the rules
 * resolved no earlier than the first path they were asked about, every
 * builtin reading or writing a file died on `process.cwd is blocked during
 * script execution` -- a redirect, `cat`, and the write-back that ends
 * `sqlite3`.
 */
const model = createMockAIGatewayModel();

let tmpDir: string;
let chatId: ChatId;
let devicesDir: string;

async function run(command: string) {
  const bash = await createBashEnv({
    sessionId: StoreId.newSessionId(),
    chatId,
  });
  return bash.exec(command, { signal: AbortSignal.timeout(60_000) });
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "no-drive-rule-"));
  // The record folder in a workspace, and the work folder in this computer's
  // folder for it, as the app lays them out.
  const rootDir = path.join(tmpDir, "workspace");
  const machineDir = path.join(tmpDir, "machine");
  createMockChatConfig(ChatIdSchema.parse("seed"), { model, unplaced: true });
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(workspaceLayout(rootDir).chatsDir),
    rootDir: WorkspaceDirSchema.parse(rootDir),
    tempFolders: [AbsolutePathSchema.parse("/tmp")],
    workFoldersDir: AbsolutePathSchema.parse(path.join(machineDir, "work")),
    workspaceMachineDir: AbsolutePathSchema.parse(machineDir),
  });
  chatId = await chatFor();
  await fs.mkdir(path.join(workDir(chatId), "work"), { recursive: true });
  // Every chat's records are open to reading; the rest of the app's own
  // data in the workspace is not.
  devicesDir = workspaceLayout(rootDir).devicesDir;
  await fs.mkdir(path.join(devicesDir, "this-device"), { recursive: true });
  await fs.writeFile(
    path.join(devicesDir, "this-device", "bookmarks.jsonl"),
    "needle sentinel\n",
  );
});

afterEach(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

// A path that names no drive is a Windows idea; everywhere else an absolute
// path resolves without reading the working directory.
describe.skipIf(process.platform !== "win32")("a rule without a drive", () => {
  it("writes a file in the work folder and finds it again with rg", async () => {
    const result = await run(
      "echo 'needle in work' > work/haystack.txt && rg -n needle work/",
    );

    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("needle in work");
    expect(result.exitCode).toBe(0);
  });

  it("leaves the app's own data in the workspace out of a search of it", async () => {
    const result = await run(`rg -uu needle '${shellPath(devicesDir)}'`);

    expect(result.stdout).not.toContain("sentinel");
    expect(result.exitCode).not.toBe(0);
  });

  it("writes a database, reads it back, and writes it again", async () => {
    const made = await run(
      "sqlite3 work/t.db 'create table t(a); insert into t values(41); select a+1 from t;'",
    );
    expect(made.stderr).toBe("");
    expect(made.stdout.trim()).toBe("42");

    const again = await run(
      "sqlite3 work/t.db 'insert into t values(1); select count(*) from t;'",
    );
    expect(again.stderr).toBe("");
    expect(again.stdout.trim()).toBe("2");
  });
});
