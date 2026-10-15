import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CHAT_FOLDER_NAMES } from "../constants";
import { AbsolutePathSchema, ChatDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { createBashEnv } from "./create-bash-env";
import { withShellOutputSink } from "./shell-commands/output-sink";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

/**
 * Adjacent native stages joined by OS pipes (`shell-commands/pipe-stage.ts`).
 * Each case runs streamed and, where the output has to match, again with
 * `INSTRUMENT_NATIVE_PIPES=0`, the buffered path every stage took before.
 * The uutils binaries are the ones Studio's postinstall vendors; a checkout
 * without them skips the cases that need them.
 */
const UUTILS_DIR = path.resolve(
  import.meta.dirname,
  "../../../../apps/studio/resources/uutils",
);
const vendored = existsSync(
  path.join(
    UUTILS_DIR,
    process.platform === "win32" ? "coreutils.exe" : "coreutils",
  ),
);

const sessionId = StoreId.newSessionId();
let tmpDir: string;
let chatRoot: string;
let chatId: ChatId;

async function run(command: string, signal = AbortSignal.timeout(30_000)) {
  const bash = await createBashEnv({ chatId, sessionId });
  return bash.exec(command, { signal });
}

async function buffered(command: string) {
  process.env.INSTRUMENT_NATIVE_PIPES = "0";
  try {
    return await run(command);
  } finally {
    delete process.env.INSTRUMENT_NATIVE_PIPES;
  }
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bash-native-pipes-"));
  chatRoot = path.join(tmpDir, "chats", "native-pipes");
  await fs.mkdir(path.join(chatRoot, CHAT_FOLDER_NAMES.private), {
    recursive: true,
  });
  const lines = Array.from(
    { length: 20_000 },
    (_, i) => `w${(i * 7919) % 997} ${i}`,
  );
  await fs.writeFile(path.join(chatRoot, "words.txt"), `${lines.join("\n")}\n`);
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot));
  const { uutilsDir: _, ...config } = getWorkspaceConfig();
  setWorkspaceConfig(
    vendored
      ? { ...config, uutilsDir: AbsolutePathSchema.parse(UUTILS_DIR) }
      : config,
  );
});

afterAll(async () => {
  const { uutilsDir: _, ...config } = getWorkspaceConfig();
  setWorkspaceConfig(config);
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe.runIf(vendored)("native pipelines", () => {
  it.each([
    "cut -d' ' -f1 words.txt | sort | uniq -c | sort -rn | head -3",
    "sort words.txt | uniq | wc -l",
    "seq 1 5 | tail -2; echo ${PIPESTATUS[@]}",
    "seq 3 | cat | wc -l",
    "seq 3 | while read x; do echo L$x; done | tail -1",
    "rg -c w1 words.txt | sort",
    "rg --files . 2>/dev/null | sort | head -3",
    "sort words.txt | uniq > uniq.txt; wc -l < uniq.txt",
    // A consumer that has to wait for its input: on Windows a program reading
    // the producer's pipe directly blocks on an overlapped handle and aborts.
    "node -e 'setTimeout(() => console.log(\"b\\na\"), 300)' | sort | uniq -c",
    "printf 'b\\na\\n' | sort | head -1",
  ])("prints what the buffered path prints: %s", async (command) => {
    const streamed = await run(command);
    expect(streamed).toMatchObject(await buffered(command));
  });

  it("ends an endless producer when its reader exits", async () => {
    const result = await run(
      "node -e 'setInterval(() => process.stdout.write(\"y\\n\".repeat(1000)), 1)' | head -3",
    );
    expect(result.stdout).toBe("y\ny\ny\n");
  });

  // On Windows, with no SIGPIPE, the producer reports the closed pipe itself;
  // it is told as POSIX would end it.
  it("ends a producer cut off by its reader with SIGPIPE's status, quietly", async () => {
    const result = await run(
      "set -o pipefail; seq 1 100000 | head -1; echo $? ${PIPESTATUS[@]}",
    );
    expect(result.stdout).toBe("1\n141 141 0\n");
    expect(result.stderr).toBe("");
  });

  it("reports each stage's status for PIPESTATUS and pipefail", async () => {
    const result = await run(
      "set -o pipefail; node -e 'process.exit(3)' | wc -l; echo $? ${PIPESTATUS[@]}",
    );
    expect(result.stdout).toMatch(/0\n3 3 0\n$/);
  });

  it("keeps every stage's stderr", async () => {
    const result = await run(
      "node -e 'console.error(\"one\"); console.log(1)' | node -e 'console.error(\"two\"); process.stdin.pipe(process.stdout)' | wc -l",
    );
    expect(result.stdout.trim()).toBe("1");
    expect(result.stderr).toContain("one\n");
    expect(result.stderr).toContain("two\n");
  });

  it("carries binary data between programs byte for byte", async () => {
    const bytes = [0, 255, 128, 10, 200, 13];
    const result = await run(
      `node -e 'process.stdout.write(Buffer.from([${bytes.join(", ")}]))' | sha256sum`,
    );
    expect(result.stdout).toBe(
      `${createHash("sha256").update(Buffer.from(bytes)).digest("hex")}  -\n`,
    );
  });

  it("streams only what the pipeline prints to a background run", async () => {
    const chunks: string[] = [];
    const result = await withShellOutputSink(
      (text) => {
        chunks.push(text);
      },
      () => run("seq 1 3 | sort -r"),
    );
    expect(result.stdout).toBe("3\n2\n1\n");
    expect(chunks.join("")).toBe("3\n2\n1\n");
  });

  /** A node program that records its pid in `name` and then runs until killed. */
  const lingers = (name: string) =>
    `node -e 'require("fs").writeFileSync("${name}", String(process.pid)); setInterval(() => console.log(1), 50)'`;

  async function alive(name: string) {
    const pid = Number(await fs.readFile(path.join(chatRoot, name), "utf8"));
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  async function abortedUnderSink(command: string) {
    const started = Date.now();
    await withShellOutputSink(
      () => {},
      () => run(command, AbortSignal.timeout(1500)),
    ).catch((error: unknown) => error);
    // The tree kill escalates to SIGKILL after a second.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return Date.now() - started;
  }

  it("stops every stage when a background run is aborted", async () => {
    const took = await abortedUnderSink(
      `${lingers("a.pid")} | ${lingers("b.pid")} | wc -l`,
    );
    expect(took).toBeLessThan(10_000);
    expect(await alive("a.pid")).toBe(false);
    expect(await alive("b.pid")).toBe(false);
  }, 20_000);

  it("stops xargs -P's programs when a background run is aborted", async () => {
    const took = await abortedUnderSink(
      `seq 1 2 | xargs -P 2 -I {} ${lingers("x{}.pid")}`,
    );
    expect(took).toBeLessThan(10_000);
    expect(await alive("x1.pid")).toBe(false);
    expect(await alive("x2.pid")).toBe(false);
  }, 20_000);
});
