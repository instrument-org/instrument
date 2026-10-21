import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { type ChatId } from "../schemas/chat-id";
import { MountedFolder } from "../schemas/mounted-folder";
import { ChatDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { createBashEnv } from "./create-bash-env";
import { shellPath } from "./workspace-fs-layout";

/**
 * A read inside a folder macOS guards (the Desktop here, under a home folder
 * made for the test) sets the app's own timer for macOS asking, while
 * just-bash keeps a running script from setting timers: the read must
 * answer as any other does.
 */
let tmpDir: string;
let desktop: string;
let chatId: ChatId;

beforeAll(async () => {
  tmpDir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "bash-macos-guarded-")),
  );
  desktop = path.join(tmpDir, "Desktop");
  await fs.mkdir(desktop, { recursive: true });
  await fs.writeFile(path.join(desktop, "notes.txt"), "hello");
  chatId = createMockChatConfigForDir(
    ChatDirSchema.parse(path.join(tmpDir, "chat")),
  );
});

afterAll(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe.runIf(process.platform === "darwin")("a folder macOS guards", () => {
  it("reads and lists inside it", async () => {
    vi.spyOn(os, "homedir").mockReturnValue(tmpDir);
    const bash = await createBashEnv({
      chatId,
      folders: {
        Desktop: {
          access: "read-only",
          id: MountedFolder.IdSchema.parse("desktop-id"),
          path: ChatDirSchema.parse(desktop),
        },
      },
      role: "chat",
      sessionId: StoreId.newSessionId(),
    });
    const shown = shellPath(desktop);

    const result = await bash.exec(`cat '${shown}/notes.txt'; ls '${shown}'`, {
      signal: AbortSignal.timeout(30_000),
    });

    expect(result).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout: "hellonotes.txt\n",
    });
  });
});
