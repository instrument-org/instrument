import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChatDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { createBashEnv } from "./create-bash-env";

/**
 * Guards the `process.env writes` part of the local just-bash patch
 * (vercel-labs/just-bash#598). While a command runs on this thread, the
 * shell's defense layer swaps `process.env` for a proxy, and unpatched,
 * assigning a variable that already exists from code outside the script
 * throws "'process.env' only accepts a configurable, writable, and enumerable
 * data descriptor". In the app the main-thread commands (`instrument`,
 * `agent-browser`, `jobs`, `fg`, `kill`) run here,
 * and the Agent SDK stamps its version into the environment on every
 * `query()`, so every Claude Code start in that window failed.
 */
const sessionId = StoreId.newSessionId();
const KEY = "INSTRUMENT_ENV_WRITE_TEST";

let tmpDir: string;
let chatId: ChatId;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bash-env-write-"));
  const chatRoot = path.join(tmpDir, "tasks", "test");
  await fs.mkdir(path.join(chatRoot, "work"), { recursive: true });
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot));
});

afterEach(async () => {
  delete process.env[KEY];
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("process.env while a command runs", () => {
  it("lets code outside the script assign a variable that already exists", async () => {
    process.env[KEY] = "before";
    const realEnv = process.env;
    const bash = await createBashEnv({ sessionId, chatId });
    const running = bash.exec("sleep 2", {
      signal: AbortSignal.timeout(30_000),
    });
    // The defense layer is up once `process.env` is its proxy.
    const deadline = Date.now() + 5000;
    while (process.env === realEnv && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const proxied = process.env !== realEnv;

    let error: unknown;
    try {
      process.env[KEY] = "after";
    } catch (caught) {
      error = caught;
    }
    await running;

    expect(proxied).toBe(true);
    expect(error).toBeUndefined();
    expect(process.env[KEY]).toBe("after");
  });
});
