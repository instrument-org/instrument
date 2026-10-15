import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { pythonBaseText } from "../agents/instrument";
import { ChatIdSchema } from "../schemas/chat-id";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import { wrapNativeCommand } from "./native-sandbox";
import {
  ensurePythonBase,
  linkPythonBase,
  PYTHON_BASE_PACKAGES,
  pythonBaseDir,
  pythonBaseReady,
} from "./python-base";
import { PYTHON_BASE_REQUIREMENTS } from "./python-base-requirements";
import { chatVenvDir } from "./uv";
import { getWorkspaceConfig } from "./workspace-config";

vi.mock("execa");
vi.mock(import("./run-uv"), () => ({
  ensureManagedPython: vi.fn(() => Promise.resolve(undefined)),
}));
vi.mock(import("./native-sandbox"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, wrapNativeCommand: vi.fn(actual.wrapNativeCommand) };
});

const pins = [...PYTHON_BASE_REQUIREMENTS.matchAll(/^[\w.-]+==\S+/gm)].map(
  ([pin]) => pin,
);

describe("the base package list", () => {
  it("installs what python-base/uv.lock locks, no more and no less", () => {
    const lock = readFileSync(
      fileURLToPath(new URL("../../python-base/uv.lock", import.meta.url)),
      "utf8",
    );
    const locked = [
      ...lock.matchAll(/^name = "([^"]+)"\nversion = "([^"]+)"/gm),
    ]
      .map((match) => match.slice(1).join("=="))
      .filter((pin) => !pin.startsWith("instrument-python-base=="));
    expect(pins.toSorted()).toEqual(locked.toSorted());
    // Every one pinned to wheels by hash, which is how they are installed.
    expect(
      PYTHON_BASE_REQUIREMENTS.split(/^(?=\S)/m).filter(
        (entry) => !entry.includes("--hash=sha256:"),
      ),
    ).toEqual([]);
  });

  it("names to the agent only packages it installs", () => {
    const names = new Set(pins.map((pin) => pin.split("==")[0]));
    expect(
      PYTHON_BASE_PACKAGES.filter((name) => !names.has(name.toLowerCase())),
    ).toEqual([]);
  });
});

describe("ensurePythonBase", () => {
  it("installs the locked wheels by hash as the app, into a folder renamed into place", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockImplementation(((
      _file: string,
      args: readonly string[],
    ) => {
      const target = args[args.indexOf("--target") + 1];
      if (target) {
        mkdirSync(target, { recursive: true });
      }
      return Promise.resolve({ all: "", exitCode: 0 });
    }) as never);

    rmSync(pythonBaseDir(), { force: true, recursive: true });
    expect(pythonBaseReady()).toBe(false);
    await expect(ensurePythonBase()).resolves.toBeUndefined();
    expect(pythonBaseReady()).toBe(true);
    await expect(ensurePythonBase()).resolves.toBeUndefined();
    expect(execa).toHaveBeenCalledTimes(1);

    const [file, args, options] = (vi.mocked(execa).mock.lastCall ??
      []) as unknown as [
      string?,
      string[]?,
      { env?: Record<string, string>; input?: string }?,
    ];
    expect([file, ...(args ?? [])].join(" ")).toMatch(
      /pip install --target \S+ --python 3\.12 --require-hashes --no-build --compile-bytecode --requirement -$/,
    );
    expect(options?.input).toBe(PYTHON_BASE_REQUIREMENTS);
    expect(wrapNativeCommand).not.toHaveBeenCalled();
    expect(options?.env).toMatchObject({
      UV_CACHE_DIR: path.join(path.dirname(pythonBaseDir()), "cache"),
      UV_PYTHON_DOWNLOADS: "never",
    });
    expect(options?.env).not.toHaveProperty("UV_EXCLUDE_NEWER");
  });
});

describe("linkPythonBase", () => {
  it("names the base in the chat's virtualenv once it is installed, and follows it when it moves", async () => {
    const chatId = createMockChatConfig(ChatIdSchema.parse("python-base"));
    const sitePackages =
      process.platform === "win32"
        ? path.join(chatVenvDir(chatId), "Lib", "site-packages")
        : path.join(chatVenvDir(chatId), "lib", "python3.12", "site-packages");
    mkdirSync(sitePackages, { recursive: true });
    const pth = path.join(sitePackages, "_instrument_python_base.pth");

    rmSync(pythonBaseDir(), { force: true, recursive: true });
    rmSync(pth, { force: true });
    await linkPythonBase(chatId);
    expect(existsSync(pth)).toBe(false);
    expect(pythonBaseText()).toBeUndefined();

    mkdirSync(pythonBaseDir(), { recursive: true });
    await linkPythonBase(chatId);
    expect(readFileSync(pth, "utf8")).toBe(`${pythonBaseDir()}\n`);
    expect(pythonBaseText()).toMatchInlineSnapshot(
      `"\`python\` already has pandas, numpy, matplotlib, openpyxl, pypdf, pdfplumber, pypdfium2, Pillow, python-docx, python-pptx, reportlab, and beautifulsoup4 installed, so import them without a \`pip install\`; install only what else a script needs."`,
    );

    const { writeFileSync } = await import("node:fs");
    writeFileSync(pth, "/an/older/base\n");
    await linkPythonBase(chatId);
    expect(readFileSync(pth, "utf8")).toBe(`${pythonBaseDir()}\n`);
    expect(path.dirname(pythonBaseDir())).toBe(
      path.join(getWorkspaceConfig().uvDataDir, "python-base"),
    );
  });
});
