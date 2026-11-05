/**
 * A chat's records as a feedback report sends them: what the
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

/** The most of a tool's error a report keeps: its end, where the error is. */
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

/** Every node type just-bash's parser writes; a command holding any other goes as its length. */
const AST_TYPES = new Set([
  "ArithArrayElement",
  "ArithAssignment",
  "ArithBinary",
  "ArithBracedExpansion",
  "ArithCommandSubst",
  "ArithConcat",
  "ArithDoubleSubscript",
  "ArithDynamicAssignment",
  "ArithDynamicBase",
  "ArithDynamicElement",
  "ArithDynamicNumber",
  "ArithGroup",
  "ArithNested",
  "ArithNumber",
  "ArithNumberSubscript",
  "ArithSingleQuote",
  "ArithSpecialVar",
  "ArithSyntaxError",
  "ArithTernary",
  "ArithUnary",
  "ArithVariable",
  "ArithmeticCommand",
  "ArithmeticExpansion",
  "ArithmeticExpression",
  "ArrayKeys",
  "AssignDefault",
  "Assignment",
  "BadSubstitution",
  "BraceExpansion",
  "CStyleFor",
  "Case",
  "CaseItem",
  "CaseModification",
  "CommandSubstitution",
  "CondAnd",
  "CondBinary",
  "CondGroup",
  "CondNot",
  "CondOr",
  "CondUnary",
  "CondWord",
  "ConditionalCommand",
  "DefaultValue",
  "DoubleQuoted",
  "ErrorIfUnset",
  "Escaped",
  "For",
  "FunctionDef",
  "Glob",
  "Group",
  "If",
  "Indirection",
  "Length",
  "LengthSliceError",
  "Literal",
  "ParameterExpansion",
  "PatternRemoval",
  "PatternReplacement",
  "Pipeline",
  "ProcessSubstitution",
  "Range",
  "Redirection",
  "Script",
  "SimpleCommand",
  "SingleQuoted",
  "Statement",
  "Subshell",
  "Substring",
  "TildeExpansion",
  "Transform",
  "Until",
  "UseAlternative",
  "VarNamePrefix",
  "While",
  "Word",
]);

/** The string fields of a node that hold text as written: a literal, a quoted string, a glob. */
const TEXT_FIELDS = new Set(["pattern", "value"]);

type Carried = {
  /** Heredocs in the order the parser met them, by their closing word. */
  heredocs: { delimiter: string; stripTabs: boolean }[];
  /** Text over 80 characters written in the command itself. */
  long: string[];
};

/**
 * What a command carries rather than says, from every node of its syntax
 * tree: each heredoc, wherever it is, and every piece of text over 80
 * characters (an argument, an assignment's value, a word inside a command
 * substitution or a `[[ ]]` test). Undefined when the tree holds a node this
 * walk doesn't know, so the whole command goes as its length.
 */
function carried(script: ScriptNode): Carried | undefined {
  const found: Carried = { heredocs: [], long: [] };
  let known = true;
  const visit = (value: unknown) => {
    if (!known) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isObj(value)) {
      return;
    }
    if (typeof value.type === "string") {
      if (value.type === "HereDoc") {
        found.heredocs.push({
          delimiter: String(value.delimiter),
          stripTabs: value.stripTabs === true,
        });
        // Its body is sized whole from the source, expansions and all.
        return;
      }
      if (!AST_TYPES.has(value.type)) {
        known = false;
        return;
      }
    }
    for (const [key, item] of Object.entries(value)) {
      if (
        TEXT_FIELDS.has(key) &&
        typeof item === "string" &&
        item.length > LONG_WORD
      ) {
        found.long.push(item);
      } else if (typeof item === "object") {
        visit(item);
      }
    }
  };
  visit(script);
  return known ? found : undefined;
}

const escapeRegExp = (text: string) =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The command with each heredoc's body as its length, found in the source
 * in the order the parser met them: an opener (`<<'EOF'`), the lines after
 * the line it is on, and the closing word on a line of its own. Undefined
 * when one can't be found as the parser read it.
 */
function sizeHeredocs(
  command: string,
  heredocs: Carried["heredocs"],
): string | undefined {
  let out = "";
  let opened = 0;
  let bodyFrom = 0;
  for (const { delimiter, stripTabs } of heredocs) {
    const name = escapeRegExp(delimiter);
    const opener = new RegExp(`<<-?\\s*(['"]?)${name}\\1`, "g");
    opener.lastIndex = opened;
    const open = opener.exec(command);
    if (!open) {
      return undefined;
    }
    opened = open.index + open[0].length;
    const lineEnd = command.indexOf("\n", Math.max(opened, bodyFrom));
    if (lineEnd < 0) {
      return undefined;
    }
    const start = lineEnd + 1;
    const closer = new RegExp(`^${stripTabs ? "\\t*" : ""}${name}$`, "gm");
    closer.lastIndex = start;
    const close = closer.exec(command);
    const end = close ? close.index : command.length;
    // The newline before the closing word belongs to the body.
    const body = command.slice(start, close ? Math.max(start, end - 1) : end);
    out += `${command.slice(bodyFrom, start)}<${body.length} chars>`;
    bodyFrom = start + body.length;
    opened = Math.max(opened, close ? close.index + close[0].length : end);
  }
  return out + command.slice(bodyFrom);
}

/**
 * A command line as a report sends it: its words, flags and paths as
 * written, and each heredoc body and any piece of text over 80 characters
 * as its length. A command the parser can't read, that holds a node the
 * walk doesn't know, or whose carried text can't be found in it, goes as
 * its length.
 */
export function outlineCommand(command: string): string {
  const whole = `<${command.length} chars>`;
  let script: ScriptNode;
  try {
    script = parse(command);
  } catch {
    return whole;
  }
  const found = carried(script);
  if (!found) {
    return whole;
  }
  let out = sizeHeredocs(command, found.heredocs);
  if (out === undefined) {
    return whole;
  }
  for (const text of found.long.toSorted((a, b) => b.length - a.length)) {
    const at = out.indexOf(text);
    if (at < 0) {
      return whole;
    }
    out = `${out.slice(0, at)}<${text.length} chars>${out.slice(at + text.length)}`;
  }
  return out;
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

/**
 * A tool part's own bookkeeping as written and every other field (its input,
 * output, raw input, anything a later build adds) as its length, for each
 * handler to fill in what of it goes.
 */
function envelope(part: Obj): Obj {
  return fields(part, [
    "type",
    "toolCallId",
    "state",
    "metadata",
    "preliminary",
    "providerExecuted",
  ]);
}

const SAID = ["explanation", "activity"];

/**
 * What of a `ran` row goes as written (`CommandRunSchema`): a command's name
 * is no more than `program` says, the source, sandbox and reason are enums,
 * and `stderr` is the end of a failed run's, for every program alike.
 */
const RUN_FIELDS = [
  "count",
  "durationMs",
  "exitCode",
  "failed",
  "name",
  "program",
  "reason",
  "sandbox",
  "source",
  "stderr",
];

/**
 * A call's `output` is what the agent read, so it goes as its length for every
 * command, however it ended (`cat missing mail.txt` prints the mail and exits
 * 1). How a call failed goes in `stderr` and in its `ran` rows.
 */
function toolBash(part: Obj, sources: OutlineSources): Obj {
  const input = isObj(part.input) ? part.input : {};
  const command = typeof input.command === "string" ? input.command : "";
  appsCalled(command, sources);
  const next: Obj = {
    ...envelope(part),
    input: {
      ...fields(input, [...SAID, "yieldMs"]),
      ...(command && { command: outlineCommand(command) }),
    },
  };
  const output = part.output;
  if (isObj(output)) {
    const kept = fields(
      output,
      [
        "exitCode",
        "durationMs",
        "movedForMessageFrom",
        "omittedBytes",
        "logOmittedBytes",
        "commands",
        "processId",
        "pids",
        "handOffs",
        "stderr",
        "truncated",
      ],
      [],
      sources,
    );
    delete kept.command;
    if (Array.isArray(output.ran)) {
      kept.ran = output.ran.map((ran) => pick(ran, RUN_FIELDS));
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
    next = { ...envelope(rest), input: pick(rest.input, [...SAID, "query"]) };
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
      ...envelope(rest),
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
  "data-setupChanges",
  "data-skillMentions",
  "data-taskEvent",
  "data-project",
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
