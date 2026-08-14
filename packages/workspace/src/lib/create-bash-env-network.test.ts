import dns from "node:dns/promises";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TaskDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { createBashEnv } from "./create-bash-env";

// `curl` is the only command that reaches the network through just-bash, and it
// runs under `denyPrivateRanges`, which routes every request through a private
// undici agent pinned to the address the preflight DNS check reviewed. That
// agent lives in just-bash's bundle, so no type or unit test on our side can
// tell whether it still constructs: just-bash 3.2.0 shipped a bundle where it
// could not, and every download in the sandbox failed until the patch in
// `patches/just-bash@3.2.0.patch`. Only a real request proves the path works.
const REACHABLE_HOST = "registry.npmjs.org";
const REACHABLE_URL = `https://${REACHABLE_HOST}/-/ping`;

// The one external name CI already depends on: if it cannot be reached, the
// install that produced this checkout could not have run either. Resolving it
// up front separates "the machine is offline" from "the sandbox cannot fetch",
// so a developer working on a plane sees a skip rather than a failure.
const online = await dns
  .lookup(REACHABLE_HOST)
  .then(() => true)
  .catch(() => false);

const model = createMockAIGatewayModel();
const sessionId = StoreId.newSessionId();

let tmpDir: string;
let taskId: ReturnType<typeof createMockTaskConfigForDir>;

async function run(command: string) {
  const bash = await createBashEnv({ sessionId, taskId });
  return bash.exec(command, { signal: AbortSignal.timeout(30_000) });
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bash-network-"));
  const taskRoot = path.join(tmpDir, "tasks", "test");
  await fs.mkdir(path.join(taskRoot, "work"), { recursive: true });
  await fs.mkdir(path.join(taskRoot, ".instrument"), { recursive: true });
  taskId = createMockTaskConfigForDir(TaskDirSchema.parse(taskRoot), { model });
});

afterAll(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("bash sandbox networking", () => {
  it.skipIf(!online)(
    "downloads a file with curl",
    async () => {
      const result = await run(
        `curl -sS -w '%{http_code}' -o work/ping.json ${REACHABLE_URL}`,
      );

      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("200");
      expect(result.exitCode).toBe(0);
    },
    30_000,
  );

  it.each([
    "http://127.0.0.1:9/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]:9/",
    "http://10.0.0.1/",
  ])("blocks %s", async (url) => {
    const result = await run(`curl -sS '${url}'`);

    expect(result.stderr).toContain("private/loopback IP address blocked");
    expect(result.exitCode).not.toBe(0);
  });
});
