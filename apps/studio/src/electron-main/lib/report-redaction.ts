import { homeSpellings } from "@instrument-org/shared/home-folder";
import { redactSecrets } from "@instrument-org/shared/secrets";

/** Someone a report may name: an account signed in on this computer. */
type Person = { email: string; name?: string };

/** One of a chat's record files, by its name on disk. */
type ChatFile = { content: string; name: string };

/**
 * What the app knows about the person sending a report, for it to take out:
 * the accounts signed in, the home folder and login, and their memories.
 */
export type ReportKnownValues = {
  /** The chat the report is about, whose own title stays. */
  chatId?: string;
  /** Every chat's id, `chatId`'s aside, each spelling out its chat's title. */
  chatIds?: readonly string[];
  home?: string;
  login?: string;
  memories?: readonly { name: string; text: string }[];
  people?: readonly Person[];
};

/** The shortest name, login or memory that is taken out wherever it appears. */
const MIN_LITERAL = 4;

/** The shortest memory text taken out of free text, so a stock phrase stays. */
const MIN_MEMORY_TEXT = 12;

/** How a session's context names the person (`getUserText`). */
const USER_LINE =
  /The user's name is (.+?), signed in as (\S+@\S+?)\.(?=\s|$)|The user is signed in as (\S+@\S+?)\.(?=\s|$)/g;

const escapeRegExp = (text: string) =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Takes out of a report what is personal and no help with a bug, keeping its
 * shape: who the person is (name, email, home folder, login), what Instrument
 * remembers about them, other chats' titles, ids and messages, and any secret.
 * Everything else stays, tool output included, since a report that has lost
 * the bug is worse than none.
 *
 * Deterministic: each value is one the app knows, found as written, or a
 * secret found by its shape. A first name alone, a third party's name, or a
 * personal fact in the person's own words stays.
 */
export function createReportRedactor(known: ReportKnownValues) {
  const people = [...(known.people ?? [])];
  const memoryNames = new Map<string, string>();
  const memoryTexts = new Map<string, string>();
  let pattern: RegExp | undefined;
  let replacements = new Map<string, string>();
  let emails: RegExp | undefined;

  const memoryAlias = (name: string) => {
    let alias = memoryNames.get(name);
    if (!alias) {
      alias = `memory-${memoryNames.size + 1}`;
      memoryNames.set(name, alias);
    }
    return alias;
  };

  const rememberMemory = (name: string, text: string) => {
    const alias = memoryAlias(name);
    const headline = text.split("\n")[0]?.trim() ?? "";
    for (const value of [text.trim(), headline]) {
      if (value.length >= MIN_MEMORY_TEXT) {
        memoryTexts.set(value, `[${alias} text]`);
      }
    }
  };

  for (const memory of known.memories ?? []) {
    rememberMemory(memory.name, memory.text);
  }

  /** Builds the one pattern every known value is found with. */
  const compile = () => {
    replacements = new Map();
    const sources: string[] = [];
    const add = (value: string, replacement: string, bounded: boolean) => {
      if (value.length < MIN_LITERAL || replacements.has(value)) {
        return;
      }
      replacements.set(value, replacement);
      const literal = escapeRegExp(value);
      sources.push(bounded ? `(?<![\\w-])${literal}(?![\\w-])` : literal);
    };
    for (const spelling of homeSpellings(known.home ?? "")) {
      add(spelling, "~", false);
    }
    for (const [text, replacement] of memoryTexts) {
      add(text, replacement, false);
    }
    for (const person of people) {
      if (person.name) {
        add(person.name, "[name]", true);
      }
    }
    if (known.login) {
      add(known.login, "[login]", true);
    }
    // A one-word memory name is too likely an ordinary word to take out of
    // free text; a hyphenated one is not.
    for (const [name, alias] of memoryNames) {
      if (name.includes("-")) {
        add(name, alias, true);
      }
    }
    // Another chat's id is its title, as the log names it; a one-word id
    // stays for the same reason a one-word memory name does.
    for (const id of known.chatIds ?? []) {
      if (id !== known.chatId && id.includes("-")) {
        add(id, "[other chat]", true);
      }
    }
    // Longest first, so a memory's whole text wins over its first line.
    sources.sort((a, b) => b.length - a.length);
    pattern =
      sources.length > 0 ? new RegExp(sources.join("|"), "g") : undefined;
    const addresses = [
      ...new Set(people.map((person) => person.email.toLowerCase())),
    ];
    emails =
      addresses.length > 0
        ? new RegExp(addresses.map(escapeRegExp).join("|"), "gi")
        : undefined;
  };
  compile();

  const text = (value: string): string => {
    let out = value;
    if (pattern) {
      out = out.replaceAll(
        pattern,
        (match) => replacements.get(match) ?? match,
      );
    }
    if (emails) {
      out = out.replaceAll(emails, "[email]");
    }
    return redactSecrets(out);
  };

  const deep = (value: unknown): unknown => {
    if (typeof value === "string") {
      return text(value);
    }
    if (Array.isArray(value)) {
      return value.map(deep);
    }
    if (isRecord(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, deep(item)]),
      );
    }
    return value;
  };

  /**
   * A record with the parts that tell the model about other things than this
   * chat reduced to their size: memory, other chats, and the chats a memory
   * came from.
   */
  const structural = (record: unknown): unknown => {
    if (!isRecord(record) || record.t !== "part" || !isRecord(record.part)) {
      return record;
    }
    const { part } = record;
    if (!isRecord(part.data)) {
      return record;
    }
    const data = reduceDataPart(part.type, part.data);
    return data === part.data ? record : { ...record, part: { ...part, data } };
  };

  const reduceDataPart = (
    type: unknown,
    data: Record<string, unknown>,
  ): Record<string, unknown> => {
    const otherChat = (chat: Record<string, unknown>) =>
      chat.id !== undefined && chat.id === known.chatId
        ? chat
        : { ...chat, ...sized(chat, "title", "other chat") };
    switch (type) {
      case "data-memory": {
        return {
          ...data,
          ...(Array.isArray(data.forgotten) && {
            forgotten: data.forgotten.map((name: unknown) =>
              typeof name === "string" ? memoryAlias(name) : name,
            ),
          }),
          ...(Array.isArray(data.memories) && {
            memories: data.memories.map((memory: unknown) =>
              isRecord(memory)
                ? {
                    ...memory,
                    ...sized(memory, "from", "chat title"),
                    ...sized(memory, "text", "memory"),
                    ...(typeof memory.name === "string" && {
                      name: memoryAlias(memory.name),
                    }),
                  }
                : memory,
            ),
          }),
          ...(isRecord(data.told) && {
            told: Object.fromEntries(
              Object.entries(data.told).map(([name, digest]) => [
                memoryAlias(name),
                digest,
              ]),
            ),
          }),
        };
      }
      case "data-chatContext": {
        return Array.isArray(data.chats)
          ? {
              ...data,
              chats: data.chats.map((chat: unknown) =>
                isRecord(chat) && chat.id !== known.chatId
                  ? {
                      ...chat,
                      ...sized(chat, "title", "other chat"),
                      ...sized(chat, "latest", "message"),
                      ...(Array.isArray(chat.topics) && {
                        topics: chat.topics.map(() => "[topic]"),
                      }),
                    }
                  : chat,
              ),
            }
          : data;
      }
      case "data-viewContext": {
        return {
          ...data,
          ...(isRecord(data.chat) && { chat: otherChat(data.chat) }),
          ...(Array.isArray(data.attached) && {
            attached: data.attached.map((chip: unknown) =>
              isRecord(chip) && chip.kind === "chat" ? otherChat(chip) : chip,
            ),
          }),
        };
      }
      default: {
        return data;
      }
    }
  };

  /** Learns, from one record, the people and memories it names. */
  const learn = (value: unknown) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(USER_LINE)) {
        const [, name, email, onlyEmail] = match;
        const address = email ?? onlyEmail;
        if (address) {
          people.push({ email: address, ...(name && { name }) });
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(learn);
      return;
    }
    if (!isRecord(value)) {
      return;
    }
    if (value.type === "data-memory" && isRecord(value.data)) {
      const { memories } = value.data;
      for (const memory of Array.isArray(memories) ? memories : []) {
        if (
          isRecord(memory) &&
          typeof memory.name === "string" &&
          typeof memory.text === "string"
        ) {
          rememberMemory(memory.name, memory.text);
        }
      }
    }
    Object.values(value).forEach(learn);
  };

  /**
   * A chat's record files as a report sends them. Every file is read first,
   * so a person or memory one session names is taken out of all of them.
   */
  const chatFiles = (files: readonly ChatFile[]): ChatFile[] => {
    const parsed = files.map((file) => ({
      ...file,
      lines: file.name.endsWith(".jsonl")
        ? file.content.split("\n").map(parseJson)
        : file.name.endsWith(".json")
          ? [parseJson(file.content)]
          : undefined,
    }));
    for (const file of parsed) {
      file.lines?.forEach((line) => learn(line.value));
      if (!file.lines) {
        learn(file.content);
      }
    }
    compile();
    return parsed.map(({ content, lines, name }) => ({
      content: lines
        ? lines
            .map((line) =>
              line.parsed
                ? JSON.stringify(
                    deep(structural(line.value)),
                    null,
                    line.indent,
                  )
                : text(line.raw),
            )
            .join("\n")
        : text(content),
      name,
    }));
  };

  return { chatFiles, deep, text };
}

/** A field written as its kind and length: `[memory, 47 chars]`. */
function sized(record: Record<string, unknown>, key: string, kind: string) {
  const value = record[key];
  return typeof value === "string"
    ? { [key]: `[${kind}, ${value.length} chars]` }
    : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One line or file of JSON, with how it was indented so it is written back
 * the same way; a line that is not JSON (the empty last line, a torn write)
 * stays text.
 */
function parseJson(raw: string) {
  if (raw.trim() === "") {
    return { parsed: false, raw, value: undefined } as const;
  }
  try {
    const value: unknown = JSON.parse(raw);
    return {
      indent: raw.includes("\n") ? 2 : undefined,
      parsed: true,
      raw,
      value,
    } as const;
  } catch {
    return { parsed: false, raw, value: undefined } as const;
  }
}
