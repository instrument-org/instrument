import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { type ChatId } from "../../schemas/chat-id";
import { type StoreId } from "../../schemas/store-id";
import { appReach, scriptTargets } from "./apps";
import { raiseAsk, waitingNote } from "./asks";
import { folderToAskFor, reachOf, type Rules } from "./rules";

/** Commands whose path arguments are what they change. */
const CHANGES_ITS_ARGUMENTS = new Set(["mkdir", "rm", "rmdir", "tee", "touch"]);
/** Commands that change only their last path argument. */
const CHANGES_ITS_LAST = new Set(["cp", "ln", "mv", "rsync"]);

/**
 * A command line in words, quotes taken off, with each control operator
 * (`;`, `&&`, `|`, `>`) as a word of its own. Close enough to how a shell
 * reads it to find the paths a command names; anything it misreads is left
 * to the refusal a running command meets.
 */
function words(command: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  const flush = () => {
    if (current) {
      out.push(current);
    }
    current = "";
  };
  for (let index = 0; index < command.length; index++) {
    const char = command[index] ?? "";
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      flush();
    } else if (";&|<>()".includes(char)) {
      flush();
      const next = command[index + 1] ?? "";
      if ((char === ">" || char === "&" || char === "|") && next === char) {
        out.push(char + next);
        index++;
      } else {
        out.push(char);
      }
    } else {
      current += char;
    }
  }
  flush();
  return out;
}

/** The paths a command names, each with whether the command changes it. */
export function commandPaths(
  command: string,
): { op: "read" | "write"; path: string }[] {
  const found: { op: "read" | "write"; path: string }[] = [];
  const segments: string[][] = [[]];
  let redirect = false;
  for (const word of words(command)) {
    if (word === ">" || word === ">>") {
      redirect = true;
      continue;
    }
    if (/^(?:;|&&|\|\||\||&|\(|\)|<)$/.test(word)) {
      segments.push([]);
      continue;
    }
    if (redirect) {
      found.push({ op: "write", path: word });
      redirect = false;
      continue;
    }
    segments.at(-1)?.push(word);
  }
  for (const [name = "", ...args] of segments) {
    const positional = args.filter((arg) => !arg.startsWith("-"));
    positional.forEach((arg, index) => {
      if (!/^(?:\/|~\/|\.\.?\/)/.test(arg)) {
        return;
      }
      const changes =
        CHANGES_ITS_ARGUMENTS.has(name) ||
        (CHANGES_ITS_LAST.has(name) && index === positional.length - 1);
      found.push({ op: changes ? "write" : "read", path: arg });
    });
  }
  return found;
}

/**
 * Before a command runs: the folders and apps it names that the person has
 * to allow first. Each is raised as a card under the call, and the answer is
 * what the agent reads in place of running it. Undefined when nothing it
 * names asks, and the command runs as written.
 */
export async function preflightCommand({
  chatId,
  command,
  cwd,
  partId,
  rules,
  sessionId,
}: {
  chatId: ChatId;
  command: string;
  /** Where the command starts, as a host path. */
  cwd: string;
  partId: StoreId.Part;
  rules: Rules;
  sessionId: StoreId.Session;
}): Promise<string | undefined> {
  const asker = { chatId, partId, sessionId };
  const asked: string[] = [];
  for (const named of commandPaths(command)) {
    const hostPath = path.resolve(
      cwd,
      named.path.startsWith("~/")
        ? path.join(os.homedir(), named.path.slice(2))
        : named.path,
    );
    const reach = reachOf(rules, hostPath, named.op);
    if (reach.level !== "ask") {
      continue;
    }
    const folder = folderToAskFor({
      home: rules.home,
      hostPath,
      isDirectory: existsSync(hostPath) && statSync(hostPath).isDirectory(),
      rule: reach.rule,
    });
    if (!asked.includes(folder)) {
      raiseAsk(asker, "folder", folder);
      asked.push(folder);
    }
  }
  if (/\bosascript\b/.test(command)) {
    for (const app of scriptTargets(command)) {
      if ((await appReach(chatId, app)) === "ask" && !asked.includes(app)) {
        raiseAsk(asker, "app", app);
        asked.push(app);
      }
    }
  }
  if (asked.length === 0) {
    return undefined;
  }
  const shown = asked.map((what) =>
    what.startsWith(`${rules.home}/`)
      ? `~/${what.slice(rules.home.length + 1)}`
      : what,
  );
  return `Nothing ran. ${waitingNote(shown.join(" and "))}`;
}
