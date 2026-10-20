import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type ChatId } from "../schemas/chat-id";
import { AbsolutePathSchema, ChatDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { createBashEnv } from "./create-bash-env";
import {
  type CommandRun,
  CommandRuns,
  MAX_COMMAND_RUN_ROWS,
  withCommandRuns,
} from "./shell-commands/command-runs";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

/**
 * What a bash call records as having answered each command
 * (`shell-commands/command-runs.ts`). The uutils binaries are the ones
 * Studio's postinstall vendors; a checkout without them skips the cases that
 * need them.
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

const SCRIPT = [
  "sort a",
  "tr a b </dev/null",
  "cat a",
  "seq 3 | head -1",
  "xargs -P2 -n1 echo <<< 'x y'",
  "for i in 1 2 3; do wc -l a; done",
  "command -v sort",
].join("; ");

const sessionId = StoreId.newSessionId();
let tmpDir: string;
let chatId: ChatId;

function configure(config: { outside?: boolean; uutilsDir?: string }) {
  const {
    uutilsDir: _,
    uutilsOutsideSandbox: __,
    ...rest
  } = getWorkspaceConfig();
  setWorkspaceConfig({
    ...rest,
    ...(config.uutilsDir === undefined
      ? {}
      : { uutilsDir: AbsolutePathSchema.parse(config.uutilsDir) }),
    ...(config.outside === undefined
      ? {}
      : { uutilsOutsideSandbox: config.outside }),
  });
}

/**
 * The rows a script records, a program named by its file name alone and the
 * sandbox this platform holds it in as `<platform>`: Seatbelt on macOS,
 * bubblewrap on Linux, and none or MXC on Windows.
 */
async function runsOf(command: string) {
  const runs = new CommandRuns();
  const bash = await createBashEnv({ chatId, sessionId });
  const result = await withCommandRuns(runs, () =>
    bash.exec(command, { signal: AbortSignal.timeout(30_000) }),
  );
  expect(result.exitCode).toBe(0);
  return runs.rows().map((row) => ({
    ...row,
    ...(row.program === undefined
      ? {}
      : { program: path.basename(row.program, ".exe") }),
    ...(row.sandbox === undefined || row.sandbox === "skipped"
      ? {}
      : { sandbox: "<platform>" }),
  }));
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bash-command-runs-"));
  const chatRoot = path.join(tmpDir, "chats", "command-runs");
  await fs.mkdir(chatRoot, { recursive: true });
  await fs.writeFile(path.join(chatRoot, "a"), "b\na\n");
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot));
});

afterAll(async () => {
  configure({});
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("command runs", () => {
  it.skipIf(!vendored)(
    "records what answered each command, once per distinct run",
    async () => {
      configure({ outside: false, uutilsDir: UUTILS_DIR });
      expect(await runsOf(SCRIPT)).toMatchInlineSnapshot(`
        [
          {
            "count": 1,
            "name": "sort",
            "program": "coreutils",
            "sandbox": "<platform>",
            "source": "bundled",
          },
          {
            "count": 1,
            "name": "tr",
            "source": "builtin",
          },
          {
            "count": 1,
            "name": "cat",
            "source": "builtin",
          },
          {
            "count": 1,
            "name": "seq",
            "program": "coreutils",
            "sandbox": "<platform>",
            "source": "bundled",
          },
          {
            "count": 1,
            "name": "head",
            "program": "coreutils",
            "sandbox": "<platform>",
            "source": "bundled",
          },
          {
            "count": 1,
            "name": "xargs",
            "reason": "builtin-args",
            "source": "builtin",
          },
          {
            "count": 3,
            "name": "wc",
            "program": "coreutils",
            "sandbox": "<platform>",
            "source": "bundled",
          },
        ]
      `);
    },
  );

  it.skipIf(!vendored)(
    "records a uutils call the reviewed rules run outside the sandbox as skipped",
    async () => {
      configure({ outside: true, uutilsDir: UUTILS_DIR });
      expect(await runsOf("sort a; seq 2 | head -1")).toMatchInlineSnapshot(`
        [
          {
            "count": 1,
            "name": "sort",
            "program": "coreutils",
            "sandbox": "skipped",
            "source": "bundled",
          },
          {
            "count": 1,
            "name": "seq",
            "program": "coreutils",
            "sandbox": "skipped",
            "source": "bundled",
          },
          {
            "count": 1,
            "name": "head",
            "program": "coreutils",
            "sandbox": "skipped",
            "source": "bundled",
          },
        ]
      `);
    },
  );

  it("records just-bash's own commands as builtins without uutils", async () => {
    configure({});
    expect(await runsOf(SCRIPT)).toMatchInlineSnapshot(`
      [
        {
          "count": 1,
          "name": "sort",
          "source": "builtin",
        },
        {
          "count": 1,
          "name": "tr",
          "source": "builtin",
        },
        {
          "count": 1,
          "name": "cat",
          "source": "builtin",
        },
        {
          "count": 1,
          "name": "seq",
          "source": "builtin",
        },
        {
          "count": 1,
          "name": "head",
          "source": "builtin",
        },
        {
          "count": 1,
          "name": "xargs",
          "source": "builtin",
        },
        {
          "count": 3,
          "name": "wc",
          "source": "builtin",
        },
      ]
    `);
  });

  it.skipIf(process.platform === "win32")(
    "records the app's own commands and a program named by its path",
    async () => {
      configure({});
      const rows = await runsOf(
        "du -s . >/dev/null; which sort >/dev/null; env true; /bin/echo hi >/dev/null",
      );
      expect(rows).toMatchInlineSnapshot(`
        [
          {
            "count": 1,
            "name": "du",
            "source": "instrument",
          },
          {
            "count": 1,
            "name": "which",
            "source": "instrument",
          },
          {
            "count": 1,
            "name": "env",
            "source": "builtin",
          },
          {
            "count": 1,
            "name": "/bin/echo",
            "program": "echo",
            "sandbox": "<platform>",
            "source": "path",
          },
        ]
      `);
    },
  );
});

describe("CommandRuns", () => {
  it("keeps at most the cap of distinct rows, counting the ones it has", () => {
    const runs = new CommandRuns();
    for (let i = 0; i < MAX_COMMAND_RUN_ROWS + 5; i++) {
      runs.record({ name: `c${i}`, source: "builtin" });
    }
    runs.record({ name: "c0", source: "builtin" });
    const rows = runs.rows();
    expect(rows).toHaveLength(MAX_COMMAND_RUN_ROWS);
    expect(rows[0]).toEqual({ count: 2, name: "c0", source: "builtin" });
  });

  it("merges the worker's rows with this thread's", () => {
    const runs = new CommandRuns();
    runs.record({ name: "jobs", source: "instrument" });
    const remote: CommandRun[] = [
      { count: 3, name: "cat", source: "builtin" },
      { count: 1, name: "jobs", source: "instrument" },
    ];
    runs.setRemote(remote);
    expect(runs.rows()).toEqual([
      { count: 3, name: "cat", source: "builtin" },
      { count: 2, name: "jobs", source: "instrument" },
    ]);
  });
});
