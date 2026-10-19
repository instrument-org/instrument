import { execaSync } from "execa";
import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
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
import { createUvCommand, createUvxCommand } from "./uv";
import { chatLayout } from "../../test/helpers/chat-layout";

const mockCtx = createCommandContext({
  cwd: "/",
  env: new Map<string, string>(),
  fs: new InMemoryFs(),
  stdin: EMPTY_BYTES,
});

describe("createUvCommand", () => {
  const chatId = createMockChatConfigForDir(
    `${MOCK_WORKSPACE_DIRS.chats}/uv-denylist`,
  );

  it("blocks `uv self update`", async () => {
    const result = await createUvCommand(chatId, chatLayout(chatId)).execute(
      ["self", "update"],
      mockCtx,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("'uv self update' is not allowed");
  });
});

describe.skipIf(process.platform === "win32")("createUvxCommand", () => {
  it("runs the app's uv as `uv tool run`", async () => {
    // A uv that prints what it was asked, standing in for the bundled one.
    const stub = path.join(mkdtempSync(path.join(tmpdir(), "uvx-")), "uv");
    writeFileSync(stub, '#!/bin/sh\necho "$@"\n');
    chmodSync(stub, 0o755);
    const chatId = createMockChatConfigForDir(
      `${MOCK_WORKSPACE_DIRS.chats}/uvx`,
    );
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      uvBinPath: AbsolutePathSchema.parse(stub),
    });
    const result = await createUvxCommand(chatId).execute(
      ["--from", "cowsay", "cowsay", "-t", "hi"],
      mockCtx,
    );
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "tool run --from cowsay cowsay -t hi\n",
    });
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
    const chatId = createMockChatConfigForDir(chatDir);
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      uvBinPath: AbsolutePathSchema.parse(uvBin),
      runtimeDir: AbsolutePathSchema.parse(
        mkdtempSync(path.join(tmpdir(), "runtime-")),
      ),
    });

    const install = await createPipCommand(chatId, chatLayout(chatId)).execute(
      ["install", "cowsay"],
      mockCtx,
    );
    expect(install.exitCode).toBe(0);

    const run = await createPythonCommand(chatId, chatLayout(chatId)).execute(
      ["-c", "import cowsay; print('ok')"],
      mockCtx,
    );
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("ok");
  }, 120_000);
});
