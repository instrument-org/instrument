import { createHash } from "node:crypto";
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
 * Guards the `stdin bytes` part of the local just-bash patch, carried until
 * upstream releases the fix (vercel-labs/just-bash#573): `sha256sum`, `gzip`
 * and `base64` copy stdin into a typed array with a loop rather than
 * `Uint8Array.from`, which is 30 times slower and ends the process past a few
 * hundred MB.
 */
const sessionId = StoreId.newSessionId();

let tmpDir: string;
let taskRoot: string;
let chatId: ChatId;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bash-large-input-"));
  taskRoot = path.join(tmpDir, "tasks", "test");
  await fs.mkdir(path.join(taskRoot, "work"), { recursive: true });
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(taskRoot));
});

afterEach(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("large inputs", () => {
  it("reads tens of megabytes of binary stdin byte for byte", async () => {
    const bytes = Buffer.alloc(40 * 1024 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 131 + 7) & 255;
    await fs.writeFile(path.join(taskRoot, "work", "big.bin"), bytes);
    const expected = createHash("sha256").update(bytes).digest("hex");
    const bash = await createBashEnv({ sessionId, chatId });

    const result = await bash.exec(
      "sha256sum < work/big.bin; cat work/big.bin | gzip -c | gzip -dc | sha256sum",
      { signal: AbortSignal.timeout(60_000) },
    );

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`${expected}  -\n${expected}  -\n`);
  }, 60_000);
});
