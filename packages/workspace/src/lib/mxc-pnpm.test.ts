import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { AbsolutePathSchema, ChatDirSchema } from "../schemas/paths";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { createBashEnv } from "./create-bash-env";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

/**
 * pnpm in a chat's shell with MXC holding its native commands, on Windows
 * only (INSTRUMENT_TEST_MXC_EXEC, unless INSTRUMENT_MXC=0, in the interactive
 * session, as `mxc-shell.test.ts`). MXC refuses a program it holds the
 * links an install makes, so a registry install runs its install step
 * outside and its install scripts inside (`pnpm-outside.ts`). Installs from
 * the npm registry, so it needs the network.
 */
const held =
  process.platform === "win32" &&
  process.env.INSTRUMENT_TEST_MXC_EXEC !== undefined &&
  process.env.INSTRUMENT_MXC !== "0";

/** The pnpm the app ships, as its JS entry. */
const PNPM_BIN = path.join(
  path.dirname(
    createRequire(
      path.resolve(import.meta.dirname, "../../../../apps/studio/package.json"),
    ).resolve("pnpm"),
  ),
  "bin",
  "pnpm.mjs",
);

const sessionId = StoreId.newSessionId();
let tmpDir: string;
let chatId: ChatId;

async function run(command: string) {
  const bash = await createBashEnv({ chatId, sessionId });
  const result = await bash.exec(command, {
    signal: AbortSignal.timeout(300_000),
  });
  // What each step printed, for reading a run on the host.
  console.log(
    `$ ${command}\n[exit ${result.exitCode}]\n${result.stdout}${result.stderr}`,
  );
  return result;
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mxc-pnpm-"));
  const chatRoot = path.join(tmpDir, "chats", "mxc");
  await fs.mkdir(chatRoot, { recursive: true });
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    // Electron runs pnpm as Node in the app; node itself does here.
    pnpmBinPath: AbsolutePathSchema.parse(PNPM_BIN),
  });
});

afterAll(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe.runIf(held)("pnpm in a chat's shell under MXC", () => {
  it("installs a registry package that node then loads", async () => {
    const added = await run("pnpm add is-odd");
    expect(added.exitCode).toBe(0);
    const loaded = await run(`node -e "console.log(require('is-odd')(3))"`);
    expect(loaded).toMatchObject({ exitCode: 0, stdout: "true\n" });
  }, 300_000);

  it("runs esbuild's install script in the sandbox once approved", async () => {
    const added = await run("pnpm add esbuild");
    expect(added.exitCode).toBe(0);
    expect(added.stdout).toContain("Ignored build scripts: esbuild");
    const approved = await run("pnpm approve-builds esbuild");
    expect(approved.exitCode).toBe(0);
    expect(approved.stdout).toContain("postinstall");
    const version = await run("pnpm exec esbuild --version");
    expect(version).toMatchObject({ exitCode: 0 });
    expect(version.stdout).toMatch(/^\d+\.\d+\.\d+\s*$/);
  }, 300_000);

  it("adds a later package outside again, from the same store", async () => {
    const added = await run("pnpm add ms@2");
    expect(added.exitCode).toBe(0);
    const loaded = await run(`node -e "console.log(require('ms')(1000))"`);
    expect(loaded).toMatchObject({ exitCode: 0, stdout: "1s\n" });
  }, 300_000);

  it("runs an approved install script right after the install, in the sandbox", async () => {
    const result = await run(
      `mkdir -p built && cd built && printf 'allowBuilds:\\n  esbuild: true\\n' > pnpm-workspace.yaml && pnpm add esbuild && pnpm exec esbuild --version`,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("postinstall: Done");
    expect(result.stdout).not.toContain("Ignored build scripts");
  }, 300_000);

  it("leaves a file: dependency to the sandbox", async () => {
    const result = await run(
      `mkdir -p lib app && echo '{"name":"lib","version":"1.0.0"}' > lib/package.json && cd app && pnpm add file:../lib`,
    );
    // Inside the sandbox, which refuses the links it needs, and says so.
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "Only installs of npm registry packages work",
    );
  }, 300_000);
});
