import { call } from "@orpc/server";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { rememberLoadedSkill } from "../../lib/loaded-skill";
import { getWorkspaceConfig } from "../../lib/workspace-config";
import { shellPath } from "../../lib/workspace-fs-layout";
import { ChatDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { createMockChatConfigForDir } from "../../test/helpers/mock-chat-config";
import { type WorkspaceRPCContext } from "../base";
import { debug } from "./debug";

const sessionId = StoreId.newSessionId();

let tmpDir: string;
let chatId: ReturnType<typeof createMockChatConfigForDir>;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "run-bash-route-"));
  const chatRoot = path.join(tmpDir, "tasks", "test");
  await fs.mkdir(path.join(chatRoot, "work"), { recursive: true });
  await fs.mkdir(path.join(chatRoot, ".instrument"), { recursive: true });
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot));
});

afterAll(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

function createContext(): WorkspaceRPCContext {
  return {
    workspaceConfig: getWorkspaceConfig(),
    // runBash never reads the actor ref, so the cast spares the test booting
    // a workspace machine it would not use.
    workspaceRef: undefined as unknown as WorkspaceRPCContext["workspaceRef"],
  };
}

describe("workspace.debug.runBash", () => {
  it("runs a command with no timeoutMs and reports both streams", async () => {
    const result = await call(
      debug.runBash,
      { command: "echo out; echo err >&2", sessionId, chatId },
      { context: createContext() },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("out\n");
    expect(result.stderr).toBe("err\n");
  });

  it("names the skill the session loaded last, as the agent's shell does", async () => {
    const skillDir = path.join(tmpDir, "skills", "pdf");
    rememberLoadedSkill(sessionId, skillDir);
    const result = await call(
      debug.runBash,
      { command: 'printf %s "$INSTRUMENT_SKILL_DIR"', sessionId, chatId },
      { context: createContext() },
    );

    expect(result.stdout).toBe(shellPath(skillDir));
  });

  // The real callers never abort the oRPC signal, so the route's own timeout
  // is the only thing standing between a hung command and just-bash's
  // one-hour execution deadline.
  it("bounds a hung command at timeoutMs", async () => {
    const startedAt = performance.now();
    const result = await call(
      debug.runBash,
      { command: "sleep 30", sessionId, chatId, timeoutMs: 500 },
      { context: createContext() },
    );

    expect(performance.now() - startedAt).toBeLessThan(4000);
    expect(result.exitCode).not.toBe(0);
  });
});
