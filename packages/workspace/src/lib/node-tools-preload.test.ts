import { realpathSync } from "node:fs";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { StoreId } from "../schemas/store-id";
import { knowChat } from "../test/helpers/mock-chat-config";
import { createLocalBashEnv } from "./create-bash-env";
import { chatDir } from "./record-folders";
import { workDir } from "./work-dir";

const chatId = ChatIdSchema.parse("node-tools-task");

/** Answers `tools.*` with what it was called with, or refuses `tools.no.*`. */
function echoTool(toolPath: string, argsJson: string) {
  return toolPath.startsWith("no.")
    ? Promise.reject(new Error(`refused ${toolPath}`))
    : Promise.resolve(
        JSON.stringify({ args: JSON.parse(argsJson), path: toolPath }),
      );
}

async function run(command: string, signal?: AbortSignal) {
  knowChat(chatId);
  await mkdir(chatDir(chatId), { recursive: true });
  const bash = await createLocalBashEnv({
    chatId,
    invokeTool: echoTool,
    sessionId: StoreId.newSessionId(),
  });
  return bash.exec(command, { signal });
}

describe("node's tools global", () => {
  it("hands a call's result back as a value", async () => {
    const result = await run(
      `node --input-type=module -e 'const r = await tools["my-app"].list({ page: 2 }); console.log(r.path, r.args.page)'`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("my-app.list 2\n");
  });

  it("throws a refusal into the script with its message", async () => {
    const result = await run(
      `node --input-type=module -e 'try { await tools.no.way(); } catch (error) { console.log(error.message); }'`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("refused no.way\n");
  });

  it("lets a script that never calls a tool exit when its work is done", async () => {
    const started = Date.now();
    const result = await run(`node -e 'console.log(typeof tools)'`);
    expect(result.stdout).toBe("function\n");
    expect(result.exitCode).toBe(0);
    // An open IPC channel holding the process would leave it running until
    // the test times out.
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("stays out of the globals a script walks", async () => {
    const result = await run(
      `node -e 'console.log(Object.keys(globalThis).includes("tools"), "tools" in globalThis)'`,
    );
    expect(result.stdout).toBe("false true\n");
  });

  it("leaves a tools global an earlier preload set alone", async () => {
    const result = await run(
      `echo 'globalThis.tools = "theirs";' > theirs.mjs && node --import ./theirs.mjs -e 'console.log(tools)'`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("theirs\n");
  });

  it("lets a script replace it by assignment", async () => {
    const result = await run(
      `node -e 'globalThis.tools = 5; console.log(tools)'`,
    );
    expect(result.stdout).toBe("5\n");
  });

  it("gives a process the script starts no tools", async () => {
    const result = await run(
      `node -e 'console.log(require("child_process").execFileSync(process.execPath, ["-e", "console.log(typeof tools)"], { encoding: "utf8" }).trim())'`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("undefined\n");
  });

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
