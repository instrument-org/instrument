import { GIT_AGENT_EMAIL, GIT_AGENT_NAME } from "@instrument-org/shared";
import {
  createCommandContext,
  EMPTY_BYTES,
  encodeUtf8ToBytes,
  InMemoryFs,
} from "just-bash";
import { mkdirSync, mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  createMockTaskConfigForDir,
  MOCK_WORKSPACE_DIRS,
} from "../../test/helpers/mock-task-config";
import { collapseProgress, createGitCommand } from "./git";

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
  const command = createGitCommand(taskId);

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

  // An attached folder resolves to a quarantined path inside the task, so
  // without this the agent is told it cannot change to './mnt/<folder>' --
  // a path it never named, describing a boundary it cannot see.
  it.each([
    { args: ["-C", "/mnt/repo", "log"], label: "-C" },
    { args: ["--git-dir=/mnt/repo/.git", "log"], label: "--git-dir=" },
    { args: ["--work-tree", "/mnt/repo", "status"], label: "--work-tree" },
  ])("names the attached folder for $label", async ({ args }) => {
    const result = await command.execute(args, mockCtx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("/mnt/repo");
    expect(result.stderr).toContain("attached folder, which git cannot read");
    expect(result.stderr).not.toContain("./mnt");
  });

  it("names the attached folder when git is run from inside one", async () => {
    const result = await command.execute(
      ["log"],
      createCommandContext({
        cwd: "/mnt/repo",
        env: new Map<string, string>(),
        fs: new InMemoryFs(),
        stdin: EMPTY_BYTES,
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("/mnt/repo");
    expect(result.stderr).toContain("copy it into the task");
  });

  it("says why copying .git alone does not work", async () => {
    const result = await command.execute(
      ["-C", "/mnt/repo", "status"],
      mockCtx,
    );

    expect(result.stderr).toContain("reports every file as deleted");
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
  const command = createGitCommand(createMockTaskConfigForDir(dir));

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
