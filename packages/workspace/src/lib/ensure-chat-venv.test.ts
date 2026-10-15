import { describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import { ensureChatVenv } from "./ensure-chat-venv";

vi.mock(import("node:fs"), () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
}));
vi.mock(import("./run-uv"));
vi.mock(import("./python-base"));

describe("ensureChatVenv", () => {
  it("has the app install the managed Python before the chat's uv makes the venv", async () => {
    const { ensureManagedPython, runUvCommand } = await import("./run-uv");
    vi.mocked(ensureManagedPython).mockClear();
    vi.mocked(runUvCommand).mockClear();
    vi.mocked(runUvCommand).mockResolvedValueOnce({
      combined: "",
      exitCode: 0,
      stdout: "",
    });

    const chatId = createMockChatConfig(ChatIdSchema.parse("cold-python"));

    await expect(ensureChatVenv({ chatId })).resolves.toBeUndefined();
    expect(
      vi.mocked(ensureManagedPython).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(runUvCommand).mock.invocationCallOrder[0] ?? 0);
  });

  it("makes no venv when the managed Python could not be installed", async () => {
    const { ensureManagedPython, runUvCommand } = await import("./run-uv");
    vi.mocked(runUvCommand).mockClear();
    vi.mocked(ensureManagedPython).mockResolvedValueOnce({
      exitCode: 2,
      output: "download failed",
    });

    const chatId = createMockChatConfig(ChatIdSchema.parse("python-offline"));

    await expect(ensureChatVenv({ chatId })).resolves.toEqual({
      exitCode: 2,
      output: "download failed",
    });
    expect(runUvCommand).not.toHaveBeenCalled();
  });

  it("recreates a venv when its interpreter lacks venv metadata", async () => {
    const { existsSync } = await import("node:fs");
    const { runUvCommand } = await import("./run-uv");
    vi.mocked(existsSync).mockReturnValueOnce(true).mockReturnValueOnce(false);
    vi.mocked(runUvCommand).mockResolvedValueOnce({
      combined: "",
      exitCode: 0,
      stdout: "",
    });

    const chatId = createMockChatConfig(ChatIdSchema.parse("incomplete-venv"));

    await expect(ensureChatVenv({ chatId })).resolves.toBeUndefined();
    expect(runUvCommand).toHaveBeenCalledTimes(1);
    // `--clear` is what lets uv replace the unusable venv rather than refuse.
    expect(vi.mocked(runUvCommand).mock.calls[0]?.[0].args).toContain(
      "--clear",
    );
  });

  it("lets one caller cancel without cancelling shared venv creation", async () => {
    const { runUvCommand } = await import("./run-uv");
    let complete: (() => void) | undefined;
    vi.mocked(runUvCommand).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = () => {
            resolve({ combined: "", exitCode: 0, stdout: "" });
          };
        }),
    );

    const chatId = createMockChatConfig(ChatIdSchema.parse("venv-race"));
    const firstSignal = new AbortController();
    const secondSignal = new AbortController();
    const first = ensureChatVenv({
      signal: firstSignal.signal,
      chatId,
    });
    const second = ensureChatVenv({
      signal: secondSignal.signal,
      chatId,
    });

    await vi.waitFor(() => {
      expect(runUvCommand).toHaveBeenCalledTimes(1);
    });
    const firstCall = vi.mocked(runUvCommand).mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(firstCall?.[0].signal).toBeUndefined();

    firstSignal.abort();
    await expect(first).resolves.toEqual({
      exitCode: 1,
      output: "Python environment setup was cancelled.",
    });

    expect(complete).toBeDefined();
    complete?.();

    await expect(second).resolves.toBeUndefined();
  });
});
