import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MountedFolder } from "../schemas/mounted-folder";
import {
  AbsolutePathSchema,
  ChatDirSchema,
  WorkspaceDirSchema,
} from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { createBashEnv } from "./create-bash-env";
import { updatePermissionSettings } from "./permissions/rules";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

/**
 * The sandboxed `python` as the agent meets it: reading a folder mount in
 * place, refusing to write a closed one, and explaining the limits of a
 * WebAssembly interpreter in terms of the native one that has none of them.
 * `create-bash-env-js-exec.test.ts` is the same for `js-exec`.
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
let chatId: ChatId;

function real(text: string) {
  return text.replaceAll("<docs>", attachedDir).replaceAll("<task>", taskRoot);
}

/** Closes a folder in Docs through Settings › Permissions, so a write there is refused. */
async function closeLockedFolder() {
  await fs.mkdir(path.join(attachedDir, "locked"));
  // Settings live in the workspace's root, which the mock chats share across
  // test files, so this test keeps its own.
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(path.join(tmpDir, "workspace")),
  });
  await updatePermissionSettings((settings) => ({
    ...settings,
    folders: [
      {
        addedAt: new Date(),
        level: "never",
        path: AbsolutePathSchema.parse(path.join(attachedDir, "locked")),
      },
    ],
  }));
}

async function run(command: string) {
  const bash = await createBashEnv({
    folders: {
      Docs: {
        access: "read-write",
        id: MountedFolder.IdSchema.parse("docs-id"),
        path: ChatDirSchema.parse(attachedDir),
      },
    },
    sessionId,
    chatId,
  });
  const result = await bash.exec(real(command), {
    signal: AbortSignal.timeout(60_000),
  });
  // Reports what the sandbox said with the test's temp dirs named by token.
  const named = (text: string) =>
    text.replaceAll(attachedDir, "<docs>").replaceAll(taskRoot, "<task>");
  return {
    ...result,
    stderr: named(result.stderr),
    stdout: named(result.stdout),
  };
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
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(taskRoot), { model });
});

afterEach(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("python inside the sandbox", () => {
  it("refuses to append to a file over the read limit rather than replace it", async () => {
    const result = await run(
      `python3 -c "open('<docs>/big.bin', 'a').write('x')"`,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("File too large");
    expect((await fs.stat(path.join(attachedDir, "big.bin"))).size).toBe(
      9 * 1024 * 1024,
    );
  });

  it("walks a folder tree with Path.rglob", async () => {
    await fs.mkdir(path.join(attachedDir, "a", "b"), { recursive: true });
    await fs.writeFile(path.join(attachedDir, "a", "one.pdf"), "");
    await fs.writeFile(path.join(attachedDir, "a", "b", "two.PDF"), "");
    const result = await run(
      `python3 -c "from pathlib import Path; print(sorted(str(p) for p in Path('<docs>').rglob('*.pdf', case_sensitive=False)))"`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("['<docs>/a/b/two.PDF', '<docs>/a/one.pdf']\n");
  });

  it("exits with the script's own status", async () => {
    const ok = await run(`python -c "print(1 + 2)"`);
    expect(ok).toMatchObject({ exitCode: 0, stderr: "", stdout: "3\n" });

    const three = await run(`python3 -c "import sys; sys.exit(3)"`);
    expect(three.exitCode).toBe(3);

    const message = await run(`python -c "import sys; sys.exit('bad news')"`);
    expect(message).toMatchObject({ exitCode: 1, stderr: "bad news\n" });
  });

  it("reads a folder in place and refuses to write a closed one", async () => {
    await closeLockedFolder();
    const read = await run(
      `python -c "from pathlib import Path; print(Path('<docs>/readme.txt').read_text(), end='')"`,
    );
    expect(read).toMatchObject({ exitCode: 0, stdout: "hello docs\n" });

    const write = await run(
      `python -c "f = open('<docs>/locked/new.txt', 'w'); f.write('x'); f.close()"`,
    );
    expect(write.exitCode).toBe(1);
    expect(write.stderr).toMatchInlineSnapshot(`
      "Traceback (most recent call last):
        File "<string>", line 1, in <module>
      PermissionError: [Errno 2] Permission denied: '<docs>/locked/new.txt'
      <docs>/locked/new.txt is closed in Settings › Permissions. Don't look for another way in; tell the person what you needed it for.
      "
    `);
    await expect(
      fs.stat(path.join(attachedDir, "locked", "new.txt")),
    ).rejects.toThrow();
  });

  it("writes a folder and the chat's own alike", async () => {
    const result = await run(
      `python -c "open('<docs>/out.txt', 'w').write('mount'); open('work/out.txt', 'w').write('task')"`,
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
        File "<task>/work/report.py", line 8, in <module>
          fail()
          ~~~~^^
        File "<task>/work/report.py", line 6, in fail
          raise ValueError('boom')
      ValueError: boom
      "
    `);
  });

  it("names <string> for inline code and strips the interpreter's own frames", async () => {
    const result = await run(`python -c "open('<docs>/missing.txt')"`);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(`
      "Traceback (most recent call last):
        File "<string>", line 1, in <module>
      FileNotFoundError: [Errno 44] No such file or directory: '<docs>/missing.txt'
      "
    `);
  });

  it("sends a missing package to pip, to run again once installed", async () => {
    const result = await run(`python -c "import numpy"`);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "ModuleNotFoundError: No module named 'numpy'",
    );
    expect(result.stderr).toContain(
      "python: 'numpy' is not in the standard library, which is all this sandboxed python has. Install it with `pip install numpy` and run the script again: a program that imports an installed package runs in the task's virtualenv, as `python-native` does",
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
      `python -c "print(len(open('<docs>/big.bin', 'rb').read()))"`,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "OSError: [Errno 22] File too large: '<docs>/big.bin'",
    );
    expect(result.stderr).toContain(
      "python: this sandboxed python reads a file whole through an 8 MB bridge",
    );
    expect(result.stderr).not.toContain("No file descriptors available");
  });

  it("refuses to append to a file the bridge cannot carry rather than replace it", async () => {
    const result = await run(
      `python -c "f = open('<docs>/big.bin', 'a'); f.write('tail'); f.close()"`,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "OSError: [Errno 22] File too large: '<docs>/big.bin'",
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

  it("keeps a program in the sandbox when the package it imports is not installed", async () => {
    await fs.mkdir(
      path.join(
        taskRoot,
        ".venv",
        "lib",
        "python3.12",
        "site-packages",
        "numpy",
      ),
      { recursive: true },
    );
    const result = await run(
      `python -c "import json; print(open('<docs>/readme.txt').read().strip())"`,
    );

    expect(result).toMatchObject({ exitCode: 0, stdout: "hello docs\n" });
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
