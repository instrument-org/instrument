import { defineCommand } from "just-bash";

import {
  type ImportFrom,
  type ListedCandidate,
  type RunImportOutput,
} from "../chat-import/model";
import { listCandidates, type OpenSource, runImport } from "../chat-import/run";
import { listSources, openSource } from "../chat-import/sources";
import { hostPathOf } from "../workspace-fs-layout";
import { IMPORT_COMMAND } from "./import-command";
import {
  defineSubcommands,
  subcommand,
  type SubcommandInput,
  type SubcommandShell,
} from "./subcommands";

export { IMPORT_COMMAND } from "./import-command";

const NAME = IMPORT_COMMAND.name;

const LOCAL_KINDS = ["claude-code", "codex", "cursor"] as const;

/** How many chats `list` prints when not told. */
const DEFAULT_LIMIT = 30;

/** The most `list` prints, however many it is asked for. */
const MAX_LIMIT = 200;

/** The most imported chats `add` names one by one. */
const MAX_NAMED = 30;

const TITLE_MAX = 80;

const USAGE = `Usage: ${NAME} <subcommand> ...

  ${NAME} sources
      What this computer has chats to import from.
  ${NAME} list <source> [--search <words>] [--since <date>] [--limit <n>] [--incidental]
      The source's chats, newest first: id, date of the last message, message
      count, title, and "imported" on one already brought in. <source> is
      claude-code, codex or cursor, or the path to a ChatGPT or Claude export
      (the .zip, or the folder it was unpacked to). --search keeps chats with
      every word in the title, opening words or project; --since keeps chats
      active on or after a date (2025-03-01). Runs a coding agent made on its
      own (subagents, sessions with no reply) are left out unless
      --incidental.
  ${NAME} add <source> <id>...
  ${NAME} add <source> --all-matching [--search <words>] [--since <date>] [--incidental]
      Bring chats in, each a chat of its own dated when it happened, its
      words only (tool calls and attachments are named, not brought). One
      already imported is skipped.
`;

/** What `import` needs from the shell it runs in. */
export interface ImportCommandContext {
  /** Opens a source; a test hands in its own. */
  open?: OpenSource;
  /** Why the agent may not read a path, or nothing where it may. */
  refusal: (path: string) => string | undefined;
}

const FILTER_FLAGS = ["search", "since", "limit"] as const;

/** `instrument import` run on its arguments, for the command and its tests. */
export const runImportCommand = defineSubcommands<ImportCommandContext>({
  bare: "sources",
  name: NAME,
  subcommands: {
    add: subcommand({
      booleans: ["all-matching", "incidental"],
      flags: FILTER_FLAGS,
      run: (input, context, shell) => runAdd(input, context, shell),
    }),
    list: subcommand({
      booleans: ["incidental"],
      flags: FILTER_FLAGS,
      positional: 1,
      run: (input, context, shell) => runList(input, context, shell),
    }),
    sources: subcommand({ positional: 0, run: () => runSources() }),
  },
  usage: USAGE,
});

/**
 * The chat's way of bringing the user's chats in from other AI apps: list
 * what a source has, find the ones they mean, and add them. The parsers
 * decide what lands; this only picks.
 */
export function createImportCommand(context: ImportCommandContext) {
  return defineCommand(NAME, (args, ctx) =>
    runImportCommand(args, context, ctx),
  );
}

async function runSources(): Promise<string> {
  const sources = await listSources();
  const lines = sources.map(
    (source) =>
      `  ${source.from.type === "local" ? source.from.kind : source.kind}  ${source.name} (${source.location})`,
  );
  return [
    sources.length === 0
      ? "No coding agent on this computer has chats to import."
      : `On this computer (${NAME} list <source> for its chats):\n${lines.join("\n")}`,
    "ChatGPT and Claude chats come from an export the user asks for in that app's settings (ChatGPT: Settings > Data controls > Export; Claude: Settings > Privacy > Export data). Once the zip is here, its path is the source.",
    "",
  ].join("\n");
}

async function runList(
  input: SubcommandInput,
  context: ImportCommandContext,
  shell: SubcommandShell,
): Promise<string> {
  const word = input.positional[0];
  if (!word) {
    throw new Error(`list: which source? ${NAME} sources names them.`);
  }
  const from = await sourceOf(word, context, shell);
  const { candidates, source } = await listed(from, context);
  const { kept, leftOut } = filtered(candidates, input);
  const limit = limitOf(input);
  const shown = kept.slice(0, limit);
  const lines = [
    `${source.name}: ${counted(kept.length, "chat")}${input.has("search") || input.has("since") ? " match" : ""}, newest first.${kept.length > shown.length ? ` Showing ${shown.length}; narrow with --search or --since, or raise --limit (up to ${MAX_LIMIT}).` : ""}`,
    ...shown.map(candidateLine),
  ];
  if (leftOut > 0) {
    lines.push(
      `${counted(leftOut, "run")} the agent made on its own left out; --incidental lists them.`,
    );
  }
  if (shown.length > 0) {
    lines.push(`${NAME} add ${word} <id>... brings chats in.`);
  }
  return `${lines.join("\n")}\n`;
}

async function runAdd(
  input: SubcommandInput,
  context: ImportCommandContext,
  shell: SubcommandShell,
): Promise<string> {
  const [word, ...ids] = input.positional;
  if (!word) {
    throw new Error(`add: which source? ${NAME} sources names them.`);
  }
  const all = input.has("all-matching");
  if (all === ids.length > 0) {
    throw new Error(
      all
        ? "add: give ids or --all-matching, not both."
        : `add: which chats? Give their ids from ${NAME} list ${word}, or --all-matching with --search or --since.`,
    );
  }
  const from = await sourceOf(word, context, shell);
  const { candidates } = await listed(from, context);
  const sourceIds = all
    ? filtered(candidates, input)
        .kept.slice(0, input.has("limit") ? limitOf(input) : undefined)
        .map((candidate) => candidate.sourceId)
    : ids;
  if (sourceIds.length === 0) {
    return "No chats match, so nothing was imported.\n";
  }
  const result = await runImport(
    { from, sourceIds },
    { ...(context.open && { open: context.open }) },
  );
  if (result.isErr()) {
    throw new Error(result.error.message);
  }
  return addReport(result.value, candidates);
}

function addReport(
  { failed, imported, skipped }: RunImportOutput,
  candidates: ListedCandidate[],
): string {
  const titles = new Map(
    candidates.map((candidate) => [candidate.sourceId, candidate.title]),
  );
  const lines = [
    [
      `Imported ${counted(imported.length, "chat")}`,
      ...(skipped.length > 0 ? [`skipped ${skipped.length} already here`] : []),
      ...(failed.length > 0 ? [`${failed.length} failed`] : []),
    ].join(", ") + ".",
    ...imported
      .slice(0, MAX_NAMED)
      .map(
        ({ chatId, sourceId }) =>
          `  ${sourceId} -> chat ${chatId}  ${shortTitle(titles.get(sourceId) ?? "")}`,
      ),
  ];
  if (imported.length > MAX_NAMED) {
    lines.push(`  ...and ${imported.length - MAX_NAMED} more.`);
  }
  for (const { error, sourceId } of failed) {
    lines.push(`  failed ${sourceId}: ${error}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * A source as the agent names it: a coding agent by its kind, or an export by
 * its path, which the agent has to be able to read.
 */
async function sourceOf(
  word: string,
  context: ImportCommandContext,
  shell: SubcommandShell,
): Promise<ImportFrom> {
  const kind = LOCAL_KINDS.find((each) => each === word);
  if (kind) {
    return { kind, type: "local" };
  }
  const resolved = shell.fs.resolvePath(shell.cwd, word);
  const refusal = context.refusal(resolved);
  if (refusal !== undefined) {
    throw new Error(`${word}: Permission denied\n${refusal}`);
  }
  if (!(await shell.fs.exists(resolved))) {
    throw new Error(
      `no file at ${word}. A source is ${LOCAL_KINDS.join(", ")}, or the path to a ChatGPT or Claude export.`,
    );
  }
  return { path: hostPathOf(resolved), type: "export" };
}

async function listed(from: ImportFrom, context: ImportCommandContext) {
  const result = await listCandidates(from, context.open ?? openSource);
  if (result.isErr()) {
    throw new Error(result.error.message);
  }
  return result.value;
}

/** The candidates the filters keep, and how many incidental runs they left out. */
function filtered(
  candidates: ListedCandidate[],
  input: SubcommandInput,
): { kept: ListedCandidate[]; leftOut: number } {
  const words = (input.value("search") ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const sinceText = input.value("since");
  const since = sinceText === undefined ? undefined : new Date(sinceText);
  if (sinceText !== undefined && since && Number.isNaN(since.getTime())) {
    throw new Error(`--since ${sinceText} is not a date; write it 2025-03-01.`);
  }
  const incidental = input.has("incidental");
  let leftOut = 0;
  const kept = candidates.filter((candidate) => {
    if (since && candidate.updatedAt < since) {
      return false;
    }
    const haystack = [candidate.title, candidate.preview, candidate.project]
      .join(" ")
      .toLowerCase();
    if (!words.every((each) => haystack.includes(each))) {
      return false;
    }
    if (candidate.incidental && !incidental) {
      leftOut += 1;
      return false;
    }
    return true;
  });
  return { kept, leftOut };
}

function limitOf(input: SubcommandInput): number {
  const text = input.value("limit");
  if (text === undefined) {
    return DEFAULT_LIMIT;
  }
  const limit = Number(text);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`--limit ${text} is not a count.`);
  }
  return Math.min(limit, MAX_LIMIT);
}

function candidateLine(candidate: ListedCandidate): string {
  return [
    candidate.sourceId,
    day(candidate.updatedAt),
    counted(candidate.messages, "msg"),
    shortTitle(candidate.title),
    ...(candidate.project ? [`[${candidate.project}]`] : []),
    ...(candidate.imported ? [`imported as chat ${candidate.imported}`] : []),
  ].join("  ");
}

function shortTitle(title: string): string {
  const flat = title.replaceAll(/\s+/g, " ").trim() || "(untitled)";
  return flat.length > TITLE_MAX ? `${flat.slice(0, TITLE_MAX - 1)}…` : flat;
}

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
