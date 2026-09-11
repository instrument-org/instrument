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
 * The sandboxed script runtimes, `python` and `js-exec`, as the agent meets
 * them: reading an attached folder in place, refusing to write a read-only
 * one, and explaining the limits of a WebAssembly interpreter in terms of the
 * native one that has none of them.
 *
 * Also the guard for the fourth part of the local just-bash patch, carried
 * until upstream ships the equivalent: without it every python run exits 1 in
 * an install layout like this repo's, a traceback names /tmp/_jb_script.py at
 * a line 400 past the script's own, and a file the 8 MB bridge cannot carry
 * fails with EINTR, which CPython retries until the descriptors run out.
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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sandboxed-python-"));
  taskRoot = path.join(tmpDir, "tasks", "test");
  attachedDir = path.join(tmpDir, "Docs");
  await fs.mkdir(path.join(taskRoot, "work", "skills", "demo", "scripts"), {
    recursive: true,
  });
  await fs.mkdir(attachedDir, { recursive: true });
  await fs.writeFile(path.join(attachedDir, "readme.txt"), "hello docs\n");
  await fs.writeFile(
    path.join(attachedDir, "big.bin"),
    Buffer.alloc(9 * 1024 * 1024, 65),
  );
  await fs.writeFile(
    path.join(taskRoot, "work", "report.py"),
    "import sys\nimport helper\nprint('rows', helper.ROWS, sys.argv[1:])\n\ndef fail():\n    raise ValueError('boom')\n\nfail()\n",
  );
  await fs.writeFile(path.join(taskRoot, "work", "helper.py"), "ROWS = 3\n");
  taskId = createMockTaskConfigForDir(TaskDirSchema.parse(taskRoot), { model });
});

afterEach(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("python inside the sandbox", () => {
  it("exits with the script's own status", async () => {
    const ok = await run(`python -c "print(1 + 2)"`);
    expect(ok).toMatchObject({ exitCode: 0, stderr: "", stdout: "3\n" });

    const three = await run(`python3 -c "import sys; sys.exit(3)"`);
    expect(three.exitCode).toBe(3);

    const message = await run(`python -c "import sys; sys.exit('bad news')"`);
    expect(message).toMatchObject({ exitCode: 1, stderr: "bad news\n" });
  });

  it("reads an attached folder in place and refuses to write a read-only one", async () => {
    const read = await run(
      `python -c "from pathlib import Path; print(Path('/mnt/Docs/readme.txt').read_text(), end='')"`,
    );
    expect(read).toMatchObject({ exitCode: 0, stdout: "hello docs\n" });

    const write = await run(
      `python -c "f = open('/mnt/Docs/new.txt', 'w'); f.write('x'); f.close()"`,
    );
    expect(write.exitCode).toBe(1);
    expect(write.stderr).toContain(
      "OSError: [Errno 69] Read-only file system: '/mnt/Docs/new.txt'",
    );
    await expect(fs.stat(path.join(attachedDir, "new.txt"))).rejects.toThrow();
  });

  it("writes a read-and-write folder and the task alike", async () => {
    const result = await run(
      `python -c "open('/mnt/Docs/out.txt', 'w').write('mount'); open('work/out.txt', 'w').write('task')"`,
      "read-write",
    );
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    await expect(
      fs.readFile(path.join(attachedDir, "out.txt"), "utf8"),
    ).resolves.toBe("mount");
    await expect(
      fs.readFile(path.join(taskRoot, "work", "out.txt"), "utf8"),
    ).resolves.toBe("task");
  });

  it("names the script and its own lines in a traceback, and imports a sibling module", async () => {
    const result = await run("python work/report.py a b");

    expect(result.stdout).toBe("rows 3 ['a', 'b']\n");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(`
      "Traceback (most recent call last):
        File "work/report.py", line 8, in <module>
          fail()
          ~~~~^^
        File "work/report.py", line 6, in fail
          raise ValueError('boom')
      ValueError: boom
      "
    `);
  });

  it("names <string> for inline code and strips the interpreter's own frames", async () => {
    const result = await run(`python -c "open('/mnt/Docs/missing.txt')"`);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(`
      "Traceback (most recent call last):
        File "<string>", line 1, in <module>
      FileNotFoundError: [Errno 44] No such file or directory: '/mnt/Docs/missing.txt'
      "
    `);
  });

  it("sends a missing package to pip and python-native", async () => {
    const result = await run(`python -c "import numpy"`);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "ModuleNotFoundError: No module named 'numpy'",
    );
    expect(result.stderr).toContain(
      "python: 'numpy' is not in the standard library, which is all this sandboxed python has. Install it with `pip install numpy` and run the script with `python-native`",
    );
  });

  it("tells a standard-library module the build lacks apart from a package", async () => {
    const result = await run(`python -c "import sqlite3"`);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "python: 'sqlite3' is part of the standard library but this WebAssembly build of CPython does not include it. Run the script with `python-native` instead, or query the database with the `sqlite3` command.",
    );
  });

  it("explains that it cannot start a process", async () => {
    const result = await run(
      `python -c "import subprocess; subprocess.run(['ls'])"`,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("emscripten does not support processes");
    expect(result.stderr).toContain(
      "python: this sandboxed python cannot start a process",
    );
  });

  it("reports a file the bridge cannot carry as too large, once", async () => {
    const result = await run(
      `python -c "print(len(open('/mnt/Docs/big.bin', 'rb').read()))"`,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "OSError: [Errno 22] File too large: '/mnt/Docs/big.bin'",
    );
    expect(result.stderr).toContain(
      "python: this sandboxed python reads a file whole through an 8 MB bridge",
    );
    expect(result.stderr).not.toContain("No file descriptors available");
  });

  it("refuses to append to a file the bridge cannot carry rather than replace it", async () => {
    const result = await run(
      `python -c "f = open('/mnt/Docs/big.bin', 'a'); f.write('tail'); f.close()"`,
      "read-write",
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "OSError: [Errno 22] File too large: '/mnt/Docs/big.bin'",
    );
    const stat = await fs.stat(path.join(attachedDir, "big.bin"));
    expect(stat.size).toBe(9 * 1024 * 1024);
  });

  it("prints a syntax error the way CPython does, and runs as the __main__ module", async () => {
    const syntax = await run(`python -c "x = = 1"`);
    expect(syntax.exitCode).toBe(1);
    expect(syntax.stderr).toMatchInlineSnapshot(`
      "  File "<string>", line 1
          x = = 1
              ^
      SyntaxError: invalid syntax
      "
    `);

    const main = await run(`python -c "
import pickle, sys, __main__
class Point:
    def __init__(self, x):
        self.x = x
print(__main__ is sys.modules['__main__'], pickle.loads(pickle.dumps(Point(7))).x)
"`);
    expect(main).toMatchObject({ exitCode: 0, stderr: "", stdout: "True 7\n" });
  });

  it("points `-m pip` at the pip command and the native interpreter", async () => {
    const result = await run("python -m pip install requests");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Use the `pip` command instead");
    expect(result.stderr).toContain("runs under `python-native`");
  });

  it("runs a loaded skill's script natively", async () => {
    // The native interpreter needs a virtualenv this test has no uv to build,
    // so the carve-out shows as the mount guard the native path answers with,
    // which the sandboxed interpreter would never have raised.
    await fs.writeFile(
      path.join(taskRoot, "work", "skills", "demo", "scripts", "run.py"),
      "print('skill')\n",
    );
    const result = await run(
      "python work/skills/demo/scripts/run.py /mnt/Docs/readme.txt",
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "python: /mnt/Docs/readme.txt is inside an attached folder, which python cannot read.",
    );
    // A skill script has no sandboxed run to be redirected to.
    expect(result.stderr).not.toContain("Run it with `python` instead");
    expect(result.stderr).toContain("Copy the file into the task first");
  });

  it("answers `which` for both interpreters and js-exec", async () => {
    const result = await run(
      "which python && which python3 && which python-native && which js-exec",
    );
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "python\npython3\npython-native\njs-exec\n",
    });
  });
});

describe("python-native", () => {
  it("offers the sandboxed python for a mount it cannot read", async () => {
    const result = await run(
      "python-native work/report.py /mnt/Docs/readme.txt",
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "python-native: /mnt/Docs/readme.txt is inside an attached folder, which python-native cannot read.",
    );
    expect(result.stderr).toContain(
      "Run it with `python` instead, which reads attached folders directly, if the script needs no installed package. Otherwise copy the file into the task first (cp '/mnt/Docs/readme.txt' attachments/) and run python-native on the copy.",
    );
  });
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
