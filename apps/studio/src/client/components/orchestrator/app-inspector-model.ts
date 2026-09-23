import type { RPCOutput } from "@/client/rpc/client";

/**
 * The inspector's reading of an app's answers, kept apart from the drawing
 * so it can be tested on its own: which shape an answer is, what a row is
 * called, which read opens a row, and where code ends. Every rule here is
 * generic; nothing names a server.
 */

export type Json = Record<string, unknown>;
export type Tool = RPCOutput["apps"]["inspect"][number];

const TITLE_KEYS = [
  "title",
  "name",
  "subject",
  "identifier",
  "summary",
  "label",
  "displayName",
];

const ID_KEYS = ["id", "uuid", "key"];

const VERBS = new Set([
  "fetch",
  "find",
  "get",
  "list",
  "query",
  "read",
  "retrieve",
  "search",
]);

/**
 * What a container holds, as rows, or nothing for a value that is not one.
 * A list of plain values is drawn inline rather than opened.
 */
export function childrenOf(value: unknown): [string, unknown][] | undefined {
  if (Array.isArray(value)) {
    if (value.every((entry) => typeof entry !== "object" || entry === null)) {
      return undefined;
    }
    return value.map((entry, index) => [String(index + 1), entry]);
  }
  if (isObject(value)) {
    const entries = Object.entries(value);
    return entries.length === 0 ? undefined : entries;
  }
  return undefined;
}

/**
 * The read that takes exactly what this record carries: one required
 * parameter, filled from the field of the same name, or from the record's
 * id when the parameter is some kind of id. Among several, the one whose
 * name shares a noun with the list the record came from.
 */
export function detailRead(
  reads: Tool[],
  source: Tool,
  record: Json,
): undefined | { args: Json; tool: Tool } {
  const sourceNouns = nounsOf(source.name);
  const id = ID_KEYS.map((key) => record[key]).find(
    (value) => typeof value === "string",
  );
  const candidates = reads.flatMap((tool) => {
    const required = tool.params.filter((param) => param.required);
    const param = required[0];
    if (tool.name === source.name || required.length !== 1 || !param) {
      return [];
    }
    const own = record[param.name];
    const byName =
      typeof own === "string"
        ? own
        : /name$/i.test(param.name) && typeof record.name === "string"
          ? record.name
          : undefined;
    const byId =
      /(?:^|[_a-z])(?:id|uuid)$/i.test(param.name) ||
      /\b(?:id|uuid)\b/i.test(param.description ?? "")
        ? id
        : undefined;
    // Some services name a thing by its address rather than an id.
    const byUrl =
      /\burl\b/i.test(param.description ?? "") && typeof record.url === "string"
        ? record.url
        : undefined;
    const value = byName ?? byId ?? byUrl;
    if (value === undefined) {
      return [];
    }
    const shared = [...nounsOf(tool.name)].filter((noun) =>
      sourceNouns.has(noun),
    ).length;
    // A guess from an id or a name alone needs the two tools to be about the
    // same thing. A field named exactly as the parameter is enough by itself,
    // and so is the row's own address handed to a parameter that says it
    // takes one.
    const isCertain =
      typeof own === "string" ||
      (byName === undefined && byId === undefined && byUrl !== undefined);
    if (!isCertain && shared === 0) {
      return [];
    }
    return [{ args: { [param.name]: value }, score: shared, tool }];
  });
  return candidates.toSorted((a, b) => b.score - a.score)[0];
}

/** Whether a tool runs with nothing asked of it. */
export function isBare(tool: Tool): boolean {
  return tool.params.every((param) => !param.required);
}

export function isLink(value: string): boolean {
  return /^[a-z][\w+.-]*:\/\/\S+$/i.test(value);
}

/**
 * Whether an answer is a list of things: an array, or an object holding one
 * (a page of results wrapped in paging).
 */
export function isListAnswer(value: unknown): boolean {
  if (Array.isArray(value)) {
    return true;
  }
  return (
    isObject(value) &&
    Object.values(value).some(
      (entry) =>
        Array.isArray(entry) && (entry.length === 0 || entry.some(isObject)),
    )
  );
}

export function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The server's title, else its name less the app's prefix, in words. */
export function labelOf(tool: Tool): string {
  if (tool.title) {
    return tool.title;
  }
  const words = tool.name.split(/[-_\s]+/).filter(Boolean);
  const rest = words.length > 2 ? words.slice(1) : words;
  const text = rest.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A best guess at the language, for highlighting only. */
export function languageOf(code: string): string | undefined {
  if (/^\s*[[{]/.test(code)) {
    return "json";
  }
  if (
    /<[A-Z][^>]*>/i.test(code) &&
    /\b(?:return|export|function|const)\b/.test(code)
  ) {
    return "tsx";
  }
  if (/^\s*</.test(code)) {
    return "html";
  }
  if (/\b(?:import|export|const|function)\b/.test(code)) {
    return "typescript";
  }
  return undefined;
}

/** Lists first: they are what a person browsing starts from. */
export function listsFirst(a: Tool, b: Tool): number {
  const isList = (tool: Tool) => /(?:^|[-_])list(?:[-_]|$)/i.test(tool.name);
  return Number(isList(b)) - Number(isList(a));
}

/** Source code or markup, which keeps its lines rather than wrapping them. */
export function looksLikeCode(text: string): boolean {
  const lines = text.split("\n");
  return (
    lines.length > 3 &&
    (lines.some((line) => line.length > 160) ||
      /^\s*(?:import |export |const |function |<[a-z!])/im.test(text))
  );
}

/** The nouns in a tool's name, singular, less its verbs and the app's prefix. */
export function nounsOf(name: string): Set<string> {
  const words = name
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  return new Set(
    words
      .slice(words.length > 2 ? 1 : 0)
      .filter((word) => !VERBS.has(word))
      .map((word) => word.replace(/s$/, "")),
  );
}

export function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * JSON values written one after another, as some servers answer with
 * several blocks joined: each top-level value, or nothing when the text is
 * not that.
 */
export function parseSequence(text: string): undefined | unknown[] {
  const values: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (char === "\\") {
        index++;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    switch (char) {
      case '"': {
        inString = true;

        break;
      }
      case "[":
      case "{": {
        if (depth === 0) {
          start = index;
        }
        depth++;

        break;
      }
      case "]":
      case "}": {
        depth--;
        if (depth === 0 && start !== -1) {
          const value = parse(text.slice(start, index + 1));
          if (value === undefined) {
            return undefined;
          }
          values.push(value);
          start = -1;
        }

        break;
      }
      default: {
        if (depth === 0 && char !== undefined && !/\s/.test(char)) {
          return undefined;
        }
      }
    }
  }
  return values.length > 1 ? values : undefined;
}

/**
 * The rows an answer holds: an array as it is, an object's first array of
 * objects (a page of results wrapped in paging), else the object alone.
 */
export function recordsOf(value: unknown): Json[] {
  if (Array.isArray(value)) {
    return value.map((entry: unknown) =>
      isObject(entry) ? entry : { value: entry },
    );
  }
  if (isObject(value)) {
    // A page of results wrapped in paging, empty or not.
    const list = Object.values(value).find(
      (entry) =>
        Array.isArray(entry) && (entry.length === 0 || entry.some(isObject)),
    );
    return Array.isArray(list) ? recordsOf(list) : [value];
  }
  return [{ value }];
}

/**
 * Where code ends and prose begins: the first line that reads as a sentence
 * straight after one that closes a block.
 */
export function splitCode(text: string): { code: string; prose: string } {
  const lines = text.split("\n");
  const end = lines.findIndex(
    (line, index) =>
      index > 0 &&
      /^[)\]}][;)]*\s*$/.test(lines[index - 1] ?? "") &&
      /^[A-Z][\w' -]*[\s:.,]/.test(line),
  );
  return end === -1
    ? { code: text, prose: "" }
    : {
        code: lines.slice(0, end).join("\n"),
        prose: lines.slice(end).join("\n").trim(),
      };
}

/** A folded container in one line: what it is called, and how much is in it. */
export function summaryOf(value: unknown, count: number): string {
  if (Array.isArray(value)) {
    const first = value.find(isObject);
    const names = value
      .filter(isObject)
      .slice(0, 3)
      .map((entry) => titleOf(entry));
    return first
      ? `${names.join(", ")}${count > 3 ? ", …" : ""} (${count})`
      : `${count} items`;
  }
  if (isObject(value)) {
    const named = [...TITLE_KEYS, ...ID_KEYS].some(
      (key) => typeof value[key] === "string",
    );
    return named
      ? `${titleOf(value)} · ${count} ${count === 1 ? "field" : "fields"}`
      : `${count} ${count === 1 ? "field" : "fields"}`;
  }
  return "";
}

export function titleOf(record: Json): string {
  // A field named for what it is (`title`, `name`), then one named as a
  // kind of it (`nodeName`, `page_title`), then an id.
  const named = Object.keys(record).filter((key) =>
    /(?:name|title)$/i.test(key),
  );
  for (const key of [...TITLE_KEYS, ...named, ...ID_KEYS]) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }
  const first = Object.values(record).find(
    (value) => typeof value === "string" && value.trim() !== "",
  );
  if (typeof first === "string") {
    return first;
  }
  const key = Object.keys(record)[0];
  return key === undefined ? "Empty" : key.replaceAll("_", " ");
}
