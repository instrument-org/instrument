import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyShellPath,
  joinPaths,
  parseShellPath,
  readLoginShellPath,
  readSavedPath,
  savePath,
  SHELL_PATH_MARKER as M,
  shellPathReady,
  startLoginShellPath,
} from "./login-shell-path";

const posix = process.platform !== "win32";

let dir: string;
let launchedPath: string | undefined;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "login-shell-path-test-"));
  launchedPath = process.env.PATH;
});

afterEach(async () => {
  process.env.PATH = launchedPath;
  await fs.rm(dir, { force: true, recursive: true });
});

/** A stand-in login shell: ignores its arguments and runs `body`. */
async function fakeShell(body: string): Promise<string> {
  const file = path.join(dir, "shell");
  await fs.writeFile(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

describe("parseShellPath", () => {
  it.each([
    [
      "rc noise around the markers",
      `Welcome!\n${M}HOME=/home/sam\nPATH=/opt/homebrew/bin:/usr/bin\nX=1\n${M}bye\n`,
      "/opt/homebrew/bin:/usr/bin",
    ],
    ["colored output", `${M}\u001B[32mPATH=/a:/b\u001B[0m\n${M}`, "/a:/b"],
    ["a value with an equals sign", `${M}PATH=/a=b:/c\n${M}`, "/a=b:/c"],
    ["no PATH line", `${M}HOME=/home/sam\n${M}`, undefined],
    ["an empty PATH", `${M}PATH=\n${M}`, undefined],
    ["only one marker", `${M}PATH=/a\n`, undefined],
    ["a PATH outside the markers", `PATH=/rc\n${M}HOME=/h\n${M}`, undefined],
  ])("%s", (_, stdout, expected) => {
    expect(parseShellPath(stdout)).toBe(expected);
  });
});

/** A PATH written with colons, in this platform's delimiter (`;` on Windows). */
const listed = (colonList: string) => colonList.replaceAll(":", path.delimiter);
/** A PATH in this platform's delimiter, written back with colons. */
const colons = (list: string) => list.replaceAll(path.delimiter, ":");

describe("joinPaths", () => {
  it("keeps each folder at its first appearance and drops empty entries", () => {
    expect(
      colons(joinPaths(listed("/a:/b::/a"), undefined, ["/c", "/b", ""], "/d")),
    ).toMatchInlineSnapshot(`"/a:/b:/c:/d"`);
  });
});

describe("applyShellPath", () => {
  it("keeps what the app put in front since startup, then the shell's, then the launch PATH", () => {
    expect(
      colons(
        applyShellPath({
          current: listed("/app/bin:/saved/old:/usr/bin:/bin"),
          launched: listed("/usr/bin:/bin:/launcher/only"),
          shell: listed("/opt/homebrew/bin:/usr/bin:/bin"),
          startup: listed("/saved/old:/usr/bin:/bin"),
        }),
      ),
    ).toMatchInlineSnapshot(
      `"/app/bin:/opt/homebrew/bin:/usr/bin:/bin:/launcher/only"`,
    );
  });
});

describe("the saved PATH", () => {
  it("reads back what was saved", async () => {
    const file = path.join(dir, "nested", "login-shell-path.json");
    await savePath(file, "/a:/b");
    expect(readSavedPath(file)).toBe("/a:/b");
  });

  it.each([
    ["missing", undefined],
    ["not JSON", "PATH=/a"],
    ["no path field", JSON.stringify({ other: 1 })],
    ["an empty path", JSON.stringify({ path: "" })],
  ])("is absent when the file is %s", async (_, contents) => {
    const file = path.join(dir, "login-shell-path.json");
    if (contents !== undefined) {
      await fs.writeFile(file, contents);
    }
    expect(readSavedPath(file)).toBeUndefined();
  });
});

describe.runIf(posix)("readLoginShellPath", () => {
  it("reads the PATH between the markers, whatever the shell exits with", async () => {
    const shell = await fakeShell(
      `echo banner\nprintf '${M}'\necho "PATH=/from/shell:$PATH"\nprintf '${M}'\nexit 3`,
    );
    expect(
      await readLoginShellPath({
        env: { PATH: "/usr/bin:/bin" },
        shell,
        timeoutMs: 5000,
      }),
    ).toEqual({ path: "/from/shell:/usr/bin:/bin" });
  });

  it("gives up after the timeout and kills what the shell started", async () => {
    const pidFile = path.join(dir, "child.pid");
    const shell = await fakeShell(`sleep 30 &\necho $! > ${pidFile}\nwait`);
    const started = Date.now();
    const result = await readLoginShellPath({
      env: { PATH: "/usr/bin:/bin" },
      shell,
      timeoutMs: 300,
    });
    expect(result).toEqual({
      error: `${shell} did not print its PATH within 300 ms`,
    });
    expect(Date.now() - started).toBeLessThan(3000);
    const pid = Number(await fs.readFile(pidFile, "utf8"));
    await expect.poll(() => isAlive(pid)).toBe(false);
  });

  it("reports a shell that cannot start", async () => {
    const result = await readLoginShellPath({
      env: {},
      shell: path.join(dir, "missing-shell"),
      timeoutMs: 5000,
    });
    expect(result).toHaveProperty("error");
  });
});

describe.runIf(posix)("startLoginShellPath", () => {
  it("applies the saved PATH at once, then the shell's, and saves it", async () => {
    const cacheFile = path.join(dir, "login-shell-path.json");
    await savePath(cacheFile, "/saved/bin:/usr/bin");
    process.env.PATH = "/usr/bin:/bin";
    const shell = await fakeShell(
      `printf '${M}'\necho "PATH=/shell/bin:$PATH"\nprintf '${M}'`,
    );
    const logs: string[] = [];
    startLoginShellPath({
      cacheFile,
      log: (message) => logs.push(message),
      shell,
      timeoutMs: 5000,
    });
    expect(process.env.PATH).toBe("/saved/bin:/usr/bin:/bin");

    // What the app puts in front meanwhile stays in front.
    process.env.PATH = `/app/bin:${process.env.PATH}`;
    await shellPathReady();
    // The shell saw the launch PATH, never the saved one.
    expect(process.env.PATH).toBe("/app/bin:/shell/bin:/usr/bin:/bin");
    expect(readSavedPath(cacheFile)).toBe("/shell/bin:/usr/bin:/bin");
    expect(logs).toEqual([expect.stringMatching(/^Login shell PATH read/)]);
  });

  it("falls back to the launch PATH and common folders, and keeps them when the read fails", async () => {
    process.env.PATH = "/usr/bin:/bin";
    const logs: string[] = [];
    startLoginShellPath({
      cacheFile: path.join(dir, "login-shell-path.json"),
      log: (message) => logs.push(message),
      shell: await fakeShell("echo no markers here"),
      timeoutMs: 5000,
    });
    const startup = process.env.PATH;
    expect(startup).toBe(
      `/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin:${path.join(os.homedir(), ".local", "bin")}`,
    );
    await shellPathReady();
    expect(process.env.PATH).toBe(startup);
    expect(readSavedPath(path.join(dir, "login-shell-path.json"))).toBe(
      undefined,
    );
    expect(logs).toEqual([
      expect.stringMatching(/^Login shell PATH not read, keeping the fallback/),
    ]);
  });
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
