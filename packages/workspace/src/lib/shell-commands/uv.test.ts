import { execaSync } from "execa";
import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { AbsolutePathSchema } from "../../schemas/paths";
import {
  createMockChatConfigForDir,
  MOCK_WORKSPACE_DIRS,
} from "../../test/helpers/mock-chat-config";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { createPipCommand } from "./pip";
import { createPythonCommand } from "./python";
import { createUvCommand } from "./uv";
import { taskLayout } from "../../test/helpers/task-layout";

const mockCtx = createCommandContext({
  cwd: "/",
  env: new Map<string, string>(),
  fs: new InMemoryFs(),
  stdin: EMPTY_BYTES,
});

describe("createUvCommand", () => {
  const taskId = createMockChatConfigForDir(
    `${MOCK_WORKSPACE_DIRS.chats}/uv-denylist`,
  );

  it("blocks `uv self update`", async () => {
    const result = await createUvCommand(taskId, taskLayout(taskId)).execute(
      ["self", "update"],
      mockCtx,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("'uv self update' is not allowed");
  });
});

// End-to-end proof that `pip install` and `python` share work/.venv. Gated on a
// real uv binary (RUN_UV_SMOKE=1 with uv on PATH or vendored) since it downloads
// a managed CPython and reaches the network.
function resolveUv(): string | undefined {
  const which = execaSync("which", ["uv"], { reject: false });
  if (which.exitCode === 0 && which.stdout.trim()) {
    return which.stdout.trim();
  }
  const vendored = path.resolve(
    import.meta.dirname,
    "../../../../../apps/studio/resources/uv/uv",
  );
  return existsSync(vendored) ? vendored : undefined;
}

const uvBin = resolveUv();
const runSmoke = process.env.RUN_UV_SMOKE === "1" && uvBin !== undefined;

describe.skipIf(!runSmoke)("uv python/pip integration", () => {
  it("installs a package with pip and imports it with python (shared venv)", async () => {
    // The dir basename must be a valid ChatId, so use a fixed name under a
    // random temp root.
    const chatDir = path.join(
      mkdtempSync(path.join(tmpdir(), "uv-smoke-")),
      "uvsmoke",
    );
    mkdirSync(path.join(chatDir, "work"), { recursive: true });
    const taskId = createMockChatConfigForDir(chatDir);
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      uvBinPath: AbsolutePathSchema.parse(uvBin),
      uvDataDir: AbsolutePathSchema.parse(
        mkdtempSync(path.join(tmpdir(), "uv-data-")),
      ),
    });

    const install = await createPipCommand(taskId, taskLayout(taskId)).execute(
      ["install", "cowsay"],
      mockCtx,
    );
    expect(install.exitCode).toBe(0);

    const run = await createPythonCommand(taskId, taskLayout(taskId)).execute(
      ["-c", "import cowsay; print('ok')"],
      mockCtx,
    );
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("ok");
  }, 120_000);
});
