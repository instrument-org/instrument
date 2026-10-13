import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import { wrapNativeCommand } from "./native-sandbox";
import { ensureManagedPython, runUvCommand } from "./run-uv";
import { workDir } from "./work-dir";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

vi.mock("execa");
vi.mock(import("./native-sandbox"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, wrapNativeCommand: vi.fn(actual.wrapNativeCommand) };
});

describe("runUvCommand", () => {
  it("returns a spawn diagnostic when uv is unavailable", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: undefined,
      shortMessage: "Command failed with ENOENT: uv --version",
      stdout: "",
    } as never);

    const chatId = createMockChatConfig(ChatIdSchema.parse("missing-uv"));
    const result = await runUvCommand({ args: ["--version"], chatId });

    expect(result).toMatchObject({
      combined: "Command failed with ENOENT: uv --version",
      exitCode: 1,
    });
  });

  it("says which Python there is when the chat's uv wants another", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "error: No interpreter found for Python 3.11 in managed installations",
      exitCode: 2,
      stdout: "",
    } as never);

    const chatId = createMockChatConfig(ChatIdSchema.parse("other-python"));
    const result = await runUvCommand({
      args: ["venv", "--python", "3.11"],
      chatId,
    });

    expect(result.combined).toContain("Only Python 3.12 is available");
  });

  it("holds uv to the chat's reach", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 0,
      stdout: "",
    } as never);
    const chatId = createMockChatConfig(ChatIdSchema.parse("uv-reach"));
    const config = getWorkspaceConfig();
    setWorkspaceConfig({ ...config, nativeSandbox: true });
    try {
      await runUvCommand({ args: ["pip", "list"], chatId });
    } finally {
      setWorkspaceConfig(config);
    }
    const reach = vi.mocked(wrapNativeCommand).mock.lastCall?.[2];
    expect(reach?.readWrite).toContain(workDir(chatId));
  });
});

describe("ensureManagedPython", () => {
  it("installs the managed Python as the app, again after a failure, then not again", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockClear();
    vi.mocked(wrapNativeCommand).mockClear();
    vi.mocked(execa)
      .mockResolvedValueOnce({ all: "offline", exitCode: 2 } as never)
      .mockResolvedValueOnce({ all: "", exitCode: 0 } as never);

    await expect(ensureManagedPython()).resolves.toEqual({
      exitCode: 2,
      output: "offline",
    });
    await expect(ensureManagedPython()).resolves.toBeUndefined();
    await expect(ensureManagedPython()).resolves.toBeUndefined();

    expect(execa).toHaveBeenCalledTimes(2);
    const [file, args, options] = vi.mocked(execa).mock.lastCall ?? [];
    expect([file, ...(args ?? [])].join(" ")).toMatch(
      /python install --no-bin --no-registry 3\.12$/,
    );
    // Outside any chat's reach, with downloads on for this one install.
    expect(wrapNativeCommand).not.toHaveBeenCalled();
    expect(options?.env).toMatchObject({
      UV_PYTHON_DOWNLOADS: "automatic",
      UV_PYTHON_INSTALL_DIR: path.join(
        getWorkspaceConfig().uvDataDir,
        "python",
      ),
    });
  });
});
