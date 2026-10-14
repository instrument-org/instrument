import { describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import { workVenvDir } from "./uv";
import { ensureVenv, pythonToRun, venvToInstallInto } from "./venv";

vi.mock(import("node:fs"), () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));
vi.mock(import("./run-uv"));

describe("ensureVenv", () => {
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

    await expect(
      ensureVenv({ chatId, venv: workVenvDir(chatId) }),
    ).resolves.toBeUndefined();
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

    await expect(
      ensureVenv({ chatId, venv: workVenvDir(chatId) }),
    ).resolves.toEqual({
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

    await expect(
      ensureVenv({ chatId, venv: workVenvDir(chatId) }),
    ).resolves.toBeUndefined();
    expect(runUvCommand).toHaveBeenCalledTimes(1);
    // `--clear` is what lets uv replace the unusable venv rather than refuse.
    expect(vi.mocked(runUvCommand).mock.calls[0]?.[0].args).toContain(
      "--clear",
    );
  });

  it("recreates a venv whose base Python is gone", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    const { runUvCommand } = await import("./run-uv");
    vi.mocked(runUvCommand).mockClear();
    // The interpreter link and pyvenv.cfg are there; the Python it names is not.
    vi.mocked(existsSync).mockReturnValueOnce(true).mockReturnValueOnce(true);
    vi.mocked(readFileSync).mockReturnValueOnce(
      "home = /gone/python/cpython-3.12-macos-aarch64-none/bin\nimplementation = CPython\n",
    );
    vi.mocked(runUvCommand).mockResolvedValueOnce({
      combined: "",
      exitCode: 0,
      stdout: "",
    });

    const chatId = createMockChatConfig(ChatIdSchema.parse("moved-python"));

    await expect(
      ensureVenv({ chatId, venv: workVenvDir(chatId) }),
    ).resolves.toBeUndefined();
    expect(vi.mocked(existsSync).mock.lastCall?.[0]).toBe(
      "/gone/python/cpython-3.12-macos-aarch64-none/bin",
    );
    expect(vi.mocked(runUvCommand).mock.calls[0]?.[0].args).toContain(
      "--clear",
    );
  });

  it("keeps a venv whose base Python is there", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    const { runUvCommand } = await import("./run-uv");
    vi.mocked(runUvCommand).mockClear();
    vi.mocked(existsSync)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true);
    vi.mocked(readFileSync).mockReturnValueOnce("home = /runtime/python/bin\n");

    const chatId = createMockChatConfig(ChatIdSchema.parse("usable-venv"));

    await expect(
      ensureVenv({ chatId, venv: workVenvDir(chatId) }),
    ).resolves.toBeUndefined();
    expect(runUvCommand).not.toHaveBeenCalled();
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
    const first = ensureVenv({
      chatId,
      signal: firstSignal.signal,
      venv: workVenvDir(chatId),
    });
    const second = ensureVenv({
      chatId,
      signal: secondSignal.signal,
      venv: workVenvDir(chatId),
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

describe("venvToInstallInto", () => {
  it("makes the venv at the root of the work folder where none is near", async () => {
    const { runUvCommand } = await import("./run-uv");
    vi.mocked(runUvCommand).mockReset();
    vi.mocked(runUvCommand).mockResolvedValueOnce({
      combined: "",
      exitCode: 0,
      stdout: "",
    });

    const chatId = createMockChatConfig(ChatIdSchema.parse("first-install"));

    await expect(
      venvToInstallInto({
        chatId,
        cwd: "/tmp/workspace-machine/work/first-install/job",
      }),
    ).resolves.toEqual({ venv: workVenvDir(chatId) });
    expect(vi.mocked(runUvCommand).mock.calls[0]?.[0]).toMatchObject({
      args: ["venv", "--clear", "--python", "3.12", workVenvDir(chatId)],
      cwd: "/tmp/workspace-machine/work/first-install",
    });
  });
});

describe("pythonToRun", () => {
  it("runs the managed Python's own interpreter, and makes no venv, where none is near", async () => {
    const { managedPythonInterpreter, runUvCommand } = await import("./run-uv");
    vi.mocked(runUvCommand).mockReset();
    vi.mocked(managedPythonInterpreter).mockResolvedValueOnce({
      path: "/runtime/python/cpython-3.12/bin/python3.12",
    });

    const chatId = createMockChatConfig(ChatIdSchema.parse("no-venv"));

    await expect(
      pythonToRun({ chatId, cwd: "/tmp/workspace-machine/work/no-venv" }),
    ).resolves.toEqual({
      python: "/runtime/python/cpython-3.12/bin/python3.12",
      venv: undefined,
    });
    expect(runUvCommand).not.toHaveBeenCalled();
  });
});
