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
 * Guards the record and command limits `createBashEnv` raises above
 * just-bash's defaults, which stop `awk`, `cut`, `sed`, `seq` and a shell
 * loop at 100,000 lines or iterations and `grep` and `jq` at 1,000,000 lines
 * or values: a CSV export or a log routinely holds more. And the `stdin
 * bytes` part of the local just-bash patch (vercel-labs/just-bash#573):
 * `sha256sum`, `gzip` and `base64` copy stdin into a typed array with a loop
 * rather than `Uint8Array.from`, which ends the process past a few hundred MB.
 */
const sessionId = StoreId.newSessionId();
const LINES = 300_000;

let tmpDir: string;
let chatRoot: string;
let chatId: ChatId;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bash-large-input-"));
  chatRoot = path.join(tmpDir, "tasks", "test");
  await fs.mkdir(path.join(chatRoot, "work"), { recursive: true });
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot));
});

afterEach(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("large inputs", () => {
  it.each([
    [
      "awk",
      `seq 1 ${LINES} | awk '{ s += $1 } END { print s, NR }'`,
      `${(LINES * (LINES + 1)) / 2} ${LINES}`,
    ],
    ["cut", `seq 1 ${LINES} | cut -c1 | wc -l`, `${LINES}`],
    ["sed", `seq 1 ${LINES} | sed ':a;N;$!ba;s/\\n/ /g' | wc -w`, `${LINES}`],
    [
      "shell loop",
      `n=0; for i in $(seq 1 ${LINES}); do n=$((n + 1)); done; echo $n`,
      `${LINES}`,
    ],
    ["jq", `jq -n '[range(1200000)] | length'`, "1200000"],
  ])(
    "%s gets through every line",
    async (_name, command, expected) => {
      const bash = await createBashEnv({ sessionId, chatId });
      const result = await bash.exec(command, {
        signal: AbortSignal.timeout(60_000),
      });

      expect(result.stderr).toBe("");
      expect(result.stdout.trim()).toBe(expected);
      expect(result.exitCode).toBe(0);
    },
    60_000,
  );

  it("reads tens of megabytes of binary stdin byte for byte", async () => {
    const bytes = Buffer.alloc(40 * 1024 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 131 + 7) & 255;
    await fs.writeFile(path.join(chatRoot, "work", "big.bin"), bytes);
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
