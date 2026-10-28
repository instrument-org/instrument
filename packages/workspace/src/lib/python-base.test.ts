import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { pythonBaseText } from "../agents/instrument";
import { ChatIdSchema } from "../schemas/chat-id";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import {
  ensurePythonBase,
  linkPythonBase,
  PYTHON_BASE_PACKAGES,
  PYTHON_BASE_SPEC,
  pythonBaseDir,
  pythonBaseReady,
  refreshPythonBaseIfDue,
} from "./python-base";
import { workVenvDir } from "./uv";
import { runtimeLayout } from "./runtime-dir";
import { getWorkspaceConfig } from "./workspace-config";

vi.mock("execa");
vi.mock(import("./run-uv"), () => ({
  ensureManagedPython: vi.fn(() => Promise.resolve(undefined)),
}));

const DAY_MS = 24 * 60 * 60 * 1000;

const root = () => runtimeLayout(getWorkspaceConfig().runtimeDir).pythonBase;
const stateFile = () => path.join(root(), "state.json");

type State = {
  checkedAt?: number;
  failedAt?: number;
  set?: string;
  spec?: string;
};
const readState = (): State =>
  JSON.parse(readFileSync(stateFile(), "utf8")) as State;
const writeState = (state: State) => {
  writeFileSync(stateFile(), JSON.stringify(state));
};
const sets = () =>
  readdirSync(root())
    .filter((entry) => /^[0-9a-f]{16}$/.test(entry))
    .toSorted();

/** What the faked uv and Python answer, changed per test. */
const fake = {
  install: 0,
  pins: "pandas==3.0.6\nnumpy==2.5.3\n",
  resolve: 0,
  smoke: 0,
};

type Call = { args: string[]; input?: string; env?: Record<string, string> };
const calls: Call[] = [];
const kinds = () =>
  calls.map(({ args }) =>
    args.includes("compile")
      ? "resolve"
      : args.includes("install")
        ? "install"
        : args.includes("find")
          ? "find"
          : "smoke",
  );

beforeEach(async () => {
  const { execa } = await import("execa");
  calls.length = 0;
  Object.assign(fake, {
    install: 0,
    pins: "pandas==3.0.6\nnumpy==2.5.3\n",
    resolve: 0,
    smoke: 0,
  });
  vi.mocked(execa).mockImplementation(((
    file: string,
    args: readonly string[],
    options: { env?: Record<string, string>; input?: string },
  ) => {
    const call = {
      args: [file, ...args],
      env: options.env,
      input: options.input,
    };
    calls.push(call);
    const reply = (exitCode: number, stdout = "") =>
      Promise.resolve({ all: exitCode ? "it failed" : "", exitCode, stdout });
    if (args.includes("compile")) {
      return reply(fake.resolve, fake.pins);
    }
    if (args.includes("install")) {
      const target = args[args.indexOf("--target") + 1];
      if (target && fake.install === 0) {
        mkdirSync(target, { recursive: true });
      }
      return reply(fake.install);
    }
    if (args.includes("find")) {
      return reply(0, "/managed/python3.12\n");
    }
    return reply(fake.smoke);
  }) as never);
  rmSync(root(), { force: true, recursive: true });
});

describe("the base package spec", () => {
  it("holds every package below its next major version", () => {
    expect(
      PYTHON_BASE_SPEC.filter(
        ({ requirement }) => !/^[\w-]+>=[\d.]+,<\d+$/.test(requirement),
      ),
    ).toEqual([]);
  });

  it("names to the agent only packages it asks for", () => {
    const names = new Set(
      PYTHON_BASE_SPEC.map(({ requirement }) => requirement.split(">=")[0]),
    );
    expect(
      PYTHON_BASE_PACKAGES.filter((name) => !names.has(name.toLowerCase())),
    ).toEqual([]);
  });
});

describe("ensurePythonBase", () => {
  it("resolves the spec a week back, installs it beside its name, imports every package, then points chats at it", async () => {
    expect(pythonBaseReady()).toBe(false);
    const before = Date.now();
    await expect(ensurePythonBase()).resolves.toBeUndefined();

    expect(kinds()).toEqual(["resolve", "install", "find", "smoke"]);
    const [resolve, install, , smoke] = calls;
    expect(resolve?.args.join(" ")).toMatch(
      /pip compile --python 3\.12 --no-build --no-header --no-annotate --quiet -$/,
    );
    expect(resolve?.input).toBe(
      `${PYTHON_BASE_SPEC.map(({ requirement }) => requirement).join("\n")}\n`,
    );
    const excludeNewer = Date.parse(resolve?.env?.UV_EXCLUDE_NEWER ?? "");
    expect(excludeNewer).toBeGreaterThanOrEqual(before - 7 * DAY_MS);
    expect(excludeNewer).toBeLessThanOrEqual(Date.now() - 7 * DAY_MS);
    expect(resolve?.env).toMatchObject({
      UV_CACHE_DIR: path.join(root(), "cache"),
      UV_PYTHON_DOWNLOADS: "never",
    });
    expect(install?.args.join(" ")).toMatch(
      /pip install --target \S+\.building-\S+ --python 3\.12 --no-build --compile-bytecode --requirement -$/,
    );
    expect(install?.input).toBe(fake.pins);
    expect(smoke?.args.at(-1)).toMatch(
      /^import sys; sys\.path\.append\(".+\.building-[^"]+"\); import bs4; import matplotlib; import numpy; import openpyxl; import pandas; import pdfplumber; import PIL\.Image; import pypdf; import pypdfium2; import docx; import pptx; import reportlab\.pdfgen\.canvas$/,
    );

    expect(pythonBaseReady()).toBe(true);
    expect(sets()).toEqual([path.basename(pythonBaseDir() ?? "")]);
    expect(readState().checkedAt).toBeGreaterThanOrEqual(before);

    // Checked within the week: the next launch does nothing.
    calls.length = 0;
    await expect(ensurePythonBase()).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("keeps only the current set at launch", async () => {
    await ensurePythonBase();
    const current = path.basename(pythonBaseDir() ?? "");
    mkdirSync(path.join(root(), "0123456789abcdef"));
    mkdirSync(path.join(root(), ".0123456789abcdef.building-999999999-x"));
    await ensurePythonBase();
    expect(readdirSync(root()).toSorted()).toEqual([current, "state.json"]);
  });
});

describe("refreshPythonBaseIfDue", () => {
  async function installFirstSet() {
    await ensurePythonBase();
    calls.length = 0;
    return pythonBaseDir() ?? "";
  }

  async function refreshAged(days = 8) {
    const state = readState();
    writeState({ ...state, checkedAt: Date.now() - days * DAY_MS });
    const { checkedAt, failedAt } = readState();
    refreshPythonBaseIfDue();
    // The refresh writes the state file from a promise of its own, so the
    // wait is on a real write landing. A second, which is what the default
    // gives it, is not enough of one on a machine running the whole suite at
    // once.
    await vi.waitFor(
      () => {
        const next = readState();
        expect(next.checkedAt !== checkedAt || next.failedAt !== failedAt).toBe(
          true,
        );
      },
      { timeout: 10_000 },
    );
  }

  it("does nothing within a week of the last check", async () => {
    await installFirstSet();
    writeState({ ...readState(), checkedAt: Date.now() - 6 * DAY_MS });
    refreshPythonBaseIfDue();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toEqual([]);
  });

  it("only records the check when the resolve names the same versions", async () => {
    const first = await installFirstSet();
    await refreshAged();
    expect(kinds()).toEqual(["resolve"]);
    expect(pythonBaseDir()).toBe(first);
    expect(Date.now() - (readState().checkedAt ?? 0)).toBeLessThan(60_000);
  });

  it("switches to a changed set, keeps the one it replaced, and removes any older", async () => {
    const chatId = createMockChatConfig(
      ChatIdSchema.parse("python-base-switch"),
    );
    const pth = path.join(
      process.platform === "win32"
        ? path.join(workVenvDir(chatId), "Lib", "site-packages")
        : path.join(workVenvDir(chatId), "lib", "python3.12", "site-packages"),
      "_instrument_python_base.pth",
    );
    mkdirSync(path.dirname(pth), { recursive: true });
    const first = await installFirstSet();
    await linkPythonBase(workVenvDir(chatId));
    expect(readFileSync(pth, "utf8")).toBe(`${first}\n`);

    fake.pins = "pandas==3.0.7\nnumpy==2.5.3\n";
    await refreshAged();
    expect(kinds()).toEqual(["resolve", "install", "find", "smoke"]);
    const second = pythonBaseDir() ?? "";
    expect(second).not.toBe(first);
    // A script started before the switch still has its set.
    expect(sets()).toEqual(
      [path.basename(first), path.basename(second)].toSorted(),
    );
    // The chat's next command points it at the new one.
    await linkPythonBase(workVenvDir(chatId));
    expect(readFileSync(pth, "utf8")).toBe(`${second}\n`);

    fake.pins = "pandas==3.0.8\nnumpy==2.5.3\n";
    await refreshAged();
    const third = pythonBaseDir() ?? "";
    expect(sets()).toEqual(
      [path.basename(second), path.basename(third)].toSorted(),
    );
  });

  it("keeps the current set when the new one fails to import", async () => {
    const first = await installFirstSet();
    fake.pins = "pandas==3.0.7\nnumpy==2.5.3\n";
    fake.smoke = 1;
    await refreshAged();
    expect(kinds()).toEqual(["resolve", "install", "find", "smoke"]);
    expect(pythonBaseDir()).toBe(first);
    expect(sets()).toEqual([path.basename(first)]);
    expect(
      readdirSync(root()).filter((entry) => entry.includes(".building-")),
    ).toEqual([]);
    expect(readState().failedAt).toBeDefined();

    // The failure waits out the week like a check that passed.
    calls.length = 0;
    refreshPythonBaseIfDue();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toEqual([]);
  });

  it("keeps the current set offline, and tries again a week on", async () => {
    const first = await installFirstSet();
    fake.resolve = 1;
    await refreshAged();
    expect(kinds()).toEqual(["resolve"]);
    expect(pythonBaseDir()).toBe(first);
    const { failedAt } = readState();

    calls.length = 0;
    refreshPythonBaseIfDue();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toEqual([]);

    fake.resolve = 0;
    writeState({ ...readState(), failedAt: (failedAt ?? 0) - 8 * DAY_MS });
    await refreshAged();
    expect(readState().failedAt).toBeUndefined();
  });

  it("checks at once when a release changed the spec, using the old set meanwhile", async () => {
    const first = await installFirstSet();
    writeState({ ...readState(), spec: "an-older-spec" });
    expect(pythonBaseDir()).toBe(first);
    await refreshAged(1);
    expect(kinds()).toEqual(["resolve"]);
    expect(readState().spec).not.toBe("an-older-spec");
  });

  it("leaves the check to another process already making one", async () => {
    await installFirstSet();
    writeFileSync(path.join(root(), "refresh.lock"), String(process.ppid));
    writeState({ ...readState(), checkedAt: 0 });
    refreshPythonBaseIfDue();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toEqual([]);
  });
});

describe("linkPythonBase", () => {
  it("names the base in the chat's virtualenv once it is installed", async () => {
    const chatId = createMockChatConfig(ChatIdSchema.parse("python-base"));
    const sitePackages =
      process.platform === "win32"
        ? path.join(workVenvDir(chatId), "Lib", "site-packages")
        : path.join(workVenvDir(chatId), "lib", "python3.12", "site-packages");
    mkdirSync(sitePackages, { recursive: true });
    const pth = path.join(sitePackages, "_instrument_python_base.pth");

    rmSync(pth, { force: true });
    await linkPythonBase(workVenvDir(chatId));
    expect(existsSync(pth)).toBe(false);
    expect(pythonBaseText()).toBeUndefined();

    await ensurePythonBase();
    await linkPythonBase(workVenvDir(chatId));
    expect(readFileSync(pth, "utf8")).toBe(`${pythonBaseDir() ?? ""}\n`);
    expect(pythonBaseText()).toMatchInlineSnapshot(
      `"\`python\` already has pandas, numpy, matplotlib, openpyxl, pypdf, pdfplumber, pypdfium2, Pillow, python-docx, python-pptx, reportlab, and beautifulsoup4 installed, so import them without a \`pip install\`; install only what else a script needs."`,
    );
  });

  it.skipIf(process.platform === "win32")(
    "replaces a link at its .pth rather than writing through it",
    async () => {
      const chatId = createMockChatConfig(
        ChatIdSchema.parse("python-base-link"),
      );
      const sitePackages = path.join(
        workVenvDir(chatId),
        "lib",
        "python3.12",
        "site-packages",
      );
      mkdirSync(sitePackages, { recursive: true });
      const target = path.join(workVenvDir(chatId), "someone-elses-file");
      writeFileSync(target, "theirs\n");
      const pth = path.join(sitePackages, "_instrument_python_base.pth");
      rmSync(pth, { force: true });
      symlinkSync(target, pth);
      await ensurePythonBase();
      await linkPythonBase(workVenvDir(chatId));
      expect(readFileSync(target, "utf8")).toBe("theirs\n");
      expect(lstatSync(pth).isSymbolicLink()).toBe(false);
      expect(readFileSync(pth, "utf8")).toBe(`${pythonBaseDir() ?? ""}\n`);
    },
  );
});
