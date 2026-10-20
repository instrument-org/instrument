import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SKILLS_FOLDER_NAME } from "../constants";
import { type ChatId } from "../schemas/chat-id";
import { ChatDirSchema, WorkspaceDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { createBashEnv } from "./create-bash-env";
import {
  beginSetupChangeTracking,
  consumeSetupChanges,
} from "./setup-changes";
import { withTurnContext } from "./turn-context";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

/**
 * What a program the agent ran changed in the person's setup, read off the
 * folders around the call (`setup-snapshot.ts`), since its writes never pass
 * through the agent's own filesystem.
 */
const sessionId = StoreId.newSessionId();

let tmpDir: string;
let binDir: string;
let skillsDir: string;
let chatId: ChatId;
let originalPath: string | undefined;

async function changesOf(command: string) {
  const turn = { id: chatId, sessionId };
  const bash = await createBashEnv({ chatId, sessionId });
  beginSetupChangeTracking(turn);
  const result = await withTurnContext(turn, () =>
    bash.exec(command, { signal: AbortSignal.timeout(30_000) }),
  );
  expect(result.stderr).toBe("");
  return consumeSetupChanges(turn);
}

beforeAll(async () => {
  tmpDir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "bash-setup-changes-")),
  );
  binDir = path.join(tmpDir, "bin");
  skillsDir = path.join(tmpDir, SKILLS_FOLDER_NAME);
  const chatRoot = path.join(tmpDir, "chats", "setup-changes");
  await fs.mkdir(chatRoot, { recursive: true });
  await fs.mkdir(binDir);
  await fs.mkdir(path.join(skillsDir, "tidy"), { recursive: true });
  await fs.writeFile(path.join(skillsDir, "tidy", "SKILL.md"), "tidy\n");
  // A program the shell does not know, so the write is the program's own.
  await fs.writeFile(
    path.join(binDir, "write-skill"),
    `#!/bin/sh\nmkdir -p "$1" && printf 'brief\\n' > "$1/SKILL.md"\n`,
    { mode: 0o755 },
  );
  originalPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(tmpDir),
  });
});

afterAll(async () => {
  process.env.PATH = originalPath;
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe.skipIf(process.platform === "win32")(
  "setup changes from programs",
  () => {
    it("credits the turn with a skill a program wrote", async () => {
      await expect(
        changesOf(`write-skill ${path.join(skillsDir, "brief")}`),
      ).resolves.toEqual([{ change: "added", kind: "skill", name: "brief" }]);
    });

    it("leaves a change made between calls to whoever made it", async () => {
      await fs.writeFile(path.join(skillsDir, "tidy", "run.sh"), "echo\n");
      // The program ran, so the folders were read around it, and its own
      // write was outside them.
      await expect(changesOf("write-skill drafts")).resolves.toEqual([]);
    });
  },
);
