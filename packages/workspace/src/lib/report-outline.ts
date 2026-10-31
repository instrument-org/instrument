/**
 * A chat's records as a feedback report sends them by default: what the
 * person and the agent said and every step it took, without what it read.
 *
 * Every kind of record the app writes has a handler here naming each of its
 * fields: kept as written, written as its length (`"<2373 chars>"`), or kept
 * as the host it names. A kind with no handler keeps its keys and numbers and
 * every string goes as its length, so a new tool or note sends nothing it
 * read until someone lists what of it may go. Nothing here looks for
 * patterns in text; the one thing parsed is a shell command, through the
 * sandbox's own parser.
 */

import {
  type CommandNode,
  parse,
  type ScriptNode,
  type SimpleCommandNode,
  type StatementNode,
  type WordNode,
} from "just-bash";

/** The most of a failed step's output, or of an error, a report keeps: its end, where the error is. */
export const OUTLINE_KEPT_OUTPUT = 2000;

/** A quoted word in a command longer than this goes as its length. */
const LONG_WORD = 80;

/** Where what the agent read came from, for the person to see before they send it. */
export type OutlineSources = {
  /** Apps it got answers from, by slug. */
  apps: Set<string>;
  /** Files it read or wrote with its file tools. */
  files: number;
  /** Sites it fetched, opened, or had on screen, by host. */
  hosts: Set<string>;
};

export function emptySources(): OutlineSources {
  return { apps: new Set(), files: 0, hosts: new Set() };
}

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A value with its structure and numbers kept and every string as its length. */
function size(value: unknown): unknown {
  if (typeof value === "string") {
    return value === "" ? "" : `<${value.length} chars>`;
  }
  if (Array.isArray(value)) {
    return value.map(size);
  }
  if (isObj(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, size(item)]),
    );
  }
  return value;
}

function hostOf(url: unknown): string | undefined {
  if (typeof url !== "string") {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.host
      : undefined;
  } catch {
    return undefined;
  }
}

/** A web address as its scheme and host, with the rest as its length. */
function hostOnly(url: unknown, sources?: OutlineSources): unknown {
  const host = hostOf(url);
  if (typeof url !== "string" || !host) {
    return size(url);
  }
  sources?.hosts.add(host);
  const origin = `${url.slice(0, url.indexOf("://"))}://${host}`;
  const rest = url.slice(origin.length);
  return rest.length > 1 ? `${origin}/<${rest.length - 1} chars>` : origin;
}

/** Some fields as written, some as their host, and every other one as its length. */
function fields(
  value: Obj,
  keep: readonly string[],
  hosts: readonly string[] = [],
  sources?: OutlineSources,
): Obj {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      keep.includes(key)
        ? item
        : hosts.includes(key)
          ? hostOnly(item, sources)
          : size(item),
    ]),
  );
}

/** `fields` for a value that may not be an object, which then goes as its length. */
function pick(
  value: unknown,
  keep: readonly string[],
  hosts: readonly string[] = [],
  sources?: OutlineSources,
): unknown {
  return isObj(value) ? fields(value, keep, hosts, sources) : size(value);
}

/** An object with every string in it as its length. */
function sizeFields(value: Obj): Obj {
  return fields(value, []);
}

const capped = (text: string) => text.slice(-OUTLINE_KEPT_OUTPUT);

// ---- the command line ------------------------------------------------------

function wordText(word: WordNode): string | undefined {
  let text = "";
  for (const part of word.parts) {
    if (part.type === "Literal" || part.type === "SingleQuoted") {
      text += part.value;
    } else if (part.type === "DoubleQuoted") {
      for (const inner of part.parts) {
        if (inner.type !== "Literal") {
          return undefined;
        }
        text += inner.value;
      }
    } else {
      return undefined;
    }
  }
  return text;
}

function commandWords(command: SimpleCommandNode): string[] {
  return [command.name, ...command.args].flatMap((word) =>
    word ? [wordText(word) ?? "?"] : [],
  );
}

function forEachSimple(
  script: ScriptNode,
  visit: (command: SimpleCommandNode) => void,
) {
  const statement = (stmt: StatementNode) => {
    for (const pipeline of stmt.pipelines) {
      pipeline.commands.forEach(command);
    }
  };
  const command = (node: CommandNode) => {
    switch (node.type) {
      case "SimpleCommand": {
        visit(node);
        break;
      }
      case "For":
      case "Group":
      case "Subshell":
      case "Until":
      case "While": {
        [...("condition" in node ? node.condition : []), ...node.body].forEach(
          statement,
        );
        break;
      }
      case "If": {
        for (const clause of node.clauses) {
          [...clause.condition, ...clause.body].forEach(statement);
        }
        (node.elseBody ?? []).forEach(statement);
        break;
      }
      case "FunctionDef": {
        command(node.body);
        break;
      }
      default: {
        break;
      }
    }
  };
  script.statements.forEach(statement);
}

/** What a command carries rather than says: heredoc bodies and long quoted words, as written in the source. */
function carried(script: ScriptNode): string[] {
  const texts: string[] = [];
  forEachSimple(script, (command) => {
    for (const word of command.args) {
      for (const part of word.parts) {
        if (part.type === "SingleQuoted" && part.value.length > LONG_WORD) {
          texts.push(part.value);
        }
        if (part.type === "DoubleQuoted") {
          const inner = wordText({ parts: [part], type: "Word" });
          if (inner && inner.length > LONG_WORD) {
            texts.push(inner);
          }
        }
      }
    }
    for (const redirection of command.redirections) {
      if (redirection.target.type === "HereDoc") {
        const body = wordText(redirection.target.content);
        texts.push(body ?? "\u0000");
      }
    }
  });
  return texts;
}

/**
 * A command line as a report sends it: its words, flags and paths as
 * written, and each heredoc body and quoted word over 80 characters as its
 * length. A command the parser can't read, or whose carried text can't be
 * found in it, goes as its length.
 */
export function outlineCommand(command: string): string {
  let script: ScriptNode;
  try {
    script = parse(command);
  } catch {
    return `<${command.length} chars>`;
  }
  let out = "";
  let cursor = 0;
  for (const text of carried(script)) {
    const body = text.endsWith("\n") ? text.slice(0, -1) : text;
    const at = body === "" ? -1 : command.indexOf(body, cursor);
    if (at < 0) {
      if (body === "") {
        continue;
      }
      return `<${command.length} chars>`;
    }
    out += `${command.slice(cursor, at)}<${body.length} chars>`;
    cursor = at + body.length;
  }
  return out + command.slice(cursor);
}

/** Instrument's own commands whose output is the app's status rather than anything from outside it. */
const STATUS = new Set([
  "app catalog",
  "app new",
  "app test",
  "app tool",
  "app tools",
  "jobs",
  "tab list",
  "task list",
  "task new",
  "task send",
  "task show",
  "task stop",
]);

/** Commands that only trim what one before them printed. */
const TRIMS = new Set(["head", "tail"]);

/**
 * Whether every pipeline in a command is one of Instrument's status
 * commands, trimmed at most by `head` or `tail`.
 */
function isStatusCommand(command: string): boolean {
  let script: ScriptNode;
  try {
    script = parse(command);
  } catch {
    return false;
  }
  if (script.statements.length === 0) {
    return false;
  }
  return script.statements.every((stmt) =>
    stmt.pipelines.every((pipeline) =>
      pipeline.commands.every((node, index) => {
        if (node.type !== "SimpleCommand") {
          return false;
        }
        const words = commandWords(node);
        if (index > 0) {
          return TRIMS.has(words[0] ?? "");
        }
        const [first, second] =
          words[0] === "instrument" ? words.slice(1) : words;
        return (
          STATUS.has(`${first ?? ""} ${second ?? ""}`) ||
          STATUS.has(first ?? "")
        );
      }),
    ),
  );
}

/** Apps a command got answers from: `app call <slug>`. */
function appsCalled(command: string, sources: OutlineSources) {
  let script: ScriptNode;
  try {
    script = parse(command);
  } catch {
    return;
  }
  forEachSimple(script, (node) => {
    const words = commandWords(node);
    const [first, sub, slug] =
      words[0] === "instrument" ? words.slice(1) : words;
    if (first === "app" && sub === "call" && slug && slug !== "?") {
      sources.apps.add(slug);
    }
  });
}

// ---- tools -----------------------------------------------------------------

const SAID = ["explanation", "activity"];

function toolBash(part: Obj, sources: OutlineSources): Obj {
  const input = isObj(part.input) ? part.input : {};
  const command = typeof input.command === "string" ? input.command : "";
  appsCalled(command, sources);
  const next: Obj = {
    ...part,
    input: {
      ...fields(input, [...SAID, "yieldMs"]),
      ...(command && { command: outlineCommand(command) }),
    },
  };
  const output = part.output;
  if (isObj(output)) {
    const failed = output.exitCode !== 0 && output.exitCode !== undefined;
    const kept = fields(
      output,
      [
        "exitCode",
        "durationMs",
        "omittedBytes",
        "logOmittedBytes",
        "commands",
        "processId",
        "pids",
        "handOffs",
        "truncated",
      ],
      [],
      sources,
    );
    delete kept.command;
    if (
      typeof output.output === "string" &&
      (failed || isStatusCommand(command))
    ) {
      kept.output = capped(output.output);
    }
    if (Array.isArray(output.ran)) {
      kept.ran = output.ran.map((ran) =>
        pick(ran, ["program", "exitCode", "durationMs"]),
      );
    }
    if (output.browserSkill !== undefined) {
      kept.browserSkill = { loaded: true };
    }
    if (isObj(output.pageAfter)) {
      kept.pageAfter = pick(output.pageAfter, [], ["url"], sources);
    } else if (output.pageAfter !== undefined) {
      kept.pageAfter = hostOnly(output.pageAfter, sources);
    }
    next.output = kept;
  } else if ("output" in part) {
    next.output = size(output);
  }
  return next;
}

type ToolRule = {
  input?: readonly string[];
  inputHosts?: readonly string[];
  output?: readonly string[];
  /** Counts it among the files the chat read or wrote. */
  file?: true;
  /** Adds the app it names to where the chat's content came from. */
  app?: true;
};

/** What of each tool's input and output goes as written; the rest goes as its length. */
const TOOLS: Record<string, ToolRule> = {
  "tool-ask_permission": {
    input: ["kind", "target", "reason"],
    output: ["answer", "asked", "declined", "state"],
  },
  "tool-choose": {
    input: ["question", "choices"],
    output: ["selectedChoice", "state"],
  },
  "tool-connect_app": {
    app: true,
    input: ["slug", "reason"],
    output: ["kind", "name", "slug", "state", "site"],
  },
  "tool-edit_file": { file: true, input: ["filePath"], output: ["filePath"] },
  "tool-load_skill": { input: ["name"], output: ["skillName"] },
  "tool-read_file": {
    file: true,
    input: ["filePath", "offset", "limit"],
    output: [
      "totalLines",
      "displayedLines",
      "hasMoreLines",
      "truncated",
      "truncatedByBytes",
      "mimeType",
      "kind",
    ],
  },
  "tool-request_folder": {
    input: ["folder", "access", "reason"],
    output: ["access", "state", "declined", "mountPoint"],
  },
  "tool-unavailable": {},
  "tool-web_fetch": {
    input: ["format", "maxCharacters"],
    inputHosts: ["url"],
    output: ["status", "contentType", "truncated", "cachedAgeMs"],
  },
  "tool-write_file": {
    file: true,
    input: ["filePath"],
    output: ["filePath", "isNewFile", "bytes"],
  },
};

function toolPart(part: Obj, sources: OutlineSources): Obj {
  const type = String(part.type);
  const { callProviderMetadata: _dropped, ...rest } = part;
  let next: Obj;
  if (type === "tool-bash") {
    next = toolBash(rest, sources);
  } else if (type === "tool-web_search") {
    next = { ...rest, input: pick(rest.input, [...SAID, "query"]) };
    const results = isObj(rest.output) ? rest.output.results : undefined;
    next.output = Array.isArray(results)
      ? {
          results: results.map((result) =>
            isObj(result) ? hostOnly(result.url) : size(result),
          ),
        }
      : size(rest.output);
  } else {
    const rule = TOOLS[type];
    if (rule?.file) {
      sources.files += 1;
    }
    if (rule?.app && isObj(rest.input) && typeof rest.input.slug === "string") {
      sources.apps.add(rest.input.slug);
    }
    next = {
      ...rest,
      ...("input" in rest && {
        input: rule
          ? pick(
              rest.input,
              [...SAID, ...(rule.input ?? [])],
              rule.inputHosts,
              sources,
            )
          : size(rest.input),
      }),
      ...("rawInput" in rest && { rawInput: size(rest.rawInput) }),
      ...("output" in rest && {
        output: rule ? pick(rest.output, rule.output ?? []) : size(rest.output),
      }),
    };
  }
  if (typeof part.errorText === "string") {
    next.errorText = capped(part.errorText);
  }
  return next;
}

// ---- notes -----------------------------------------------------------------

/** App notes that carry only the app's own state, kept whole. */
const NOTES_KEPT = new Set([
  "data-adoptedTask",
  "data-appEvent",
  "data-attachedFolderChanges",
  "data-backgroundProcesses",
  "data-chatTopics",
  "data-dateChange",
  "data-environmentChange",
  "data-fromChat",
  "data-intent",
  "data-messageGap",
  "data-modelChange",
  "data-outputFormat",
  "data-permissionAnswer",
  "data-questionAnswer",
  "data-reply",
  "data-setupChanges",
  "data-skillMentions",
  "data-taskEvent",
  "data-topic",
  "data-workspaceInstructions",
]);

function notePart(part: Obj, sources: OutlineSources): Obj {
  const type = String(part.type);
  const data = part.data;
  if (NOTES_KEPT.has(type)) {
    return part;
  }
  if (!isObj(data)) {
    return { ...part, data: size(data) };
  }
  const list = (key: string): unknown[] => {
    const value: unknown = data[key];
    return Array.isArray(value) ? value.map((each: unknown) => each) : [];
  };
  switch (type) {
    case "data-memory": {
      return {
        ...part,
        data: {
          forgotten: list("forgotten").length,
          memories: list("memories").length,
        },
      };
    }
    case "data-chatContext": {
      return { ...part, data: { chats: list("chats").length } };
    }
    case "data-viewContext": {
      const page = isObj(data.page) ? data.page : undefined;
      const tabs = list("tabs").map((tab) =>
        isObj(tab) ? hostOnly(tab.url ?? tab.at, sources) : size(tab),
      );
      if (page) {
        hostOnly(page.url, sources);
      }
      return {
        ...part,
        data: {
          screen: data.screen,
          tabs,
          url: hostOf(data.url) ? hostOnly(data.url, sources) : data.url,
          ...(page && {
            page: pick(page, ["tab"], ["url"]),
          }),
        },
      };
    }
    case "data-browserStatus": {
      return {
        ...part,
        data: {
          status: data.status,
          tabs: list("tabs").map((tab) =>
            pick(
              tab,
              ["id", "openedBy", "onScreen", "heldBy"],
              ["url"],
              sources,
            ),
          ),
        },
      };
    }
    case "data-asks": {
      return {
        ...part,
        data: {
          asks: list("asks").map((ask) => pick(ask, ["instruction", "target"])),
        },
      };
    }
    case "data-attachments": {
      return {
        ...part,
        data: {
          files: list("files").map((file) => pick(file, ["mimeType", "size"])),
        },
      };
    }
    default: {
      return { ...part, data: size(data) };
    }
  }
}

// ---- records ---------------------------------------------------------------

/** Record kinds that carry only the app's own bookkeeping, kept whole. */
const RECORDS_KEPT = new Set([
  "answer",
  "card",
  "message",
  "session",
  "state",
  "stop",
  "stopped",
  "told",
]);

function outlinePart(part: Obj, sources: OutlineSources): Obj {
  const type = typeof part.type === "string" ? part.type : "";
  const { providerMetadata: _dropped, ...rest } = part;
  if (type === "text" || type === "step-start") {
    return rest;
  }
  if (type === "reasoning") {
    return withoutThinkingPart(part);
  }
  if (type === "source-url") {
    return {
      ...rest,
      title: size(rest.title),
      url: hostOnly(rest.url, sources),
    };
  }
  if (type.startsWith("tool-")) {
    return toolPart(rest, sources);
  }
  if (type.startsWith("data-")) {
    return notePart(rest, sources);
  }
  return {
    ...sizeFields(rest),
    type,
    ...("metadata" in rest && { metadata: rest.metadata }),
  };
}

/** A thinking part with its text as its length and the provider's copy of it gone. */
function withoutThinkingPart(part: Obj): Obj {
  const { providerMetadata: _dropped, ...rest } = part;
  return { ...rest, text: size(rest.text) };
}

/** One record of a session's log as the outline has it. */
export function outlineRecord(
  record: unknown,
  sources: OutlineSources,
): unknown {
  if (!isObj(record)) {
    return size(record);
  }
  const kind = typeof record.t === "string" ? record.t : "";
  if (kind === "part" && isObj(record.part)) {
    return { ...record, part: outlinePart(record.part, sources) };
  }
  if (kind === "sites") {
    for (const host of Array.isArray(record.visited) ? record.visited : []) {
      if (typeof host === "string") {
        sources.hosts.add(host);
      }
    }
    return record;
  }
  if (RECORDS_KEPT.has(kind)) {
    return record;
  }
  return { ...sizeFields(record), t: record.t };
}

/** One record of a session's log as full details have it: everything but the thinking. */
export function fullRecord(record: unknown): unknown {
  if (
    isObj(record) &&
    record.t === "part" &&
    isObj(record.part) &&
    record.part.type === "reasoning"
  ) {
    return { ...record, part: withoutThinkingPart(record.part) };
  }
  if (isObj(record) && record.t === "part" && isObj(record.part)) {
    const {
      callProviderMetadata: _a,
      providerMetadata: _b,
      ...part
    } = record.part;
    return { ...record, part };
  }
  return record;
}

function mapLines(content: string, map: (record: unknown) => unknown): string {
  return content
    .split("\n")
    .map((line) => {
      if (line.trim() === "") {
        return line;
      }
      try {
        return JSON.stringify(map(JSON.parse(line)));
      } catch {
        return `<${line.length} chars>`;
      }
    })
    .join("\n");
}

/** A session's log as the outline has it, and where what it left out came from. */
export function outlineSessionLog(
  content: string,
  sources: OutlineSources = emptySources(),
): { content: string; sources: OutlineSources } {
  return {
    content: mapLines(content, (record) => outlineRecord(record, sources)),
    sources,
  };
}

/** A session's log as full details have it: every record, thinking left out. */
export function fullSessionLog(content: string): string {
  return mapLines(content, fullRecord);
}
