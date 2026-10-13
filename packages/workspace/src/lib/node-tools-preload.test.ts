import { mkdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { StoreId } from "../schemas/store-id";
import { knowChat } from "../test/helpers/mock-chat-config";
import { createLocalBashEnv } from "./create-bash-env";
import { chatDir } from "./record-folders";

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
      `echo 'globalThis.tools = "theirs";' > work/theirs.mjs && node --import ./work/theirs.mjs -e 'console.log(tools)'`,
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
