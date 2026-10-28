import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ChatIdSchema } from "../schemas/chat-id";
import { StoreId } from "../schemas/store-id";
import { knowChat } from "../test/helpers/mock-chat-config";
import {
  type ChannelAnswer,
  openScriptChannel,
  SCRIPT_CHANNEL_ENV,
  type ScriptChannel,
} from "./capabilities/channel";
import { createLocalBashEnv } from "./create-bash-env";
import { chatDir } from "./record-folders";
import { workDir } from "./work-dir";

const chatId = ChatIdSchema.parse("node-preload-task");

/**
 * Answers a script's `instrument` with what it was called with, refuses
 * `no.*`, hands `guide.first` back as the guide, and describes
 * `apps.request` as the registry does.
 */
const echo: ChannelAnswer = (request) =>
  Promise.resolve(
    request.kind === "describe"
      ? {
          capabilities: [
            {
              input: {},
              name: "apps.request",
              positional: ["app", "method", "path"],
              summary: "One request.",
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
        : request.capability === "guide.first"
          ? { error: { kind: "read-first", message: "Not sent: the guide." } }
          : request.capability === "apps.request"
            ? {
                result: {
                  body: { args: request.args },
                  status: 200,
                  truncated: false,
                  url: "",
                },
              }
            : {
                result: { args: request.args, capability: request.capability },
              },
  );

async function run(command: string, signal?: AbortSignal) {
  knowChat(chatId);
  await mkdir(chatDir(chatId), { recursive: true });
  const bash = await createLocalBashEnv({
    answerScript: echo,
    chatId,
    sessionId: StoreId.newSessionId(),
  });
  return bash.exec(command, { signal });
}

describe("node's instrument global", () => {
  it("calls an app's tool and hands the result back as a value", async () => {
    const result = await run(
      `node --input-type=module -e 'const r = await instrument.apps["my-app"].list_issues({ page: 2 }); console.log(r.capability, r.args.app, r.args.tool, r.args.args.page)'`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("apps.call my-app list_issues 2\n");
  });

  it("maps a capability's positional arguments by its description", async () => {
    const result = await run(
      `node --input-type=module -e 'const r = await instrument.apps.request("lantern", "GET", "/issues", { params: { state: "open" } }); console.log(JSON.stringify(r))'`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatchInlineSnapshot(`
      "{"body":{"args":{"params":{"state":"open"},"app":"lantern","method":"GET","path":"/issues"}},"status":200,"truncated":false,"url":""}
      "
    `);
  });

  it("makes an API app's request from its method, and hands back the body", async () => {
    const result = await run(
      `node --input-type=module -e 'const r = await instrument.app("google-drive").post("/files", { body: { name: "Plan" } }); console.log(JSON.stringify(r))'`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatchInlineSnapshot(`
      "{"args":{"body":{"name":"Plan"},"app":"google-drive","method":"POST","path":"/files"}}
      "
    `);
  });

  it("throws a refusal into the script as an instrument.Error", async () => {
    const result = await run(
      `node --input-type=module -e 'try { await instrument.no.way(); } catch (error) { console.log(error instanceof instrument.Error, error.kind, error.message); }'`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("true refused refused no.way\n");
  });

  it("prints an uncaught ReadGuideFirst by its name, with the guide", async () => {
    const result = await run(
      `node --input-type=module -e 'await instrument.guide.first()'`,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("ReadGuideFirst: Not sent: the guide.");
  });

  it("lets a script that never calls exit when its work is done", async () => {
    const started = Date.now();
    const result = await run(`node -e 'console.log(typeof instrument)'`);
    expect(result.stdout).toBe("object\n");
    expect(result.exitCode).toBe(0);
    // An open connection holding the process would leave it running until
    // the test times out.
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("stays out of the globals a script walks", async () => {
    const result = await run(
      `node -e 'console.log(Object.keys(globalThis).includes("instrument"), "instrument" in globalThis)'`,
    );
    expect(result.stdout).toBe("false true\n");
  });

  it("leaves an instrument global an earlier preload set alone", async () => {
    const result = await run(
      `echo 'globalThis.instrument = "theirs";' > theirs.mjs && node --import ./theirs.mjs -e 'console.log(instrument)'`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("theirs\n");
  });

  it("lets a script replace it by assignment", async () => {
    const result = await run(
      `node -e 'globalThis.instrument = 5; console.log(instrument)'`,
    );
    expect(result.stdout).toBe("5\n");
  });

  it("gives a process the script starts no instrument", async () => {
    const result = await run(
      `node -e 'console.log(require("child_process").execFileSync(process.execPath, ["-e", "console.log(typeof instrument)"], { encoding: "utf8" }).trim())'`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("undefined\n");
  });

  it("keeps the channel's token out of the script's environment", async () => {
    const result = await run(
      `node -e 'console.log(Object.keys(process.env).filter((name) => name.startsWith("INSTRUMENT_CHANNEL")).length)'`,
    );
    expect(result.stdout).toBe("0\n");
  });

  // Another process of the same user reads the environment a process
  // started with (`ps eww`, /proc/<pid>/environ), whatever it deletes later.
  it.skipIf(process.platform === "win32")(
    "starts the script and its child with no token in their environment, and its child with no descriptor 3",
    { timeout: 30_000 },
    async () => {
      knowChat(chatId);
      await mkdir(workDir(chatId), { recursive: true });
      const pids = path.join(workDir(chatId), "pids");
      const go = path.join(workDir(chatId), "go");
      const environs = path.join(workDir(chatId), "environs");
      await rm(pids, { force: true });
      await rm(go, { force: true });
      await rm(environs, { force: true });
      const script = path.join(workDir(chatId), "hold.cjs");
      await writeFile(
        script,
        `const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const fd3 = execFileSync("/bin/sh", ["-c", "if [ -e /dev/fd/3 ]; then echo open; else echo closed; fi"], { encoding: "utf8" }).trim();
const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { stdio: "ignore" });
const read = (file) => { try { return fs.readFileSync(file, "latin1"); } catch { return ""; } };
// On Linux the pids are the sandbox's own, so the script reads the
// environments it and its child started with, once the child has exec'd.
const report = () => {
  if (process.platform !== "linux") return fs.writeFileSync("pids", process.pid + " " + child.pid);
  if (!read("/proc/" + child.pid + "/cmdline").includes("setTimeout")) return setTimeout(report, 20);
  fs.writeFileSync("environs", JSON.stringify([read("/proc/self/environ"), read("/proc/" + child.pid + "/environ")]));
  fs.writeFileSync("pids", "");
};
report();
const wait = () => {
  if (!fs.existsSync("go")) return setTimeout(wait, 20);
  child.kill();
  console.log(fd3);
};
wait();
`,
      );
      const running = run(`node hold.cjs`);
      const started = Date.now();
      while (!existsSync(pids) && Date.now() - started < 20_000) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const shown =
        process.platform === "linux"
          ? z
              .array(z.string())
              .parse(JSON.parse(await readFile(environs, "utf8")))
              .map((environ) => environ.replaceAll("\0", " "))
          : (await readFile(pids, "utf8")).split(" ").map(
              (pid) =>
                spawnSync("ps", ["eww", "-o", "command=", "-p", pid], {
                  encoding: "utf8",
                }).stdout,
            );
      const [inScript, inChild] = shown.map(
        (environ) =>
          new RegExp(`(?:^|\\s)${SCRIPT_CHANNEL_ENV}=(\\S+)`).exec(
            environ,
          )?.[1],
      );
      await writeFile(go, "");
      const result = await running;
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("closed\n");
      // The variable names the port and the descriptor, never the token.
      expect(inScript).toMatch(/^\d+:fd3$/);
      expect(inChild).toBeUndefined();
    },
  );

  // A package.json no one may read stands in for a folder the sandbox keeps
  // closed above the script, as MXC does above the work folder: Node fails
  // the same way on EACCES as on EPERM. Windows has no such file mode.
  describe.skipIf(process.platform === "win32")(
    "below a package.json the script may not read",
    () => {
      async function below(files: Record<string, string>) {
        knowChat(chatId);
        const open = path.join(workDir(chatId), "closed", "open");
        await mkdir(open, { recursive: true });
        const config = path.join(workDir(chatId), "closed", "package.json");
        await rm(config, { force: true });
        await writeFile(config, "{}");
        await chmod(config, 0o000);
        for (const [name, contents] of Object.entries(files)) {
          await writeFile(path.join(open, name), contents);
        }
        return async (command: string) => {
          const result = await run(`cd closed/open && ${command}`);
          await chmod(config, 0o644);
          return {
            exitCode: result.exitCode,
            stderr: result.stderr
              .replaceAll(realpathSync(workDir(chatId)), "<work>")
              .replaceAll(workDir(chatId), "<work>"),
            stdout: result.stdout,
          };
        };
      }

      it.each([
        ["a CommonJS script", "a.js", "cjs 2 1 2\n"],
        ["TypeScript", "t.ts", "ts 1 2\n"],
        ["a .js file in module syntax", "m.js", "esm 2 3\n"],
        ["an .mjs file", "m.mjs", "mjs 2\n"],
      ])("runs %s", async (_label, script, printed) => {
        const runBelow = await below({
          "a.js": `console.log("cjs", require("./b.js"), require("./x.json").v, require("./b"))`,
          "b.js": "module.exports = 2",
          "m.js": `import b from "./b.js"; console.log("esm", b, await Promise.resolve(3))`,
          "m.mjs": `import b from "./b.js"; console.log("mjs", b)`,
          "t.ts": `import b from "./b.js"; const n: number = 1; console.log("ts", n, b)`,
          "x.json": `{"v":1}`,
        });
        const result = await runBelow(`node ${script}`);
        expect(result).toEqual({ exitCode: 0, stderr: "", stdout: printed });
      });

      it("says a missing package is missing", async () => {
        const runBelow = await below({ "a.js": `require("left-pad")` });
        const result = await runBelow("node a.js");
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("Cannot find module 'left-pad'");
      });

      it("tells the agent how past it when another Node stops on it", async () => {
        const runBelow = await below({ "a.js": `console.log("cjs")` });
        const result = await runBelow(
          `node -e 'require("child_process").execFileSync(process.execPath, ["a.js"], { stdio: "inherit" })'`,
        );
        expect(result.exitCode).toBe(1);
        expect(result.stderr.split("\n").at(-2)).toMatchInlineSnapshot(
          `"The sandbox refused Node's look for a package.json above the script (<work>/closed/package.json). \`node <script>\` from this shell reads past that; for a script another program starts, a package.json beside the script (\`{}\` is enough) ends the look there."`,
        );
      });
    },
  );

  it("stops the script when the command is aborted", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const started = Date.now();
    const result = await run(
      `node -e 'setTimeout(() => console.log("finished"), 30000)'`,
      controller.signal,
    );
    expect(result.stdout).not.toContain("finished");
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});

/** Where a channel listens and the token it takes, as its process would read them. */
function reachOf(channel: ScriptChannel) {
  const [port = "", secret = ""] =
    channel.handOver.env[SCRIPT_CHANNEL_ENV]?.split(":") ?? [];
  return {
    port: Number(port),
    token: channel.handOver.tokenLine?.toString("utf8").trim() ?? secret,
  };
}

describe("openScriptChannel", () => {
  /** Writes `lines` and reads what comes back until an answer or the close. */
  async function talk(port: number, lines: string[]) {
    const socket = connect({ host: "127.0.0.1", port });
    socket.setEncoding("utf8");
    socket.on("error", () => {});
    let received = "";
    socket.on("data", (chunk: string) => {
      received += chunk;
      if (received.endsWith("\n")) {
        socket.end();
      }
    });
    socket.write(lines.map((line) => `${line}\n`).join(""));
    await new Promise((resolve) => socket.once("close", resolve));
    return received;
  }

  it("answers a call only after the token", async () => {
    const channel = await openScriptChannel(echo);
    const { port, token } = reachOf(channel);
    const call = JSON.stringify({ args: { a: 1 }, capability: "x.y", id: 1 });
    try {
      expect(await talk(Number(port), ["0".repeat(64), call])).toBe("");
      expect(await talk(Number(port), [token, call])).toMatchInlineSnapshot(`
        "{"id":1,"result":{"args":{"a":1},"capability":"x.y"}}
        "
      `);
    } finally {
      channel.close();
    }
  });

  it("answers a request line past the limit with why, then closes", async () => {
    const channel = await openScriptChannel(echo);
    const { port, token } = reachOf(channel);
    try {
      const socket = connect({ host: "127.0.0.1", port });
      socket.setEncoding("utf8");
      let received = "";
      socket.on("data", (chunk: string) => {
        received += chunk;
      });
      socket.on("error", () => {});
      socket.write(`${token}\n`);
      // A line with no end past the 32 MB limit, as a script stuck writing
      // would send.
      socket.end(Buffer.alloc(32 * 1024 * 1024 + 1, "a"));
      await new Promise((resolve) => socket.once("close", resolve));
      expect(received).toMatchInlineSnapshot(`
        "{"error":{"kind":"failed","message":"The request was longer than the 32 MB one call to instrument may send. Send less in each call."},"id":null}
        "
      `);
    } finally {
      channel.close();
    }
  });

  it("drops a connection past the number waiting for their token", async () => {
    const channel = await openScriptChannel(echo);
    const { port, token } = reachOf(channel);
    // The limit is 16.
    const waiting = Array.from({ length: 16 }, () =>
      connect({ host: "127.0.0.1", port }),
    );
    try {
      await Promise.all(
        waiting.map(
          (socket) => new Promise((resolve) => socket.once("connect", resolve)),
        ),
      );
      const call = JSON.stringify({ args: {}, capability: "x.y", id: 1 });
      expect(await talk(port, [token, call])).toBe("");
      waiting[0]?.destroy();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(await talk(port, [token, call])).toContain('"id":1');
    } finally {
      for (const socket of waiting) {
        socket.destroy();
      }
      channel.close();
    }
  });

  it("refuses a call once the command that started the script is stopped", async () => {
    let answered = 0;
    const channel = await openScriptChannel((request, signal) => {
      answered += 1;
      return echo(request, signal);
    });
    const { port, token } = reachOf(channel);
    const stop = new AbortController();
    channel.attach(stop.signal);
    stop.abort();
    try {
      const call = JSON.stringify({ args: {}, capability: "x.y", id: 1 });
      expect(await talk(port, [token, call])).toMatchInlineSnapshot(`
        "{"id":1,"error":{"kind":"refused","message":"The command was stopped, so instrument takes no more calls from it."}}
        "
      `);
      expect(answered).toBe(0);
    } finally {
      channel.close();
    }
  });
});
