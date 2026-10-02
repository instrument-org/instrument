import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ulid } from "ulid";

import { gitBinaryPath, gitSubprocessEnv } from "../../src/lib/git";
import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

/**
 * `git` reaches an attached folder by its mount path, so the history of a
 * repository the user attached is read where it is. Before that, the refusal
 * told the agent to copy the whole repository into the task first, and three
 * tasks in one afternoon each started a multi-gigabyte copy for a `git log`.
 *
 * The repository is built when the cases load, since a `.git` directory
 * cannot be committed as a fixture. Five commits with distinct subjects, so a
 * reply that read the history can be told from one that guessed at it.
 */
const SUBJECTS = [
  "seed the ledger with the opening balance",
  "record the March invoices",
  "correct the vendor name on invoice 41",
  "add the quarterly summary",
  "note the audit questions for April",
];

async function buildRepository(): Promise<string> {
  const dir = path.join(os.tmpdir(), `git-over-mounts-${ulid()}`, "Ledger");
  await fs.mkdir(dir, { recursive: true });
  const git = (...args: string[]) => {
    execFileSync(gitBinaryPath(), args, {
      cwd: dir,
      env: {
        ...gitSubprocessEnv(),
        GIT_AUTHOR_DATE: "2026-09-01T09:00:00Z",
        GIT_COMMITTER_DATE: "2026-09-01T09:00:00Z",
      },
      stdio: "ignore",
    });
  };
  git("init", "-q", "-b", "main");
  for (const [index, subject] of SUBJECTS.entries()) {
    await fs.writeFile(path.join(dir, "ledger.md"), `entry ${index + 1}\n`);
    git("add", "ledger.md");
    git(
      "-c",
      "user.name=Ledger",
      "-c",
      "user.email=ledger@example.com",
      "commit",
      "-qm",
      subject,
    );
  }
  return dir;
}

const REPOSITORY = await buildRepository();

function bashCommands(sessions: Session.WithMessagesAndParts[]): string[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) => {
        if (part.type !== "tool-bash") {
          return [];
        }
        const command: string | undefined = part.input?.command;
        return command === undefined ? [] : [command];
      }),
    ),
  );
}

function replyText(sessions: Session.WithMessagesAndParts[]): string {
  return sessions
    .flatMap((session) => session.messages)
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.parts)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
}

/** git was pointed at the mount, by `-C` or by changing into it. */
const ranGitOnTheMount: Assertion = {
  check: ({ sessions }) => {
    const runs = bashCommands(sessions).filter(
      (command) => /\bgit\b/.test(command) && command.includes("/mnt/Ledger"),
    );
    return {
      evidence:
        runs.length > 0
          ? `git ran against the mount ${runs.length}x: ${(runs[0] ?? "").slice(0, 200)}`
          : `No git command named /mnt/Ledger. Commands: ${bashCommands(sessions).join(" | ").slice(0, 400)}`,
      passed: runs.length > 0,
      text: "ran git on the mounted repository",
    };
  },
  text: "ran git on the mounted repository",
};

/** The copy the refusal used to ask for is the step this no longer needs. */
const neverCopiedTheRepository: Assertion = {
  check: ({ sessions }) => {
    const copies = bashCommands(sessions).filter((command) =>
      /\b(?:cp|rsync)\b[^|;&]*\/mnt\/Ledger/.test(command),
    );
    return {
      evidence:
        copies.length === 0
          ? "No copy of /mnt/Ledger into the task"
          : `Copied the mount first: ${copies.join(" | ").slice(0, 300)}`,
      passed: copies.length === 0,
      text: "read the repository where it is",
    };
  },
  text: "read the repository where it is",
};

/** The reply carries the subjects only the history holds. */
const replyNamesTheCommits: Assertion = {
  check: ({ sessions }) => {
    const text = replyText(sessions).toLowerCase();
    const found = SUBJECTS.filter((subject) =>
      text.includes(subject.toLowerCase()),
    );
    return {
      evidence: `${found.length} of ${SUBJECTS.length} subjects appear in the reply`,
      passed: found.length >= 4,
      text: "reply names the commits",
    };
  },
  text: "reply names the commits",
};

export const GIT_OVER_MOUNTS_EVALS = [
  defineEval({
    assertions: [
      ranGitOnTheMount,
      neverCopiedTheRepository,
      replyNamesTheCommits,
    ],
    folders: [{ access: "read-only", path: REPOSITORY }],
    name: "git-reads-history-in-the-mount",
    prompt:
      "My Ledger folder is a git repository. List its commits, oldest first, one line each with the subject. Just the list in your reply; no files.",
  }),
];
