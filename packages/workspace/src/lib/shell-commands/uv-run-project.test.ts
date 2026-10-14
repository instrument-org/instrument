import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { AbsolutePathSchema } from "../../schemas/paths";
import { chatLayout } from "../../test/helpers/chat-layout";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { createUvCommand } from "./uv";

vi.mock("execa");
vi.mock(import("../run-uv"), async (importOriginal) => ({
  ...(await importOriginal()),
  ensureManagedPython: vi.fn(() => Promise.resolve(undefined)),
}));
vi.mock(import("../skill-environments"), async (importOriginal) => ({
  ...(await importOriginal()),
  skillEnvironmentHolding: vi.fn(),
}));

describe("uv run --project <skill>", () => {
  const chatId = createMockChatConfig(ChatIdSchema.parse("uv-project"));
  const layout = chatLayout(chatId);
  const ctx = createCommandContext({
    cwd: layout.chat.shellRoot,
    env: new Map<string, string>(),
    fs: new InMemoryFs(),
    stdin: EMPTY_BYTES,
  });
  const skillEnv = AbsolutePathSchema.parse("/runtime/environments/0123");
  const workVenv = AbsolutePathSchema.parse("/work/.venv");

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("runs in the skill's environment as it stands, with the .venv behind it", async () => {
    const { execa } = await import("execa");
    const { pythonLayerEnv, skillEnvironmentHolding } =
      await import("../skill-environments");
    vi.mocked(skillEnvironmentHolding).mockResolvedValueOnce({
      layer: workVenv,
      venv: skillEnv,
    });
    vi.mocked(execa).mockResolvedValueOnce({ all: "", exitCode: 0 } as never);

    await createUvCommand(chatId, layout).execute(
      ["run", "--project", "../skills/pdf", "python", "x.py"],
      ctx,
    );

    expect(vi.mocked(skillEnvironmentHolding)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        hostPath: path.resolve(layout.chat.hostRoot, "../skills/pdf"),
      }),
    );
    expect(vi.mocked(execa)).toHaveBeenLastCalledWith(
      expect.anything(),
      ["run", "--project", "../skills/pdf", "python", "x.py"],
      expect.objectContaining({
        env: expect.objectContaining({
          ...pythonLayerEnv(workVenv, undefined),
          PATH: expect.stringMatching(/^\/runtime\/environments\/0123\/bin/),
          UV_NO_SYNC: "1",
          UV_PROJECT_ENVIRONMENT: skillEnv,
          VIRTUAL_ENV: skillEnv,
        }),
      }),
    );
  });

  it("asks nothing of the skills for a command that is not `run`", async () => {
    const { execa } = await import("execa");
    const { skillEnvironmentHolding } = await import("../skill-environments");
    vi.mocked(execa).mockResolvedValueOnce({ all: "", exitCode: 0 } as never);

    await createUvCommand(chatId, layout).execute(
      ["sync", "--project", "../skills/pdf"],
      ctx,
    );

    expect(vi.mocked(skillEnvironmentHolding)).not.toHaveBeenCalled();
  });
});
