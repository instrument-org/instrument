import { GIT_AGENT_EMAIL, GIT_AGENT_NAME } from "@instrument-org/shared";
import {
  createCommandContext,
  EMPTY_BYTES,
  encodeUtf8ToBytes,
  InMemoryFs,
} from "just-bash";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { FolderAttachment } from "../../schemas/folder-attachment";
import { TaskDirSchema } from "../../schemas/paths";
import {
  createMockTaskConfigForDir,
  MOCK_WORKSPACE_DIRS,
} from "../../test/helpers/mock-task-config";
import { gitBinaryPath, gitSubprocessEnv } from "../git";
import { collapseProgress } from "./exec-shim";
import { createGitCommand } from "./git";

const mockCtx = createCommandContext({
  cwd: "/task",
  env: new Map<string, string>(),
  fs: new InMemoryFs(),
  stdin: EMPTY_BYTES,
});

describe("createGitCommand arg policy", () => {
  const taskId = createMockTaskConfigForDir(
    `${MOCK_WORKSPACE_DIRS.tasks}/git-policy`,
  );
  const command = createGitCommand({ taskId });

  it.each([
    { args: ["--exec-path=/tmp/evil", "status"], flag: "--exec-path" },
    { args: ["clone", "--upload-pack", "sh", "url"], flag: "--upload-pack" },
    { args: ["push", "--receive-pack=sh"], flag: "--receive-pack" },
  ])("rejects $flag", async ({ args, flag }) => {
    const result = await command.execute(args, mockCtx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`${flag} is not allowed`);
  });

  it.each([
    {
      args: ["-c", "credential.helper=store", "fetch"],
      key: "credential.helper",
    },
    { args: ["-ccore.hooksPath=/tmp/hooks", "status"], key: "core.hooksPath" },
    { args: ["-c", "core.sshCommand=sh", "fetch"], key: "core.sshCommand" },
    { args: ["-c", "core.fsmonitor=sh", "status"], key: "core.fsmonitor" },
    {
      args: ["-c", "protocol.ext.allow=always", "clone", "u"],
      key: "protocol.ext.allow",
    },
    {
      args: ["-c", "remote.origin.uploadPack=sh", "fetch"],
      key: "remote.origin.uploadPack",
    },
    { args: ["-c", "http.proxy=http://evil", "fetch"], key: "http.proxy" },
    { args: ["-c", "include.path=/etc/gitconfig", "log"], key: "include.path" },
    { args: ["-c", "alias.st=!sh", "st"], key: "alias.st" },
    { args: ["--config-env=core.askPass=EVIL", "fetch"], key: "core.askPass" },
  ])("rejects -c $key", async ({ args, key }) => {
    const result = await command.execute(args, mockCtx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`setting ${key} is not allowed`);
  });

  it.each([
    { args: ["--config-env", "credential.helper", "EVIL", "fetch"] },
    { args: ["--config-env", "core.editor=EVIL", "commit"] },
  ])("rejects space-separated --config-env in $args", async ({ args }) => {
    const result = await command.execute(args, mockCtx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("is not allowed");
  });

  it.each([
    { args: ["config", "alias.pwn", "!sh"], key: "alias.pwn" },
    {
      args: ["config", "credential.helper", "store"],
      key: "credential.helper",
    },
    { args: ["config", "--add", "core.editor", "sh"], key: "core.editor" },
    { args: ["config", "diff.x.command", "sh"], key: "diff.x.command" },
    // git 2.46's subcommand form: `set` sits where the key would be.
    { args: ["config", "set", "alias.pwn", "!sh"], key: "alias.pwn" },
    // So does the value of any flag that takes one.
    {
      args: ["config", "--file", ".git/config", "alias.pwn", "!sh"],
      key: "alias.pwn",
    },
  ])("rejects writing $key to a repo's own config", async ({ args, key }) => {
    const result = await command.execute(args, mockCtx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`setting ${key} is not allowed`);
  });

  it.each([{ scope: "--global" }, { scope: "--system" }])(
    "rejects git config $scope",
    async ({ scope }) => {
      const result = await command.execute(
        ["config", scope, "user.name", "x"],
        mockCtx,
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`git config ${scope} is not allowed`);
    },
  );

  it.each([
    { args: ["-C", "../..", "status"] },
    { args: ["--git-dir=../../../other/.git", "log"] },
    { args: ["--work-tree", "../elsewhere", "status"] },
    // git resolves each -C relative to the previous one, so these compound.
    { args: ["-C", "..", "-C", "..", "-C", "..", "log"] },
    { args: ["config", "--file", "../../../.gitconfig", "--list"] },
    { args: ["init", "../../../outside/repo"] },
    { args: ["clone", "https://example.com/r.git", "../../outside/r"] },
    { args: ["worktree", "add", "../../outside/w"] },
  ])("rejects $args pointing outside the task", async ({ args }) => {
    const result = await command.execute(args, mockCtx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("points outside the task directory");
  });
});

// Runs the bundled dugite git for real. No network: `init` + `commit` is enough
// to prove the identity and config isolation the env overrides are there for.
describe("createGitCommand", () => {
  const dir = path.join(
    mkdtempSync(path.join(tmpdir(), "instrument-git-")),
    "git-smoke",
  );
  mkdirSync(dir, { recursive: true });
  const command = createGitCommand({
    taskId: createMockTaskConfigForDir(dir),
  });

  it("commits as the agent, ignoring the user's git identity", async () => {
    const init = await command.execute(["init", "-b", "main"], mockCtx);
    expect(init.exitCode).toBe(0);

    const commit = await command.execute(
      ["commit", "--allow-empty", "-m", "initial"],
      mockCtx,
    );
    expect(commit.exitCode).toBe(0);

    const log = await command.execute(
      ["log", "-1", "--format=%an <%ae> / %cn <%ce>"],
      mockCtx,
    );
    expect(log.stdout.trim()).toBe(
      `${GIT_AGENT_NAME} <${GIT_AGENT_EMAIL}> / ${GIT_AGENT_NAME} <${GIT_AGENT_EMAIL}>`,
    );
  });

  it("does not read the user's global config", async () => {
    const result = await command.execute(
      ["config", "--global", "--list"],
      mockCtx,
    );

    expect(result.exitCode).not.toBe(0);
    // Both streams, so the assertion cannot pass by the config simply having
    // been written to the one it does not look at.
    expect(result.stdout + result.stderr).not.toContain("user.email");
  });

  it("drops GIT_* vars the agent exported into the shell", async () => {
    const hostileCtx = {
      ...mockCtx,
      env: new Map([
        ["GIT_ALLOW_PROTOCOL", "ssh:http:https"],
        ["GIT_ASKPASS", "/bin/echo"],
        ["GIT_AUTHOR_NAME", "Someone Else"],
        // Sets any config key with no argv involved, so overriding an
        // enumerated set of GIT_* vars would not be enough.
        ["GIT_CONFIG_COUNT", "1"],
        ["GIT_CONFIG_GLOBAL", "/tmp/theirs.gitconfig"],
        ["GIT_CONFIG_KEY_0", "user.name"],
        ["GIT_CONFIG_VALUE_0", "Config Env Injection"],
        ["GIT_EXTERNAL_DIFF", "/bin/echo"],
      ]),
    };

    const clone = await command.execute(
      ["clone", "ssh://git@github.com/o/r.git", "work/ssh"],
      hostileCtx,
    );
    expect(clone.stderr).toContain("transport 'ssh' not allowed");

    await command.execute(["init", "-q", "work/env"], hostileCtx);
    const log = await command.execute(
      ["-C", "work/env", "commit", "--allow-empty", "-qm", "x"],
      hostileCtx,
    );
    expect(log.exitCode).toBe(0);

    const author = await command.execute(
      ["-C", "work/env", "log", "-1", "--format=%an"],
      hostileCtx,
    );
    expect(author.stdout.trim()).toBe(GIT_AGENT_NAME);
  });

  it("keeps core.longpaths on against a repo that turns it off", async () => {
    await command.execute(["init", "-q", "work/longpaths"], mockCtx);
    // Only read on Windows, but the precedence this proves is the whole point:
    // a clone into a deep task path fails without it, and the repo being cloned
    // is free to ship the key set to false.
    await fs.appendFile(
      path.join(dir, "work/longpaths/.git/config"),
      "[core]\n\tlongpaths = false\n",
    );

    const result = await command.execute(
      ["-C", "work/longpaths", "config", "--get", "core.longpaths"],
      mockCtx,
    );

    expect(result.stdout.trim()).toBe("true");
  });

  it("resets credential helpers that a repo's config asks for", async () => {
    await command.execute(["init", "-q", "work/cred"], mockCtx);
    // The argv guard refuses to write the key, so plant it the way the file
    // tools would and prove FORCED_CONFIG outranks it.
    await fs.appendFile(
      path.join(dir, "work/cred/.git/config"),
      '[credential]\n\thelper = "!f() { echo password=LEAKED; }; f"\n',
    );

    const result = await command.execute(
      ["-C", "work/cred", "credential", "fill"],
      {
        ...mockCtx,
        stdin: encodeUtf8ToBytes("protocol=https\nhost=github.com\n\n"),
      },
    );

    // Both streams: a credential reaching either one has escaped.
    expect(result.stdout + result.stderr).not.toContain("LEAKED");
  });

  it.each([
    { protocol: "ssh", url: "ssh://git@github.com/o/r.git" },
    { protocol: "file", url: "file:///etc" },
    { protocol: "ext", url: "ext::sh -c whoami" },
  ])("refuses to use the $protocol transport", async ({ url }) => {
    const result = await command.execute(["ls-remote", url], mockCtx);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not allowed");
  });
});

// A repository in an attached folder is reached by its mount path, which git
// is handed as the folder's real location. What the folder's access level
// decides is what git may do there, not whether it may look.
describe("createGitCommand over attached folders", () => {
  const root = mkdtempSync(path.join(tmpdir(), "instrument-git-mounts-"));
  const taskRoot = path.join(root, "task");
  const repoDir = path.join(root, "Repo");
  const workDir = path.join(root, "Work");
  mkdirSync(taskRoot, { recursive: true });
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });
  const inMount = (cwd: string) =>
    createCommandContext({
      cwd,
      env: new Map<string, string>(),
      fs: new InMemoryFs(),
      stdin: EMPTY_BYTES,
    });
  // Built when the tests run rather than when the file loads: the mock task
  // config sets one tasks directory for the whole process, and the describe
  // above resolves its own task through it until its tests have finished.
  let command: ReturnType<typeof createGitCommand>;

  beforeAll(async () => {
    command = createGitCommand({
      attachedFolders: {
        repo: {
          access: "read-only",
          createdAt: Date.now(),
          id: FolderAttachment.IdSchema.parse("repo-id"),
          mountName: "Repo",
          path: TaskDirSchema.parse(repoDir),
          source: "user",
        },
        work: {
          access: "read-write",
          createdAt: Date.now(),
          id: FolderAttachment.IdSchema.parse("work-id"),
          mountName: "Work",
          path: TaskDirSchema.parse(workDir),
          source: "user",
        },
      },
      taskId: createMockTaskConfigForDir(taskRoot),
    });
    // Seeded with the real binary directly: the command under test may not
    // write into the read-only mount, and that is the point of the test.
    for (const dir of [repoDir, workDir]) {
      await fs.writeFile(path.join(dir, "note.md"), "hello\n");
      for (const args of [
        ["init", "-q", "-b", "main"],
        ["add", "note.md"],
        ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "seed"],
      ]) {
        execFileSync(gitBinaryPath(), args, {
          cwd: dir,
          env: gitSubprocessEnv(),
        });
      }
    }
  });

  it("reads history in a read-only mount through -C", async () => {
    const result = await command.execute(
      ["-C", "/mnt/Repo", "log", "--oneline"],
      mockCtx,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("seed");
  });

  it("reads history from inside a mount as the working directory", async () => {
    const result = await command.execute(
      ["log", "--format=%s"],
      inMount("/mnt/Repo"),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("seed");
  });

  it("prints a mount's own path rather than the host location", async () => {
    const result = await command.execute(
      ["-C", "/mnt/Repo", "rev-parse", "--show-toplevel"],
      mockCtx,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("/mnt/Repo");
  });

  it.each([
    { args: ["-C", "/mnt/Repo", "commit", "--allow-empty", "-m", "x"] },
    { args: ["-C", "/mnt/Repo", "branch", "feature"] },
    { args: ["-C", "/mnt/Repo", "branch", "--unset-upstream"] },
    { args: ["-C", "/mnt/Repo", "stash"] },
    { args: ["-C", "/mnt/Repo", "config", "user.name", "x"] },
    { args: ["--git-dir=/mnt/Repo/.git", "gc"] },
  ])("refuses $args in a read-only mount", async ({ args }) => {
    const result = await command.execute(args, mockCtx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("/mnt/Repo is attached read-only");
  });

  it.each([
    { args: ["-C", "/mnt/Repo", "branch", "-a", "-vv"] },
    { args: ["-C", "/mnt/Repo", "status", "--short"] },
    { args: ["-C", "/mnt/Repo", "config", "--get", "core.bare"] },
    { args: ["-C", "/mnt/Repo", "stash", "list"] },
    { args: ["-C", "/mnt/Repo", "diff", "HEAD"] },
  ])("allows the listing form $args in a read-only mount", async ({ args }) => {
    const result = await command.execute(args, mockCtx);

    expect(result.stderr).not.toContain("attached read-only");
    expect(result.exitCode).toBe(0);
  });

  it("commits in a read-and-write mount", async () => {
    const commit = await command.execute(
      ["commit", "--allow-empty", "-m", "from the task"],
      inMount("/mnt/Work"),
    );
    expect(commit.exitCode).toBe(0);

    const log = await command.execute(
      ["-C", "/mnt/Work", "log", "--format=%s", "-1"],
      mockCtx,
    );
    expect(log.stdout.trim()).toBe("from the task");
  });

  it("still refuses a relative path that leaves the mount", async () => {
    const result = await command.execute(
      ["-C", "../..", "status"],
      inMount("/mnt/Repo"),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("points outside the task directory");
  });

  it("refuses a mount that is not attached", async () => {
    const result = await command.execute(["-C", "/mnt/Other", "log"], mockCtx);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).not.toContain(root);
  });
});

describe("collapseProgress", () => {
  it("keeps only the last state of a carriage-return progress line", () => {
    const output =
      "Cloning into 'r'...\n" +
      "Updating files:   1% (1/99)\rUpdating files:  50% (50/99)\r" +
      "Updating files: 100% (99/99), done.\n";

    expect(collapseProgress(output)).toMatchInlineSnapshot(`
      "Cloning into 'r'...
      Updating files: 100% (99/99), done.
      "
    `);
  });

  it("leaves windows line endings and plain output alone", () => {
    const output = "first\r\nsecond\nthird\r\n";

    expect(collapseProgress(output)).toBe(output);
  });
});
