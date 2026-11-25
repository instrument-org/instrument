// PreToolUse hook on Bash: refuses the git commands that throw away or take in
// other sessions' uncommitted edits when they would run in this repository's
// primary checkout, where several sessions work at once. Worktrees are free.
// `PRIMARY_OK=1` in front of the command lets it through once the person has
// said so. Anything unexpected lets the command run.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Token = string | { op: string };

const OPERATORS = new Set([";", "&&", "||", "|", "&", "\n", "(", ")"]);

/** Words and operators, with quotes resolved; enough of the shell for git commands. */
export function tokenize(command: string): Token[] {
  const tokens: Token[] = [];
  let word: string | undefined;
  let i = 0;
  const push = () => {
    if (word !== undefined) tokens.push(word);
    word = undefined;
  };
  while (i < command.length) {
    const c = command.charAt(i);
    if (c === "'") {
      const end = command.indexOf("'", i + 1);
      word = (word ?? "") + command.slice(i + 1, end === -1 ? undefined : end);
      i = end === -1 ? command.length : end + 1;
    } else if (c === '"') {
      let j = i + 1;
      let text = "";
      while (j < command.length && command.charAt(j) !== '"') {
        if (command.charAt(j) === "\\" && j + 1 < command.length) j += 1;
        text += command.charAt(j);
        j += 1;
      }
      word = (word ?? "") + text;
      i = j + 1;
    } else if (c === "\\" && command.charAt(i + 1) === "\n") {
      i += 2;
    } else if (c === "\\") {
      word = (word ?? "") + command.charAt(i + 1);
      i += 2;
    } else if (c === " " || c === "\t") {
      push();
      i += 1;
    } else if (c === "#" && word === undefined) {
      while (i < command.length && command.charAt(i) !== "\n") i += 1;
    } else {
      const two = command.slice(i, i + 2);
      if (two === "&&" || two === "||") {
        push();
        tokens.push({ op: two });
        i += 2;
      } else if (OPERATORS.has(c)) {
        push();
        tokens.push({ op: c });
        i += 1;
      } else {
        word = (word ?? "") + c;
        i += 1;
      }
    }
  }
  push();
  return tokens;
}

/** What makes a git command unsafe in a shared checkout, or undefined. */
export function refusal(args: string[], env: Set<string>): string | undefined {
  const [sub, ...rest] = args;
  const has = (...flags: string[]) => rest.some((arg) => flags.includes(arg));
  const shortFlag = (letter: string) =>
    rest.some((arg) => /^-[a-zA-Z]+$/.test(arg) && arg.includes(letter));
  switch (sub) {
    case "stash":
      return rest[0] === "list" || rest[0] === "show"
        ? undefined
        : "git stash takes every session's edits out of the files";
    case "restore":
      return has("--staged", "-S") && !has("--worktree", "-W")
        ? undefined
        : "git restore discards edits in the files, whoever made them";
    case "checkout":
    case "switch":
      return `git ${sub} rewrites files every session here is editing`;
    case "reset":
      return has("--hard", "--merge", "--keep")
        ? "git reset --hard discards every session's edits"
        : undefined;
    case "clean":
      return shortFlag("f") || has("--force")
        ? "git clean deletes files other sessions just created"
        : undefined;
    case "add":
      return !env.has("GIT_INDEX_FILE") &&
        (has("-A", "--all", ".", ":/") || shortFlag("A"))
        ? "git add -A stages other sessions' edits into the shared index"
        : undefined;
    case "commit":
      if (has("--amend")) {
        return "git commit --amend takes in whatever the shared index holds";
      }
      return has("--all") || shortFlag("a")
        ? "git commit -a commits other sessions' edits"
        : undefined;
    default:
      return undefined;
  }
}

function resolveDir(from: string, target: string): string {
  const expanded =
    target === "~" || target.startsWith("~/")
      ? path.join(os.homedir(), target.slice(1))
      : target;
  return path.resolve(from, expanded);
}

/** Each git command in a command line, with the folder it runs in. */
export function gitCommands(
  command: string,
  cwd: string,
): { args: string[]; dir: string; env: Set<string> }[] {
  const found: { args: string[]; dir: string; env: Set<string> }[] = [];
  let dir = cwd;
  let segment: string[] = [];
  const finish = () => {
    const env = new Set<string>();
    let words = segment;
    for (
      let first = words[0];
      first !== undefined && /^[A-Za-z_][A-Za-z0-9_]*=/.test(first);
      first = words[0]
    ) {
      env.add(first.slice(0, first.indexOf("=")));
      words = words.slice(1);
    }
    if (words[0] === "cd" && words[1] !== undefined) {
      dir = resolveDir(dir, words[1]);
    } else if (words[0] === "git" || words[0]?.endsWith("/git")) {
      let gitDir = dir;
      let i = 1;
      for (let word = words[i]; word?.startsWith("-"); word = words[i]) {
        const value = words[i + 1];
        if (word === "-C" && value !== undefined) {
          gitDir = resolveDir(gitDir, value);
          i += 2;
        } else if (word === "-c") {
          i += 2;
        } else {
          i += 1;
        }
      }
      found.push({ args: words.slice(i), dir: gitDir, env });
    }
    segment = [];
  };
  for (const token of tokenize(command)) {
    if (typeof token === "string") {
      segment.push(token);
    } else {
      finish();
    }
  }
  finish();
  return found;
}

function realpath(file: string): string | undefined {
  try {
    return fs.realpathSync(file);
  } catch {
    return undefined;
  }
}

/** Whether `dir` is inside this repository's primary checkout rather than a worktree. */
function inPrimaryCheckout(dir: string, repoRoot: string): boolean {
  if (!fs.existsSync(dir)) return false;
  const [gitDir = "", commonDir = ""] = execFileSync(
    "git",
    [
      "-C",
      dir,
      "rev-parse",
      "--path-format=absolute",
      "--git-dir",
      "--git-common-dir",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  )
    .trim()
    .split("\n");
  const primary = realpath(path.join(repoRoot, ".git"));
  return realpath(gitDir) === primary && realpath(commonDir) === primary;
}

function main() {
  // The hook's input, of which only these two fields are read.
  const input = JSON.parse(fs.readFileSync(0, "utf8")) as {
    cwd?: unknown;
    tool_input?: { command?: unknown };
  };
  const command = input.tool_input?.command;
  if (typeof command !== "string" || /(^|\s)PRIMARY_OK=1\s/.test(command)) {
    return;
  }
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  for (const { args, dir, env } of gitCommands(command, cwd)) {
    const why = refusal(args, env);
    if (why === undefined || !inPrimaryCheckout(dir, repoRoot)) continue;
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `Refused in the primary checkout: ${why}, and other sessions have uncommitted edits here. Work in a worktree of your own (git worktree add), and commit one path's change with scripts/commit.sh. To discard or switch anything here, ask the person first; once they say so, run the command again with PRIMARY_OK=1 in front of it.`,
        },
      }),
    );
    return;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch {
    // A guard that cannot read its input lets the command run.
  }
}
