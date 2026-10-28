import { execa } from "execa";
import { spawnSync } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  type ChannelAnswer,
  openScriptChannel,
  type ScriptChannel,
} from "./channel";
import { AbsolutePathSchema } from "../../schemas/paths";
import { venvSitePackages } from "../uv";
import { ensurePythonRuntime, linkPythonRuntime } from "./python-runtime";

/**
 * A Python to run the module with: uv's own, where uv is on this computer.
 * Never the system's `python3`, which on a Mac without the developer tools
 * asks to install them.
 */
const python = (() => {
  const found = spawnSync("uv", ["python", "find", "3.12"], {
    encoding: "utf8",
  });
  return found.status === 0 ? found.stdout.trim() : undefined;
})();

/**
 * Answers with what it was called with, refuses `no.*`, hands
 * `apps.request` to `guide` back as the guide, and describes the two
 * capabilities the module builds functions for.
 */
const echo: ChannelAnswer = (request) =>
  Promise.resolve(
    request.kind === "describe"
      ? {
          capabilities: [
            {
              input: {
                properties: {
                  app: { type: "string" },
                  body: {},
                  method: { type: "string" },
                  params: { type: "object" },
                  path: {
                    description: "Relative to the base.",
                    type: "string",
                  },
                },
                required: ["app", "method", "path"],
                type: "object",
              },
              name: "apps.request",
              positional: ["app", "method", "path"],
              summary: "One request through an API app.",
            },
            {
              input: {
                properties: {
                  maxCharacters: { type: "number" },
                  url: { type: "string" },
                },
                required: ["url"],
                type: "object",
              },
              name: "web.fetch",
              positional: ["url"],
              summary: "Fetches an http(s) URL.",
            },
          ],
        }
      : request.capability.startsWith("no.")
        ? {
            error: {
              kind: "refused",
              message: `refused ${request.capability}`,
            },
          }
        : JSON.stringify(request.args).includes('"guide"')
          ? {
              error: {
                kind: "read-first",
                message:
                  'Not sent: before the first request to "guide", its guide.\n\n# Guide\n',
              },
            }
          : { result: { args: request.args, capability: request.capability } },
  );

let channel: ScriptChannel | undefined;

afterEach(() => {
  channel?.close();
  channel = undefined;
});

/**
 * Runs `code` as the bare managed Python would be run, its channel open
 * and handed over as the shell's `python` hands it over.
 */
async function run(code: string) {
  channel = await openScriptChannel(echo);
  const { modules, site } = await ensurePythonRuntime();
  const { env, tokenLine } = channel.handOver;
  return execa(python ?? "python3", ["-c", code], {
    env: { ...env, PYTHONPATH: [site, modules].join(path.delimiter) },
    reject: false,
    ...(tokenLine && { stdio: ["pipe", "pipe", "pipe", tokenLine] }),
  });
}

describe.skipIf(python === undefined)("python's instrument module", () => {
  it("takes the channel out of the environment before the script runs", async () => {
    const result = await run(
      `import os, subprocess, sys
print("INSTRUMENT_CHANNEL" in os.environ)
print(subprocess.run([sys.executable, "-c", "import os; print('INSTRUMENT_CHANNEL' in os.environ)"], capture_output=True, text=True).stdout.strip())`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("False\nFalse");
  });

  // Another process of the same user reads the environment a process
  // started with (`ps eww`, /proc/<pid>/environ), whatever it deletes later.
  it.skipIf(process.platform === "win32")(
    "starts with no token in its environment and leaves no descriptor 3 to a process it starts",
    async () => {
      const result = await run(
        `import ctypes, os, re, subprocess, sys
def started_with(pid):
    if sys.platform == "linux":
        with open("/proc/%d/environ" % pid, "rb") as environ:
            return environ.read()
    libc = ctypes.CDLL(None)
    mib = (ctypes.c_int * 3)(1, 49, pid)  # CTL_KERN, KERN_PROCARGS2
    size = ctypes.c_size_t(0)
    libc.sysctl(mib, 3, None, ctypes.byref(size), None, 0)
    found = ctypes.create_string_buffer(size.value)
    libc.sysctl(mib, 3, found, ctypes.byref(size), None, 0)
    return found.raw[: size.value]
# Each entry starts after a NUL, which sets the variables apart from this
# code in the arguments.
print(re.search(rb"\\0INSTRUMENT_CHANNEL=([^\\0]*)", b"\\0" + started_with(os.getpid())).group(1).decode())
print(subprocess.run(["/bin/sh", "-c", "if [ -e /dev/fd/3 ]; then echo open; else echo closed; fi"], close_fds=False, capture_output=True, text=True).stdout.strip())
import instrument
print(instrument.call("x.y")["capability"])`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toMatch(/^\d+:fd3\nclosed\nx\.y$/);
    },
  );

  it("calls an app's tool with keywords and hands back what came back", async () => {
    const result = await run(
      `import instrument
print(instrument.app("beacon").list_issues(state="open"))`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatchInlineSnapshot(
      `"{'args': {'app': 'beacon', 'args': {'state': 'open'}, 'tool': 'list_issues'}, 'capability': 'apps.call'}"`,
    );
  });

  it("builds a capability's function from its description, with a real signature", async () => {
    const result = await run(
      `import inspect, instrument
print(inspect.signature(instrument.apps.request))
print(instrument.apps.request("lantern", "GET", "/issues", params={"state": "open"}))`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatchInlineSnapshot(`
      "(app, method, path, *, body=None, params=None)
      {'args': {'app': 'lantern', 'method': 'GET', 'path': '/issues', 'params': {'state': 'open'}}, 'capability': 'apps.request'}"
    `);
  });

  it("reaches every namespace this shell has, its parameters in snake_case", async () => {
    const result = await run(
      `import inspect, instrument
print(inspect.signature(instrument.web.fetch))
print(instrument.web.fetch("https://example.com", max_characters=500))
print("web" in dir(instrument))
try:
    instrument.nowhere
except AttributeError as error:
    print(error)`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatchInlineSnapshot(`
      "(url, *, max_characters=None)
      {'args': {'url': 'https://example.com', 'max_characters': 500}, 'capability': 'web.fetch'}
      True
      instrument has no nowhere"
    `);
  });

  it("raises a refusal as instrument.Error and the guide as ReadGuideFirst", async () => {
    const result = await run(
      `import instrument
try:
    instrument.call("no.way")
except instrument.Error as error:
    print(type(error).__name__, error.kind, error)
instrument.app("guide").get("/me")`,
    );
    expect(result.stdout).toBe("Error refused refused no.way");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'instrument.ReadGuideFirst: Not sent: before the first request to "guide", its guide.\n\n# Guide',
    );
  });

  it("is safe to call from threads", async () => {
    const result = await run(
      `import instrument
from concurrent.futures import ThreadPoolExecutor
with ThreadPoolExecutor(8) as pool:
    done = list(pool.map(lambda n: instrument.app("beacon").get_issue(id=n)["args"]["args"]["id"], range(40)))
print(done == list(range(40)))`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("True");
  });

  it("says where it works when no channel is open", async () => {
    const { modules, site } = await ensurePythonRuntime();
    const result = await execa(
      python ?? "python3",
      ["-c", "import instrument; instrument.app('beacon').tools()"],
      {
        env: { PYTHONPATH: [site, modules].join(path.delimiter) },
        reject: false,
      },
    );
    expect(result.stderr).toContain(
      "instrument.Error: instrument reaches Instrument only from a script the shell's python runs.",
    );
  });
});

// The app writes into a virtualenv the agent can change, outside the
// sandbox, so a link the agent leaves at the name must not aim that write.
describe.skipIf(process.platform === "win32")("linkPythonRuntime", () => {
  it("replaces a link at the .pth rather than writing through it", async () => {
    const venv = AbsolutePathSchema.parse(
      await mkdtemp(path.join(os.tmpdir(), "link-python-runtime-")),
    );
    const sitePackages = venvSitePackages(venv);
    await mkdir(sitePackages, { recursive: true });
    const target = path.join(venv, "someone-elses-file");
    await writeFile(target, "theirs\n");
    const pth = path.join(sitePackages, "_instrument.pth");
    await symlink(target, pth);
    await linkPythonRuntime(venv);
    expect(await readFile(target, "utf8")).toBe("theirs\n");
    expect((await lstat(pth)).isSymbolicLink()).toBe(false);
    expect(await readFile(pth, "utf8")).toMatch(/\nimport _instrument_boot\n$/);
    await rm(venv, { force: true, recursive: true });
  });
});
