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
  newestFirst,
  record,
  text,
} from "./export-files";

/**
 * ChatGPT's data export (Settings > Data controls > Export): its
 * conversations, as one `conversations.json` or, in later exports, split
 * across `conversations-000.json`, `conversations-001.json` and on. Each file
 * is an array of conversations.
 *
 * A conversation is a tree (`mapping`, node id to `{ message, parent,
 * children }`), since an edit or a regeneration starts a branch. The branch
 * read is the one the person last saw: from `current_node` up to the root.
 */
export function isChatGptConversationsFile(baseName: string): boolean {
  return /^conversations(-\d+)?\.json$/.test(baseName);
}

export function chatGptExportSource(
  files: ExportFiles,
  conversationFiles: readonly string[],
): ChatSource {
  // Which file each listed conversation is in, so reading a few streams only
  // the files they are in.
  const fileOf = new Map<string, string>();
  let listing: Promise<ImportCandidate[]> | undefined;

  async function* conversations(
    names: readonly string[],
  ): AsyncIterable<{ file: string; transcript: ImportedTranscript }> {
    for (const file of names) {
      for await (const raw of jsonArrayObjects(files.stream(file))) {
        const transcript = readConversation(raw);
        if (transcript) {
          yield { file, transcript };
        }
      }
    }
  }

  return {
    kind: "chatgpt-export",
    list() {
      listing ??= (async () => {
        const candidates: ImportCandidate[] = [];
        for await (const { file, transcript } of conversations(
          conversationFiles,
        )) {
          if (fileOf.has(transcript.sourceId)) {
            continue;
          }
          fileOf.set(transcript.sourceId, file);
          candidates.push(candidateOf(transcript));
        }
        return candidates.sort(newestFirst);
      })();
      return listing;
    },
    async *read(sourceIds) {
      const wanted = new Set(sourceIds);
      const known = [...wanted].map((id) => fileOf.get(id));
      const names = known.every((file) => file !== undefined)
        ? conversationFiles.filter((file) => known.includes(file))
        : conversationFiles;
      for await (const { transcript } of conversations(names)) {
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

/** One conversation from the export, or undefined when it cannot be read. */
export function readConversation(raw: unknown): ImportedTranscript | undefined {
  try {
    return readConversationOrThrow(raw);
  } catch {
    return undefined;
  }
}

function readConversationOrThrow(raw: unknown): ImportedTranscript | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const sourceId = text(raw.conversation_id) || text(raw.id);
  const mapping = record(raw.mapping);
  if (!sourceId) {
    return undefined;
  }
  const opened = dateOf(raw.create_time);
  const messages = readBranch(mapping, text(raw.current_node), {
    opened,
    defaultModel: text(raw.default_model_slug),
  });
  const createdAt = opened ?? messages[0]?.createdAt ?? dateOf(raw.update_time);
  if (!createdAt) {
    return undefined;
  }
  const updatedAt =
    messages.at(-1)?.createdAt ?? dateOf(raw.update_time) ?? createdAt;
  return finishTranscript({
    kind: "chatgpt-export",
    sourceId,
    title: text(raw.title) ?? "",
    createdAt,
    updatedAt: updatedAt < createdAt ? createdAt : updatedAt,
    messages,
  });
}

/**
 * The nodes from the root down to the leaf the person last saw. Without a
 * `current_node`, the leaf is the newest message, so a conversation the
 * export left unmarked still reads as its latest branch.
 */
function branchNodes(
  mapping: Record<string, unknown>,
  currentNode: string | undefined,
): Record<string, unknown>[] {
  const leaf =
    currentNode && isRecord(mapping[currentNode])
      ? currentNode
      : newestLeaf(mapping);
  const nodes: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (
    let id = leaf;
    id !== undefined && !seen.has(id) && isRecord(mapping[id]);
    id = text(record(mapping[id]).parent)
  ) {
    seen.add(id);
    nodes.push(record(mapping[id]));
  }
  return nodes.reverse();
}

/**
 * The newest message no other node names as its parent. Leaves are found
 * from `parent` links alone, since exports from 2026 on drop `children`.
 */
function newestLeaf(mapping: Record<string, unknown>): string | undefined {
  const parents = new Set(
    Object.values(mapping).map((node) => text(record(node).parent)),
  );
  let best: { id: string; time: number } | undefined;
  for (const [id, node] of Object.entries(mapping)) {
    if (parents.has(id)) {
      continue;
    }
    const time = Number(record(record(node).message).create_time) || 0;
    if (!best || time >= best.time) {
      best = { id, time };
    }
  }
  return best?.id;
}

/**
 * The branch as the person saw it: their messages, and each reply as one
 * message even where the source split it around tool calls. What a reply did
 * that is not text (tool calls, generated images) is counted onto it.
 */
function readBranch(
  mapping: Record<string, unknown>,
  currentNode: string | undefined,
  {
    opened,
    defaultModel,
  }: { opened: Date | undefined; defaultModel: string | undefined },
): ImportedMessage[] {
  const messages: ImportedMessage[] = [];
  let reply: ImportedMessage | undefined;
  let lastTime = opened;
  const flush = () => {
    if (reply && (reply.text || reply.omitted)) {
      messages.push(reply);
    }
    reply = undefined;
  };
  for (const node of branchNodes(mapping, currentNode)) {
    const message = record(node.message);
    const author = record(message.author);
    const metadata = record(message.metadata);
    const role = text(author.role);
    const createdAt = dateOf(message.create_time) ?? lastTime;
    if (!createdAt || !role || isHidden(message, metadata)) {
      continue;
    }
    lastTime = createdAt;
    const content = readContent(record(message.content));
    if (role === "user") {
      flush();
      if (content.text || content.attachments) {
        messages.push({
          role: "user",
          text: content.text,
          createdAt,
          ...omittedOf(content.attachments, {}),
        });
      }
      continue;
    }
    if (role !== "assistant" && role !== "tool") {
      continue;
    }
    reply ??= { role: "assistant", text: "", createdAt };
    const recipient = text(message.recipient);
    if (role === "assistant" && recipient && recipient !== "all") {
      countToolCall(reply, recipient);
      continue;
    }
    // Later exports leave `model_slug` off many messages and name the model
    // on the conversation instead.
    const model =
      text(metadata.model_slug) ??
      text(metadata.default_model_slug) ??
      defaultModel;
    if (role === "assistant" && model) {
      reply.model = model;
    }
    if (content.attachments) {
      reply.omitted = {
        ...reply.omitted,
        attachments: (reply.omitted?.attachments ?? 0) + content.attachments,
      };
    }
    if (role === "assistant" && content.text) {
      const words = stripCitations(content.text);
      reply.text = reply.text ? `${reply.text}\n\n${words}` : words;
    }
  }
  flush();
  return messages;
}

function isHidden(
  message: Record<string, unknown>,
  metadata: Record<string, unknown>,
): boolean {
  return (
    metadata.is_visually_hidden_from_conversation === true ||
    metadata.is_user_system_message === true ||
    metadata.is_contextual_answers_system_message === true ||
    text(message.channel) === "analysis"
  );
}

function countToolCall(reply: ImportedMessage, name: string) {
  const toolCalls = { ...reply.omitted?.toolCalls };
  toolCalls[name] = (toolCalls[name] ?? 0) + 1;
  reply.omitted = { ...reply.omitted, toolCalls };
}

function omittedOf(
  attachments: number,
  toolCalls: Record<string, number>,
): { omitted?: ImportOmitted } {
  const omitted: ImportOmitted = {
    ...(attachments ? { attachments } : {}),
    ...(Object.keys(toolCalls).length ? { toolCalls } : {}),
  };
  return Object.keys(omitted).length ? { omitted } : {};
}

/**
 * Content types whose words are the model's thinking, the app's own context
 * (custom instructions, memory), or a tool's output, none of which the person
 * read as the conversation.
 */
const UNSPOKEN = new Set([
  "thoughts",
  "reasoning_recap",
  "user_editable_context",
  "model_editable_context",
  "execution_output",
  "tether_browsing_display",
  "tether_quote",
  "system_error",
  "computer_output",
  "super_widget",
]);

const IMAGE_PARTS = new Set([
  "image_asset_pointer",
  "real_time_user_audio_video_asset_pointer",
]);

/** A message's words and how many images it had. */
function readContent(content: Record<string, unknown>): {
  text: string;
  attachments: number;
} {
  const type = text(content.content_type) ?? "text";
  if (UNSPOKEN.has(type)) {
    return { text: "", attachments: 0 };
  }
  if (type === "code") {
    const code = text(content.text) ?? "";
    const language = text(content.language) ?? "";
    return {
      text: code.trim()
        ? `\`\`\`${language === "unknown" ? "" : language}\n${code}\n\`\`\``
        : "",
      attachments: 0,
    };
  }
  const words: string[] = [];
  let attachments = 0;
  for (const part of list(content.parts)) {
    if (typeof part === "string") {
      words.push(part);
    } else if (isRecord(part)) {
      const partType = text(part.content_type);
      if (partType && IMAGE_PARTS.has(partType)) {
        attachments++;
      } else if (partType === "audio_transcription") {
        words.push(text(part.text) ?? "");
      }
    }
  }
  if (words.length === 0 && text(content.text)) {
    words.push(text(content.text) ?? "");
  }
  return { text: words.join("\n").trim(), attachments };
}

/**
 * Citation markers a browsing reply carries inline: private-use characters
 * wrapped around a reference (U+E200 `cite` U+E202 `turn0search1` U+E201), and the
 * older `【4†source】` form. The references they point at are not in the
 * export, so they would read as noise.
 */
function stripCitations(words: string): string {
  return words
    .replaceAll(/\u{e200}[^\u{e201}]*\u{e201}/gu, "")
    .replaceAll(/【\d+(?::\d+)?†[^】]*】/g, "")
    .trim();
}
