import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TaskDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { createBashEnv } from "./create-bash-env";

// The capabilities the sandbox advertises in its own tool description, each
// reached the way the agent reaches it. Every one of these runs through a
// vendored binary or a lazily loaded chunk, so the failure they guard against
// is not a wrong argument -- it is the command being gone, or dying on its
// first real use, while our argument-construction tests stay green.
const model = createMockAIGatewayModel();
const sessionId = StoreId.newSessionId();

let tmpDir: string;
let taskId: ReturnType<typeof createMockTaskConfigForDir>;

async function run(command: string) {
  const bash = await createBashEnv({ sessionId, taskId });
  return bash.exec(command, { signal: AbortSignal.timeout(60_000) });
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bash-capabilities-"));
  const taskRoot = path.join(tmpDir, "tasks", "test");
  await fs.mkdir(path.join(taskRoot, "work"), { recursive: true });
  await fs.mkdir(path.join(taskRoot, ".instrument"), { recursive: true });
  taskId = createMockTaskConfigForDir(TaskDirSchema.parse(taskRoot), { model });
});

afterAll(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("bash sandbox capabilities", () => {
  // Loads sql.js and its wasm through a worker resolved beside the bundle
  // entry, which is the part a repackaging can silently drop.
  it("queries a database with sqlite3", async () => {
    const result = await run(
      "sqlite3 work/t.db 'create table t(a); insert into t values(41); select a+1 from t;'",
    );

    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("42");
  });

  it("searches with the real ripgrep binary", async () => {
    const result = await run(
      "echo 'needle in work' > work/haystack.txt && rg -n needle work/",
    );

    expect(result.stdout).toContain("needle in work");
    expect(result.exitCode).toBe(0);
  });

  // ffmpeg and ffprobe are separate vendored binaries, and packaging prunes
  // the platforms it does not ship, so exercise both in one pass.
  it("writes a video with ffmpeg and reads it back with ffprobe", async () => {
    const encode = await run(
      "ffmpeg -loglevel error -f lavfi -i testsrc=size=64x64:duration=1 -pix_fmt yuv420p work/clip.mp4",
    );
    expect(encode.exitCode).toBe(0);

    const probe = await run(
      "ffprobe -v error -show_entries stream=width,height -of csv=p=0 work/clip.mp4",
    );

    expect(probe.stdout.trim()).toBe("64,64");
    expect(probe.exitCode).toBe(0);
  });

  it("runs git", async () => {
    const result = await run("git --version");

    expect(result.stdout).toMatch(/^git version \d+\./);
    expect(result.exitCode).toBe(0);
  });
});
