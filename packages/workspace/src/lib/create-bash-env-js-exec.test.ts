import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FolderAttachment } from "../schemas/folder-attachment";
import { TaskDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { createBashEnv } from "./create-bash-env";

/**
 * `js-exec` as the agent meets it: Node code, written by reflex, against a
 * QuickJS runtime whose Node shims stop short of Node's shapes. The bootstrap
 * in `shell-commands/js-exec-bootstrap.ts` closes the gaps a script hits in
 * ordinary file work, and the command wrapper accepts Node's option spellings
 * and explains the runtime's own failures.
 */
const model = createMockAIGatewayModel();
const sessionId = StoreId.newSessionId();

let tmpDir: string;
let attachedDir: string;
let taskRoot: string;
let taskId: TaskId;

async function run(
  command: string,
  access: FolderAttachment.Access = "read-only",
) {
  const bash = await createBashEnv({
    attachedFolders: {
      Docs: {
        access,
        createdAt: Date.now(),
        id: FolderAttachment.IdSchema.parse("docs-id"),
        mountName: "Docs",
        path: TaskDirSchema.parse(attachedDir),
        source: "user",
      },
    },
    sessionId,
    taskId,
  });
  return bash.exec(command, { signal: AbortSignal.timeout(60_000) });
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sandboxed-js-exec-"));
  taskRoot = path.join(tmpDir, "tasks", "test");
  attachedDir = path.join(tmpDir, "Docs");
  await fs.mkdir(path.join(taskRoot, "work"), { recursive: true });
  await fs.mkdir(path.join(attachedDir, "sub", "deep"), { recursive: true });
  await fs.writeFile(path.join(attachedDir, "readme.txt"), "hello docs\n");
  await fs.writeFile(path.join(attachedDir, "sub", "b.txt"), "b\n");
  await fs.writeFile(path.join(attachedDir, "sub", "deep", "c.txt"), "c\n");
  await fs.writeFile(
    path.join(attachedDir, "big.bin"),
    Buffer.alloc(9 * 1024 * 1024, 65),
  );
  taskId = createMockTaskConfigForDir(TaskDirSchema.parse(taskRoot), { model });
});

afterEach(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("js-exec inside the sandbox", () => {
  it("reads an attached folder in place and refuses to write a read-only one", async () => {
    const read = await run(
      `js-exec -c "const fs = require('fs'); console.log(fs.readFileSync('/mnt/Docs/readme.txt', 'utf8').trim())"`,
    );
    expect(read).toMatchObject({ exitCode: 0, stdout: "hello docs\n" });

    const write = await run(
      `js-exec -c "require('fs').writeFileSync('/mnt/Docs/new.txt', 'x')"`,
    );
    expect(write.exitCode).toBe(1);
    expect(write.stderr).toContain("EROFS: read-only file system");
  });

  it("sends a missing package to pnpm and node", async () => {
    const result = await run(`js-exec -c "require('csv-parse')"`);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Cannot find module 'csv-parse'");
    expect(result.stderr).toContain(
      "js-exec: js-exec has Node's built-in modules (see `js-exec --help`) and relative files only, never a package, installed or not. Code that needs 'csv-parse' runs with `node` after `pnpm add csv-parse`",
    );
  });

  it("reports a file the bridge cannot carry", async () => {
    const result = await run(
      `js-exec -c "console.log(require('fs').readFileSync('/mnt/Docs/big.bin').length)"`,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Result too large");
    expect(result.stderr).toContain(
      "js-exec: js-exec reads a file whole through an 8 MB bridge",
    );
  });
});

describe("js-exec takes Node's options", () => {
  it.each([
    ["-e", `js-exec -e 'console.log(1 + 2)'`, "3\n"],
    ["--eval", `js-exec --eval 'console.log(1 + 2)'`, "3\n"],
    ["--eval=", `js-exec --eval='console.log(1 + 2)'`, "3\n"],
    ["-p", `js-exec -p '1 + 2;'`, "3\n"],
    ["-p with a trailing comment", `js-exec -p '1 + 2; // three'`, "3\n"],
    [
      "-p with a // inside a string",
      `js-exec -p '"http://x" // url'`,
      "http://x\n",
    ],
    ["-p of nothing", `js-exec -p ''`, "undefined\n"],
    ["-p of a regular expression", `js-exec -p '/x/g'`, "/x/g\n"],
    ["-p of a symbol", `js-exec -p 'Symbol("x")'`, "Symbol(x)\n"],
    ["-p of a function", `js-exec -p '(function f() {})'`, "[Function: f]\n"],
    ["-p of an object", `js-exec -p '({ a: [1, 2] })'`, `{"a":[1,2]}\n`],
    ["--print", `js-exec --print 'process.argv.slice(1)' a b`, `["a","b"]\n`],
    [
      "-e after -m and --strip-types",
      `js-exec -m --strip-types -e 'const n: number = await Promise.resolve(2); console.log(n)'`,
      "2\n",
    ],
  ])("%s", async (_name, command, stdout) => {
    const result = await run(command);
    expect(result).toMatchObject({ exitCode: 0, stderr: "", stdout });
  });

  it("reports an error in -p code on line 1, past the wrapper's opening", async () => {
    const result = await run(`js-exec -p 'nope.x'`);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("at <eval> (-c:1:12): 'nope' is not defined\n");
  });

  it("wants an argument after -e", async () => {
    const result = await run("js-exec -e");
    expect(result).toMatchObject({
      exitCode: 2,
      stderr: "js-exec: option requires an argument -- 'e'\n",
    });
  });

  it("leaves a script's own -e alone", async () => {
    await fs.writeFile(
      path.join(taskRoot, "work", "args.js"),
      "console.log(JSON.stringify(process.argv.slice(2)))\n",
    );
    const result = await run("js-exec work/args.js -e code");
    expect(result).toMatchObject({ exitCode: 0, stdout: `["-e","code"]\n` });
  });

  it("lists the Node spellings in --help beside the runtime's own", async () => {
    const result = await run("js-exec --help");
    expect(result.stdout).toContain(
      [
        "  -c CODE          Execute inline code",
        "  -e, --eval CODE  Execute inline code (Node's spelling of -c)",
        "  -p, --print EXPR Evaluate an expression and print its value",
        "  -m, --module     Enable ES module mode (import/export)",
      ].join("\n"),
    );
  });

  it("exposes the built-in modules as globals to inline code, as node -e does", async () => {
    const result = await run(
      `js-exec -e 'console.log(path.basename("/a/b.txt"), os.platform(), typeof util.inspect)'`,
    );
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "b.txt linux function\n",
    });
  });
});

describe("js-exec gives its Node shims Node's shapes", () => {
  it("puts the executable first in process.argv, so slice(2) is the script's arguments", async () => {
    await fs.writeFile(
      path.join(taskRoot, "work", "args.js"),
      "console.log(JSON.stringify(process.argv), __filename, __dirname, require.main === module)\n",
    );
    const script = await run("js-exec work/args.js a b");
    expect(script).toMatchObject({
      exitCode: 0,
      stdout: `["js-exec","/task/work/args.js","a","b"] /task/work/args.js /task/work true\n`,
    });

    const inline = await run(
      `js-exec -e 'console.log(JSON.stringify(process.argv), require.main === module)' a b`,
    );
    expect(inline).toMatchObject({
      exitCode: 0,
      stdout: `["js-exec","a","b"] false\n`,
    });
  });

  it("answers statSync with methods and Date fields", async () => {
    const result = await run(
      `js-exec -e 'const s = fs.statSync("/mnt/Docs/readme.txt"); const d = fs.lstatSync("/mnt/Docs/sub"); s.atime.setTime(0); console.log(s.isFile(), s.isDirectory(), d.isDirectory(), d.isSymbolicLink(), s.size, s.mtime instanceof Date, typeof s.mtimeMs, s.mtime.getTime() === s.mtimeMs, s.birthtime instanceof Date)'`,
    );
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "true false true false 11 true number true true\n",
    });
  });

  it("honors withFileTypes and recursive in readdirSync", async () => {
    const dirents = await run(
      `js-exec -e 'const d = fs.readdirSync("/mnt/Docs", { withFileTypes: true }); console.log(JSON.stringify(d.map((e) => [e.parentPath, e.name, e.isDirectory(), e.isFile()])))'`,
    );
    expect(dirents).toMatchObject({
      exitCode: 0,
      stdout: `[["/mnt/Docs","big.bin",false,true],["/mnt/Docs","readme.txt",false,true],["/mnt/Docs","sub",true,false]]\n`,
    });

    const recursive = await run(
      `js-exec -e 'console.log(JSON.stringify(fs.readdirSync("/mnt/Docs", { recursive: true })))'`,
    );
    expect(recursive).toMatchObject({
      exitCode: 0,
      stdout: `["big.bin","readme.txt","sub","sub/b.txt","sub/deep","sub/deep/c.txt"]\n`,
    });

    const both = await run(
      `js-exec -e 'console.log(JSON.stringify(fs.readdirSync("/mnt/Docs/sub", { recursive: true, withFileTypes: true }).map((e) => e.parentPath + "/" + e.name)))'`,
    );
    expect(both).toMatchObject({
      exitCode: 0,
      stdout: `["/mnt/Docs/sub/b.txt","/mnt/Docs/sub/deep","/mnt/Docs/sub/deep/c.txt"]\n`,
    });

    const plain = await run(
      `js-exec -e 'console.log(JSON.stringify(fs.readdirSync("/mnt/Docs/sub")))'`,
    );
    expect(plain).toMatchObject({ exitCode: 0, stdout: `["b.txt","deep"]\n` });
  });

  it("routes fs.promises and require('fs/promises') through the same shapes", async () => {
    const result = await run(
      `js-exec -m -e 'const fsp = require("node:fs/promises"); const s = await fsp.stat("/mnt/Docs/readme.txt"); const d = await fs.promises.readdir("/mnt/Docs", { withFileTypes: true }); console.log(s.isFile(), d.find((e) => e.name === "sub").isDirectory(), (await fsp.readFile("/mnt/Docs/readme.txt", "utf8")).trim())'`,
    );
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "true true hello docs\n",
    });
  });

  it("puts code, errno, syscall, and the path as written on an fs error", async () => {
    const caught = await run(
      `js-exec -e 'try { fs.readFileSync("/mnt/Docs/nope.txt") } catch (e) { console.log(JSON.stringify({ code: e.code, errno: e.errno, syscall: e.syscall, path: e.path, message: e.message })) }'`,
    );
    expect(caught).toMatchObject({
      exitCode: 0,
      stdout: `{"code":"ENOENT","errno":-2,"syscall":"open","path":"/mnt/Docs/nope.txt","message":"ENOENT: no such file or directory, open '/mnt/Docs/nope.txt'"}\n`,
    });

    await fs.writeFile(
      path.join(taskRoot, "work", "apostrophe.js"),
      'try { fs.readFileSync("/mnt/Docs/don\'t.txt") } catch (e) { console.log(e.code, e.path); console.log(e.message) }\n',
    );
    const apostrophe = await run("js-exec work/apostrophe.js");
    expect(apostrophe).toMatchObject({
      exitCode: 0,
      stdout:
        "ENOENT /mnt/Docs/don't.txt\nENOENT: no such file or directory, open '/mnt/Docs/don't.txt'\n",
    });

    const rename = await run(
      `js-exec -e 'try { fs.renameSync("/mnt/Docs/readme.txt", "/mnt/Docs/moved.txt") } catch (e) { console.log(e.code, e.dest, e.message) }'`,
    );
    expect(rename).toMatchObject({
      exitCode: 0,
      stdout: `EROFS /mnt/Docs/moved.txt EROFS: read-only file system, rename '/mnt/Docs/readme.txt' -> '/mnt/Docs/moved.txt'\n`,
    });

    const rejected = await run(
      `js-exec -m -e 'try { await fs.promises.access("/mnt/Docs/nope.txt") } catch (e) { console.log(e.code, e.message) }'`,
    );
    expect(rejected).toMatchObject({
      exitCode: 0,
      stdout:
        "ENOENT ENOENT: no such file or directory, access '/mnt/Docs/nope.txt'\n",
    });
  });

  it("reports an uncaught fs error at the script's own line", async () => {
    await fs.writeFile(
      path.join(taskRoot, "work", "fail.js"),
      "const x = 1;\nfs.writeFileSync('/mnt/Docs/x.txt', 'x');\n",
    );
    const result = await run("js-exec work/fail.js");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "at /task/work/fail.js:2:17: EROFS: read-only file system, open '/mnt/Docs/x.txt'\n",
    );
  });

  it("writes process.stdout and process.stderr, a line at a time", async () => {
    const result = await run(
      `js-exec -e 'process.stdout.write("out\\n"); process.stdout.write("no newline"); process.stderr.write(Buffer.from("err\\n"))'`,
    );
    expect(result).toMatchObject({
      exitCode: 0,
      stderr: "err\n",
      stdout: "out\nno newline\n",
    });
  });

  it("has TextEncoder and TextDecoder over the runtime's Buffer", async () => {
    const result = await run(
      `js-exec -e 'const bytes = new TextEncoder().encode("héllo"); console.log(bytes.length, bytes instanceof Uint8Array, new TextDecoder().decode(bytes))'`,
    );
    expect(result).toMatchObject({ exitCode: 0, stdout: "6 true héllo\n" });
  });
});

describe("js-exec explains the runtime's own limits", () => {
  it("sends an ESM import of a built-in's subpath to the module itself", async () => {
    await fs.writeFile(
      path.join(taskRoot, "work", "p.mjs"),
      "import { readFile } from 'node:fs/promises';\nconsole.log(await readFile('/mnt/Docs/readme.txt', 'utf8'));\n",
    );
    const result = await run("js-exec work/p.mjs");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Cannot find module 'fs/promises'");
    expect(result.stderr).toContain(
      "js-exec: 'fs/promises' is a subpath of a built-in module, and js-exec loads only the module itself: `import fs from 'node:fs'` and reach it from there (fs/promises is fs.promises, path/posix is path.posix).",
    );
    expect(result.stderr).not.toContain("pnpm add");
  });

  it("names node for a module the runtime leaves out", async () => {
    const result = await run(`js-exec -e 'require("crypto")'`);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Module 'crypto' is not available in the js-exec sandbox",
    );
    expect(result.stderr).toContain("js-exec: `node` has 'crypto'");
  });

  it("says there are no timers rather than leaving a ReferenceError", async () => {
    const result = await run(
      `js-exec -e 'setTimeout(() => console.log("later"), 100)'`,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("'setTimeout' is not defined");
    expect(result.stderr).toContain(
      "js-exec: js-exec has no timers and no event loop",
    );
  });
});
