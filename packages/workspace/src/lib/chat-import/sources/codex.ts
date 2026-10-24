import fs from "node:fs/promises";
import path from "node:path";
import { parallel } from "radashi";

import type { ChatSource, ImportCandidate, ImportedTranscript } from "../model";
import {
  canReadZstd,
  ConversationFolder,
  dateOf,
  FileCache,
  FILES_AT_ONCE,
  homeRelative,
  isRecord,
  parseRecord,
  previewFrom,
  readLines,
  stringOf,
  titleFrom,
  type UserPart,
} from "./shared";

/**
 * Codex's sessions: one rollout log per thread under
 * `~/.codex/sessions/YYYY/MM/DD/`, `rollout-*.jsonl`, which newer builds
 * compress to `rollout-*.jsonl.zst` once a thread goes quiet. Each line is
 * `{ timestamp, type, payload }`: a `session_meta` naming the thread, its
 * folder and what started it, then `response_item`s (messages, tool calls
 * and their output, reasoning) among events and bookkeeping. The earliest
 * builds wrote one `rollout-*.json` per thread at the top level instead.
 *
 * Codex writes its own context into user messages (the environment, the
 * AGENTS.md it read, the IDE's open files), so only what the person typed
 * is kept. Thread names live apart from the logs, in `session_index.jsonl`.
 */

const KIND = "codex";

/** `response_item` payload types that are a tool call, by the name to count them under. */
const TOOL_CALLS: { [type: string]: string | undefined } = {
  custom_tool_call: undefined,
  function_call: undefined,
  local_shell_call: "shell",
  web_search_call: "web_search",
};

/** The tags Codex wraps around an image the person attached, each its own text item. */
const IMAGE_TAG = /^<\/?image\b[^>]*>$/;

/** The IDE extension wraps what the person typed after this heading. */
const IDE_REQUEST = "## My request for Codex:";

/** Context Codex writes as a user message, each opening with one of these. */
const INJECTED_PREFIXES = [
  "# AGENTS.md instructions",
  "# Context from my IDE setup:",
  "# Files mentioned by the user:",
];

/** A line's record type: `{"timestamp":"…","ordinal":3,"type":"turn_context","payload":{…` */
const RECORD_TYPE = /"type":"([a-z_]+)","payload":/;

/** The record types a scan reads; every other one is skipped unparsed. */
const READ_RECORDS = new Set(["response_item", "session_meta", "turn_context"]);

/** `{"timestamp":"…","ordinal":3,"type":"response_item","payload":{"type":"message","role":"user"` */
const LINE_HEAD =
  /"type":"([a-z_]+)","payload":\{"type":"([a-z_]+)"(?:,"role":"([a-z]+)")?/;

interface Scanned {
  candidate: ImportCandidate;
  messages: ImportedTranscript["messages"];
}

export function codexSource({ homeDir }: { homeDir: string }): ChatSource {
  const home = path.join(homeDir, ".codex");
  const root = path.join(home, "sessions");
  const cache = new FileCache<ImportCandidate | null>();
  let index = new Map<string, string>();

  async function list(): Promise<ImportCandidate[]> {
    const [files, names] = await Promise.all([
      rolloutFiles(root),
      threadNames(home),
    ]);
    cache.retain(new Set(files));
    const listed = await parallel(
      { limit: FILES_AT_ONCE },
      files,
      async (file) => {
        const candidate = await cache.get(file, async () =>
          scanRollout(file, { homeDir, keepText: false })
            .then((scanned) => scanned?.candidate ?? null)
            .catch(() => null),
        );
        return candidate ? { candidate, file } : undefined;
      },
    );
    const chosen = new Map<
      string,
      { candidate: ImportCandidate; file: string }
    >();
    for (const entry of listed) {
      if (entry && !chosen.has(entry.candidate.sourceId)) {
        chosen.set(entry.candidate.sourceId, entry);
      }
    }
    index = new Map([...chosen].map(([id, entry]) => [id, entry.file]));
    return [...chosen.values()]
      .map(({ candidate }) => named(candidate, names))
      .toSorted((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  return {
    kind: KIND,
    list,
    async *read(sourceIds) {
      if (sourceIds.some((id) => !index.has(id))) {
        await list();
      }
      const names = await threadNames(home);
      for (const id of sourceIds) {
        const file = index.get(id);
        const scanned = file
          ? await scanRollout(file, { homeDir, keepText: true }).catch(
              () => undefined,
            )
          : undefined;
        if (scanned) {
          yield {
            ...named(scanned.candidate, names),
            messages: scanned.messages,
          };
        }
      }
    },
  };
}

function named(
  candidate: ImportCandidate,
  names: ReadonlyMap<string, string>,
): ImportCandidate {
  const name = names.get(candidate.sourceId);
  return name ? { ...candidate, title: name } : candidate;
}

/** Every rollout Codex wrote, newest layout and oldest, skipping compressed ones it cannot read. */
async function rolloutFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { recursive: true }).catch(() => []);
  return entries
    .filter((entry) => {
      const name = path.basename(entry);
      return (
        name.startsWith("rollout-") &&
        (name.endsWith(".jsonl") ||
          (name.endsWith(".jsonl.zst") && canReadZstd) ||
          (name.endsWith(".json") && !entry.includes(path.sep)))
      );
    })
    .map((entry) => path.join(root, entry))
    .toSorted();
}

/** Thread names the person or Codex gave, newest line winning per thread. */
async function threadNames(home: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const file = path.join(home, "session_index.jsonl");
  try {
    for await (const line of readLines(file)) {
      const record = parseRecord(line);
      const id = stringOf(record?.id);
      const name = stringOf(record?.thread_name)?.trim();
      if (id && name) {
        names.set(id, name);
      }
    }
  } catch {
    // No index: titles come from each thread's opening ask.
  }
  return names;
}

async function scanRollout(
  file: string,
  options: { homeDir: string; keepText: boolean },
): Promise<Scanned | undefined> {
  return file.endsWith(".json")
    ? scanLegacy(file, options)
    : scanLines(file, options);
}

async function scanLines(
  file: string,
  { homeDir, keepText }: { homeDir: string; keepText: boolean },
): Promise<Scanned | undefined> {
  const folder = new ConversationFolder({ keepText });
  let meta: { cwd?: string; id?: string; subagent: boolean } | undefined;
  let model: string | undefined;

  for await (const line of readLines(file)) {
    // Most lines are events, reasoning and tool output: skip them by their
    // first bytes, and parse whatever those do not settle.
    const start = line.toString("latin1", 0, 160);
    const recordType = RECORD_TYPE.exec(start)?.[1];
    if (recordType && !READ_RECORDS.has(recordType)) {
      continue;
    }
    if (recordType === "turn_context" && !keepText) {
      continue;
    }
    const head = LINE_HEAD.exec(start);
    if (head?.[1] === "response_item" && !isConversation(head[2], head[3])) {
      continue;
    }
    const record = parseRecord(line);
    const payload = record?.payload;
    if (!record || !isRecord(payload)) {
      continue;
    }
    if (record.type === "session_meta") {
      meta ??= sessionMeta(payload);
      continue;
    }
    if (record.type === "turn_context") {
      model = stringOf(payload.model) ?? model;
      continue;
    }
    const at = dateOf(record.timestamp);
    if (record.type !== "response_item" || !at) {
      continue;
    }
    if (payload.type === "message" && payload.role === "user") {
      folder.user(userPart(payload.content, at));
    } else if (payload.type === "message" && payload.role === "assistant") {
      folder.assistant({ at, text: outputText(payload.content), ...(model ? { model } : {}) });
    } else if (typeof payload.type === "string" && payload.type in TOOL_CALLS) {
      const tool = TOOL_CALLS[payload.type] ?? stringOf(payload.name) ?? "tool";
      folder.assistant({ at, tools: [tool], ...(model ? { model } : {}) });
    }
  }

  const id =
    meta?.id ??
    path.basename(file).match(/([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl/)?.[1];
  return id
    ? candidateOf(folder, {
        cwd: meta?.cwd,
        homeDir,
        id,
        subagent: meta?.subagent,
      })
    : undefined;
}

function sessionMeta(payload: Record<string, unknown>): {
  cwd?: string;
  id?: string;
  subagent: boolean;
} {
  return {
    cwd: stringOf(payload.cwd),
    id: stringOf(payload.id),
    subagent: isRecord(payload.source) && "subagent" in payload.source,
  };
}

/** Whether a `response_item` is a message either side wrote, or a tool call. */
function isConversation(payloadType: string | undefined, role: string | undefined): boolean {
  return payloadType === "message"
    ? role === undefined || role === "user" || role === "assistant"
    : payloadType !== undefined && payloadType in TOOL_CALLS;
}

/** The earliest rollouts: one JSON file, `{ session, items }`, its items undated. */
async function scanLegacy(
  file: string,
  { homeDir, keepText }: { homeDir: string; keepText: boolean },
): Promise<Scanned | undefined> {
  const parsed = parseRecord(await fs.readFile(file, "utf8"));
  const session = isRecord(parsed?.session) ? parsed.session : undefined;
  const id = stringOf(session?.id);
  const at = dateOf(session?.timestamp);
  if (!id || !at || !Array.isArray(parsed?.items)) {
    return undefined;
  }
  const folder = new ConversationFolder({ keepText });
  for (const item of parsed.items) {
    if (!isRecord(item)) {
      continue;
    }
    const type = stringOf(item.type) ?? "message";
    if (type === "message" && item.role === "user") {
      folder.user(userPart(item.content, at));
    } else if (type === "message" && item.role === "assistant") {
      folder.assistant({ at, text: outputText(item.content) });
    } else if (type in TOOL_CALLS) {
      folder.assistant({
        at,
        tools: [TOOL_CALLS[type] ?? stringOf(item.name) ?? "tool"],
      });
    }
  }
  return candidateOf(folder, { homeDir, id });
}

function candidateOf(
  folder: ConversationFolder,
  {
    cwd,
    homeDir,
    id,
    subagent,
  }: { cwd?: string; homeDir: string; id: string; subagent?: boolean },
): Scanned | undefined {
  const folded = folder.finish();
  if (!folded.createdAt || !folded.updatedAt || folded.count === 0) {
    return undefined;
  }
  const prompt = folded.firstPrompt;
  const incidental = subagent === true || !folded.prompted || !folded.replied;
  return {
    candidate: {
      createdAt: folded.createdAt,
      kind: KIND,
      messages: folded.count,
      sourceId: id,
      title: prompt ? titleFrom(prompt) : "",
      updatedAt: folded.updatedAt,
      ...(prompt ? { preview: previewFrom(prompt) } : {}),
      ...(cwd ? { project: homeRelative(cwd, homeDir) } : {}),
      ...(incidental ? { incidental: true } : {}),
    },
    messages: folded.messages,
  };
}

/** What the person typed in a user message, leaving out what Codex wrote into it. */
function userPart(content: unknown, at: Date): UserPart {
  const texts: string[] = [];
  let attachments = 0;
  for (const item of Array.isArray(content) ? content : []) {
    if (!isRecord(item)) {
      continue;
    }
    if (item.type === "input_text") {
      const text = personText(stringOf(item.text) ?? "");
      if (text !== "") {
        texts.push(text);
      }
    } else if (item.type === "input_image" || item.type === "input_file") {
      attachments += 1;
    }
  }
  return {
    at,
    text: texts.join("\n\n"),
    ...(attachments > 0 ? { attachments } : {}),
  };
}

function personText(raw: string): string {
  const request = raw.indexOf(IDE_REQUEST);
  if (request !== -1) {
    return raw.slice(request + IDE_REQUEST.length).trim();
  }
  const text = raw.trim();
  if (
    INJECTED_PREFIXES.some((prefix) => text.startsWith(prefix)) ||
    IMAGE_TAG.test(text)
  ) {
    return "";
  }
  // A whole message in one tag (`<environment_context>…</environment_context>`) is Codex's.
  const tag = /^<([a-z][\w-]*)[\s>]/.exec(text)?.[1];
  return tag && text.endsWith(`</${tag}>`) ? "" : text;
}

function outputText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  return (Array.isArray(content) ? content : [])
    .flatMap((item) =>
      isRecord(item) && (item.type === "output_text" || item.type === "text")
        ? [stringOf(item.text) ?? ""]
        : [],
    )
    .join("\n\n");
}
