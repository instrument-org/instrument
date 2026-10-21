import { closeClaudeAccountSessions } from "@instrument-org/ai-gateway";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * What a run on the Claude account leaves in the user's real `~/.claude`:
 * Claude Code's transcripts, in a `projects/` folder named for the working
 * folder its processes ran in (the run's home), and a resume record in
 * `instrument-sessions/` per session, each naming the transcript it resumes.
 * Nothing reads either once the run's own records are reported, so both go
 * then, the records by the transcripts they name. A record is named for a
 * hash of its session, which a run cannot recompute after the fact, while
 * the transcripts are all in one folder only this run used.
 *
 * Claude Code writes the end of each session (its title, its cost) into the
 * transcript as its process exits, so the processes are closed and waited
 * for first; a folder removed while one still runs is written again.
 */
export async function removeClaudeAccountLeftovers(home = os.homedir()) {
  closeClaudeAccountSessions();
  await claudeProcessesGone();
  const config = path.join(os.userInfo().homedir, ".claude");
  const project = path.join(
    config,
    "projects",
    fs.realpathSync(home).replaceAll(/[^a-zA-Z0-9]/g, "-"),
  );
  const sessions = new Set(
    readdirOrEmpty(project)
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => name.slice(0, -".jsonl".length)),
  );
  if (sessions.size > 0) {
    const records = path.join(config, "instrument-sessions");
    for (const name of readdirOrEmpty(records)) {
      const file = path.join(records, name);
      if (sessions.has(claudeSessionOf(file) ?? "")) {
        fs.rmSync(file, { force: true });
      }
    }
  }
  fs.rmSync(project, { force: true, recursive: true });
}

/** How long the closed processes get to exit before the folder goes anyway. */
const EXIT_WAIT_MS = 10_000;

/** Until no Claude Code this process started is still running. */
async function claudeProcessesGone() {
  const deadline = Date.now() + EXIT_WAIT_MS;
  while (Date.now() < deadline && claudeChildren() > 0) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function claudeChildren(): number {
  try {
    return execFileSync("ps", ["-A", "-o", "ppid=,command="], {
      encoding: "utf8",
    })
      .split("\n")
      .filter((line) => {
        const [ppid, ...command] = line.trim().split(/\s+/);
        return (
          Number(ppid) === process.pid && command.join(" ").includes("claude")
        );
      }).length;
  } catch {
    return 0;
  }
}

function readdirOrEmpty(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function claudeSessionOf(file: string): string | undefined {
  try {
    const record: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    const id: unknown =
      typeof record === "object" && record !== null
        ? Reflect.get(record, "claudeSessionId")
        : undefined;
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}
