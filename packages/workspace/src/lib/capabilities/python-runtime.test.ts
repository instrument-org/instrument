import { execa } from "execa";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  type ChannelAnswer,
  openScriptChannel,
  type ScriptChannel,
} from "./channel";
import { ensurePythonRuntime } from "./python-runtime";

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

/** Runs `code` as the bare managed Python would be run, its channel open. */
async function run(code: string) {
  channel = await openScriptChannel(echo);
  const { modules, site } = await ensurePythonRuntime();
  return execa(python ?? "python3", ["-c", code], {
    env: {
      ...channel.env,
      PYTHONPATH: [site, modules].join(path.delimiter),
    },
    reject: false,
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
