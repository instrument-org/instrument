import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
import { createBashEnv } from "./create-bash-env";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { shellPath } from "./workspace-fs-layout";

/**
 * The one agent's shell walks the home folder at the chat's budget and its
 * own folder at a task's (`walk-budget.ts`): a `find` over home stops with a
 * pointer to `rg`, and the same walk over a folder of its own finishes.
 */
const sessionId = StoreId.newSessionId();

/** More entries than the chat's 20,000-entry budget. */
const WIDE_FILES = 21_000;

let tmpDir: string;
let chatId: ChatId;

function shell() {
  return createBashEnv({
    folders: {
      Home: {
        access: "read-only",
        id: MountedFolder.IdSchema.parse("home-id"),
        path: ChatDirSchema.parse(path.join(tmpDir, "Home")),
      },
    },
    sessionId,
    chatId,
  });
}

async function run(command: string) {
  const bash = await shell();
  return bash.exec(command, { signal: AbortSignal.timeout(60_000) });
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bash-home-walk-"));
  const home = path.join(tmpDir, "Home");
  const chatRoot = path.join(home, "workspace", "tasks", "walker");
  const wide = path.join(home, "wide");
  await fs.mkdir(path.join(chatRoot, "work", "wide"), { recursive: true });
  await fs.mkdir(wide, { recursive: true });
  // In batches: Windows runs out of file handles opening them all at once.
  for (let start = 0; start < WIDE_FILES; start += 1000) {
    await Promise.all(
      Array.from({ length: Math.min(1000, WIDE_FILES - start) }, (_, i) =>
        Promise.all([
          fs.writeFile(path.join(wide, `f${start + i}`), ""),
          fs.writeFile(
            path.join(chatRoot, "work", "wide", `f${start + i}`),
            "",
          ),
        ]),
      ),
    );
  }
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot));
  // The home folder holds this computer's folder for the app, which is what
  // marks it as home.
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    userDataDir: AbsolutePathSchema.parse(path.join(home, "app-data")),
    rootDir: WorkspaceDirSchema.parse(path.join(home, "workspace")),
  });
}, 60_000);

afterAll(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

// A walk of 20,000 entries reads each folder once, so the time here is the
// disk's rather than the shell's: generous for a slow or shared one.
describe("walks over the home folder", { timeout: 20_000 }, () => {
  it("stop at the home folder's budget, pointing at rg", async () => {
    const result = await run(
      `find ${shellPath(path.join(tmpDir, "Home"))} -name nothing-here`,
    );

    expect(result.exitCode).toBe(1);
    // just-bash redacts host paths in a thrown error, so the folder is
    // named `<path>`.
    expect(result.stderr).toContain("stopped walking");
    expect(result.stderr).toContain("after 20,000 entries");
    expect(result.stderr).toContain("rg --files");
  });

  it("leave the working folder at the sandbox's budget", async () => {
    const result = await run("find work -type f | wc -l");

    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(String(WIDE_FILES));
  });

  it("start over with each call into the same shell", async () => {
    const bash = await shell();
    const first = await bash.exec(
      `find ${shellPath(path.join(tmpDir, "Home", "wide"))} -name f1`,
    );
    expect(first.stderr).toContain("stopped walking");

    const next = await bash.exec(`ls ${shellPath(path.join(tmpDir, "Home"))}`);
    expect(next.stdout).toContain("wide");
  });
});
