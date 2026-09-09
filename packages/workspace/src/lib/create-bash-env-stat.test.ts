import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TaskDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { createBashEnv } from "./create-bash-env";

/**
 * Guards the local patch to just-bash's `stat`, carried until the upstream fix
 * is released: every `-c` directive it did not implement came back as its own
 * source text at exit 0, so `stat -c '%Y'` printed `%Y` and the agent read that
 * as output. The whole timestamp family was in that set, which is the half of
 * the command an agent asking about a file actually wants.
 */
const model = createMockAIGatewayModel();
const sessionId = StoreId.newSessionId();

let tmpDir: string;
let taskId: TaskId;

async function run(command: string) {
  const bash = await createBashEnv({ sessionId, taskId });
  return bash.exec(command, { signal: AbortSignal.timeout(30_000) });
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stat-directives-"));
  const taskRoot = path.join(tmpDir, "tasks", "test");
  await fs.mkdir(path.join(taskRoot, "work"), { recursive: true });
  await fs.writeFile(path.join(taskRoot, "work", "note.md"), "# notes\n");
  taskId = createMockTaskConfigForDir(TaskDirSchema.parse(taskRoot), { model });
});

afterEach(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("stat -c format directives", () => {
  it("reports the modification time the default output shows", async () => {
    const epoch = await run("stat -c '%Y' work/note.md");
    const plain = await run("stat work/note.md");

    expect(epoch.stdout).toMatch(/^\d+\n$/);
    expect(epoch.exitCode).toBe(0);
    const modify = /Modify: (\S+)\n/.exec(plain.stdout)?.[1];
    expect(Math.floor(new Date(modify ?? "").getTime() / 1000)).toBe(
      Number(epoch.stdout.trim()),
    );
  });

  it("renders %y as a wall clock with an offset", async () => {
    const result = await run("stat -c '%y' work/note.md");

    expect(result.stdout).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{9} [+-]\d{4}\n$/,
    );
    expect(result.exitCode).toBe(0);
  });

  it("shows the timestamp in $TZ", async () => {
    const result = await run(
      "export TZ=America/New_York && stat -c '%y' work/note.md",
    );

    expect(result.stdout).toMatch(/ -0[45]00\n$/);
    expect(result.exitCode).toBe(0);
  });

  it("prints permission bits, a literal percent, and ? for the rest", async () => {
    const result = await run(
      "stat -c 'mode=%a pct=%% unknown=%q pad=[%6s]' work/note.md",
    );

    expect(result.stdout).toBe("mode=644 pct=% unknown=? pad=[     8]\n");
    expect(result.exitCode).toBe(0);
  });
});
