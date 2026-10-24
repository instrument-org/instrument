import type {
  ChatSource,
  ImportCandidate,
  ImportedMessage,
  ImportedTranscript,
  ImportOmitted,
} from "../model";
import {
  candidateOf,
  dateOf,
  type ExportFiles,
  finishTranscript,
  isRecord,
  jsonArrayObjects,
  list,
  mergeReplies,
  newestFirst,
  readJson,
  record,
  text,
} from "./export-files";

/**
 * Claude's data export (Settings > Privacy > Export data): a
 * `conversations.json` array of conversations, each with its
 * `chat_messages`, beside `users.json` and the person's projects, as a
 * `projects.json` or a `projects/` folder of one file each. A reply that
 * used tools can be several assistant messages in a row, read as one.
 *
 * A message's `content` blocks are read when it has them, since they keep
 * the reply's words apart from its thinking and tool calls; its `text` is the
 * fallback. Where messages name a `parent_message_uuid`, the export kept
 * every branch an edit or a retry made, and the one read is the branch to
 * the conversation's current leaf (or its newest message).
 */
export function claudeExportSource(
  files: ExportFiles,
  conversationsFile: string,
  projectFiles: readonly string[],
): ChatSource {
  let listing: Promise<ImportCandidate[]> | undefined;
  let projects: Promise<Map<string, string>> | undefined;

  async function* conversations(): AsyncIterable<ImportedTranscript> {
    projects ??= projectNames(files, projectFiles);
    const names = await projects;
    for await (const raw of jsonArrayObjects(files.stream(conversationsFile))) {
      const transcript = readConversation(raw, names);
      if (transcript) {
        yield transcript;
      }
    }
  }

  return {
    kind: "claude-export",
    list() {
      listing ??= (async () => {
        const seen = new Set<string>();
        const candidates: ImportCandidate[] = [];
        for await (const transcript of conversations()) {
          if (!seen.has(transcript.sourceId)) {
            seen.add(transcript.sourceId);
            candidates.push(candidateOf(transcript));
          }
        }
        return candidates.sort(newestFirst);
      })();
      return listing;
    },
    async *read(sourceIds) {
      const wanted = new Set(sourceIds);
      for await (const transcript of conversations()) {
        if (!wanted.delete(transcript.sourceId)) {
          continue;
        }
        yield transcript;
        if (wanted.size === 0) {
          return;
        }
      }
    },
  };
}

/**
 * Each project's name by its id, from a `projects.json` array or a
 * `projects/` folder of one file per project. The array is streamed, since a
 * project keeps its documents.
 */
async function projectNames(
  files: ExportFiles,
  projectFiles: readonly string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const add = (raw: unknown) => {
    const project = record(raw);
    const id = text(project.uuid);
    const name = text(project.name);
    if (id && name) {
      names.set(id, name);
    }
  };
  for (const file of projectFiles) {
    try {
      if (file.endsWith("/projects.json") || file === "projects.json") {
        for await (const raw of jsonArrayObjects(files.stream(file))) {
          add(raw);
        }
      } else {
        add(await readJson(files, file));
      }
    } catch {
      // A project file that cannot be read leaves its chats unfiled.
    }
  }
  return names;
}

/** One conversation from the export, or undefined when it cannot be read. */
export function readConversation(
  raw: unknown,
  projects: ReadonlyMap<string, string> = new Map(),
): ImportedTranscript | undefined {
  try {
    return readConversationOrThrow(raw, projects);
  } catch {
    return undefined;
  }
}

function readConversationOrThrow(
  raw: unknown,
  projects: ReadonlyMap<string, string>,
): ImportedTranscript | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const sourceId = text(raw.uuid);
  if (!sourceId) {
    return undefined;
  }
  const opened = dateOf(raw.created_at);
  const model = text(raw.model);
  const messages: ImportedMessage[] = [];
  let lastTime = opened;
  for (const entry of branch(raw)) {
    const role =
      entry.sender === "human"
        ? "user"
        : entry.sender === "assistant"
          ? "assistant"
          : undefined;
    const createdAt = dateOf(entry.created_at) ?? lastTime;
    if (!role || !createdAt) {
      continue;
    }
    lastTime = createdAt;
    const message = readMessage(entry, role, createdAt);
    const messageModel = text(entry.model) ?? model;
    if (message) {
      messages.push(
        role === "assistant" && messageModel
          ? { ...message, model: messageModel }
          : message,
      );
    }
  }
  const createdAt = opened ?? messages[0]?.createdAt ?? dateOf(raw.updated_at);
  if (!createdAt) {
    return undefined;
  }
  const updatedAt =
    messages.at(-1)?.createdAt ?? dateOf(raw.updated_at) ?? createdAt;
  const projectId = text(raw.project_uuid) ?? text(record(raw.project).uuid);
  const project =
    (projectId ? projects.get(projectId) : undefined) ??
    text(record(raw.project).name);
  return finishTranscript({
    kind: "claude-export",
    sourceId,
    title: text(raw.name) ?? "",
    createdAt,
    updatedAt: updatedAt < createdAt ? createdAt : updatedAt,
    messages: mergeReplies(messages),
    ...(project ? { project } : {}),
  });
}

/**
 * The messages in the order the person read them. With parent links, that is
 * the path from the root to the current leaf; without them, the export's own
 * order.
 */
function branch(raw: Record<string, unknown>): Record<string, unknown>[] {
  const all = list(raw.chat_messages).filter(isRecord);
  const byId = new Map<string, Record<string, unknown>>();
  for (const message of all) {
    const id = text(message.uuid);
    if (id) {
      byId.set(id, message);
    }
  }
  const linked = all.some((message) => {
    const parent = text(message.parent_message_uuid);
    return parent !== undefined && byId.has(parent);
  });
  if (!linked) {
    return all;
  }
  const currentLeaf = text(raw.current_leaf_message_uuid);
  const leaf =
    (currentLeaf ? byId.get(currentLeaf) : undefined) ??
    all.reduce((newest, message) =>
      (dateOf(message.created_at)?.getTime() ?? 0) >=
      (dateOf(newest.created_at)?.getTime() ?? 0)
        ? message
        : newest,
    );
  const path: Record<string, unknown>[] = [];
  const seen = new Set<Record<string, unknown>>();
  for (
    let message: Record<string, unknown> | undefined = leaf;
    message && !seen.has(message);
    message = byId.get(text(message.parent_message_uuid) ?? "")
  ) {
    seen.add(message);
    path.push(message);
  }
  return path.reverse();
}

function readMessage(
  entry: Record<string, unknown>,
  role: ImportedMessage["role"],
  createdAt: Date,
): ImportedMessage | undefined {
  const blocks = list(entry.content).filter(isRecord);
  const words: string[] = [];
  const toolCalls: Record<string, number> = {};
  let attachments = list(entry.attachments).length + list(entry.files).length;
  // Thinking, tool results and any block type not known here are not the
  // conversation's words.
  for (const block of blocks) {
    const type = text(block.type);
    if (type === "text") {
      const blockText = text(block.text);
      if (blockText?.trim()) {
        words.push(blockText.trim());
      }
    } else if (type === "tool_use") {
      const name = text(block.name) ?? "tool";
      toolCalls[name] = (toolCalls[name] ?? 0) + 1;
    } else if (type === "image" || type === "document") {
      attachments++;
    }
  }
  const textOnly = blocks.length === 0 ? (text(entry.text)?.trim() ?? "") : "";
  const messageText = textOnly || words.join("\n\n");
  const omitted: ImportOmitted = {
    ...(attachments ? { attachments } : {}),
    ...(Object.keys(toolCalls).length ? { toolCalls } : {}),
  };
  const hasOmitted = Object.keys(omitted).length > 0;
  if (!messageText && !hasOmitted) {
    return undefined;
  }
  return {
    role,
    text: messageText,
    createdAt,
    ...(hasOmitted ? { omitted } : {}),
  };
}
