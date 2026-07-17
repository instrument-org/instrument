import {
  type AssistantModelMessage,
  type ModelMessage,
  type SystemModelMessage,
  type ToolModelMessage,
  type ToolResultPart,
  type UserModelMessage,
} from "ai";
import { alphabetical } from "radashi";

import { type Session } from "../schemas/session";
import { SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { TOOLS_FOR_MODEL_OUTPUT } from "../tools/all";
import { attachedFolderMountPoint } from "./attached-folder-mounts";
import { buildAttachedFoldersText } from "./build-attached-folders-text";
import {
  buildProjectContextText,
  projectFoldersIntro,
} from "./build-project-context-text";
import { getEffectiveProjectContext } from "./effective-project-context";
import { isToolPart } from "./is-tool-part";
import { Store } from "./store";

interface TimestampRange {
  endedAt?: Date;
  startedAt: Date;
}

export async function getSessionMarkdown({
  frontMatter,
  includeContextMessages = false,
  sessionId,
  taskId,
}: {
  frontMatter?: Record<string, unknown>;
  includeContextMessages?: boolean;
  sessionId: StoreId.Session;
  taskId: TaskId;
}): Promise<string> {
  const result = await Store.getSessionWithMessagesAndParts(sessionId, taskId);
  if (result.isErr()) {
    throw new Error(`Session ${sessionId} not found`);
  }

  return sessionToMarkdown(result.value, {
    frontMatter,
    includeContextMessages,
  });
}

export function renderToolOutput(output: ToolResultPart["output"]): string[] {
  const lines: string[] = [];

  switch (output.type) {
    case "content": {
      const text = output.value.flatMap((part) =>
        part.type === "text" ? [part.text] : [],
      );
      if (text.length > 0) {
        lines.push(fenceText(text.join("\n")));
      }

      const mediaTypes = output.value.flatMap((part) =>
        part.type === "media" ? [part.mediaType] : [],
      );
      if (mediaTypes.length > 0) {
        lines.push(
          `*[${mediaTypes.length} media attachment${mediaTypes.length === 1 ? "" : "s"} omitted from transcript: ${[...new Set(mediaTypes)].join(", ")}]*`,
        );
      }
      break;
    }
    case "error-json": {
      lines.push(
        "**Error (JSON):**",
        "```json",
        JSON.stringify(output.value, null, 2),
        "```",
      );
      break;
    }
    case "error-text": {
      const indented = output.value
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
      lines.push(`> **Error:**`, indented);
      break;
    }
    case "execution-denied": {
      if (output.reason) {
        const indented = output.reason
          .split("\n")
          .map((l) => `> ${l}`)
          .join("\n");
        lines.push(`*Execution denied:*`, indented);
      } else {
        lines.push(`*Execution denied*`);
      }
      break;
    }
    case "json": {
      lines.push("```json", JSON.stringify(output.value, null, 2), "```");
      break;
    }
    case "text": {
      lines.push(fenceText(output.value));
      break;
    }
  }

  return lines;
}

function buildMessageTimestampQueues(
  messages: SessionMessage.WithParts[],
): Map<ModelMessage["role"], TimestampRange[]> {
  const queues = new Map<ModelMessage["role"], TimestampRange[]>();

  for (const message of messages) {
    const role =
      message.role === "session-context"
        ? message.metadata.realRole
        : message.role;
    const endedAt = getEndedAt(message.metadata);
    const queue = queues.get(role) ?? [];
    queue.push({
      endedAt,
      startedAt: message.metadata.createdAt,
    });
    queues.set(role, queue);
  }

  return queues;
}

function buildToolCallTimestampMap(
  session: Session.WithMessagesAndParts,
): Map<string, TimestampRange> {
  const map = new Map<string, TimestampRange>();
  for (const message of session.messages) {
    for (const part of message.parts) {
      if (!isToolPart(part)) {
        continue;
      }
      const endedAt = getEndedAt(part.metadata);
      map.set(part.toolCallId, {
        endedAt,
        startedAt: part.metadata.createdAt,
      });
    }
  }
  return map;
}

// Wraps raw tool output in a code fence so embedded markdown (headings, lists)
// doesn't bleed into the transcript's structure. Fence length adapts to the
// longest backtick run inside the content so nested fences don't break out.
// The language tag drives syntax highlighting for the fenced block.
function fenceText(text: string, language = "markdown"): string {
  const longestBacktickRun = Math.max(
    0,
    ...[...text.matchAll(/`+/g)].map((match) => match[0].length),
  );
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
  return `${fence}${language}\n${text}\n${fence}`;
}

function formatDuration(ms: number) {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = ms / 1000;
  return `${seconds.toFixed(seconds >= 10 ? 1 : 3)}s`;
}

function formatTimestamp(timestamps: TimestampRange | undefined) {
  return timestamps ? ` @ ${timestamps.startedAt.toISOString()}` : "";
}

function formatTimestampRange(timestamps: TimestampRange | undefined) {
  if (!timestamps) {
    return "";
  }

  const start = timestamps.startedAt.toISOString();
  if (!timestamps.endedAt) {
    return ` @ ${start}`;
  }

  const durationMs =
    timestamps.endedAt.getTime() - timestamps.startedAt.getTime();
  return ` @ ${start} +${formatDuration(durationMs)}`;
}

function getEndedAt(metadata: Record<string, unknown>) {
  return metadata.endedAt instanceof Date ? metadata.endedAt : undefined;
}

function inputToXml(toolName: string, input: unknown): string {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return `<${toolName}>${JSON.stringify(input)}</${toolName}>`;
  }

  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) {
    return `<${toolName} />`;
  }

  const inner = entries
    .map(([key, value]) => {
      const text =
        typeof value === "string" ? value : JSON.stringify(value, null, 2);
      return `<${key}>${text}</${key}>`;
    })
    .join("\n");

  return `<${toolName}>\n${inner}\n</${toolName}>`;
}

function renderAssistantMessage(
  message: AssistantModelMessage,
  toolMessage: ToolModelMessage | undefined,
  toolTimestamps: Map<string, TimestampRange>,
  turn: number,
  toolCounter: { count: number },
  timestamps?: TimestampRange,
): string[] {
  const lines: string[] = [
    `## Assistant (Turn ${turn})${formatTimestamp(timestamps)}`,
    "",
  ];

  // Build a map of toolCallId -> tool result from the tool message
  const toolResultMap = new Map<
    string,
    {
      output: ToolResultPart["output"];
      toolName: string;
    }
  >();
  if (toolMessage) {
    for (const part of toolMessage.content) {
      if (part.type !== "tool-approval-response") {
        toolResultMap.set(part.toolCallId, {
          output: part.output,
          toolName: part.toolName,
        });
      }
    }
  }

  const content = message.content;
  if (typeof content === "string") {
    lines.push(content);
    return lines;
  }

  for (const part of content) {
    switch (part.type) {
      case "file": {
        lines.push(
          `*[File: ${part.filename ?? "unknown"} (${part.mediaType})]*`,
        );
        break;
      }
      case "reasoning": {
        const indented = part.text
          .split("\n")
          .map((l) => `> ${l}`)
          .join("\n");
        lines.push("", `*[Reasoning]*`, "", indented, "");
        break;
      }
      case "text": {
        lines.push(part.text);
        break;
      }
      case "tool-call": {
        toolCounter.count++;
        lines.push(
          "",
          [
            `### Tool Call ${toolCounter.count}: ${part.toolName}`,
            formatTimestampRange(toolTimestamps.get(part.toolCallId)),
          ].join(""),
          "",
          inputToXml(part.toolName, part.input),
        );

        const result = toolResultMap.get(part.toolCallId);
        if (result) {
          lines.push(
            ...renderToolResult(
              result.toolName,
              result.output,
              toolCounter.count,
            ),
          );
        }
        break;
      }
      case "tool-result": {
        // tool-result parts embedded in assistant messages (some providers)
        toolCounter.count++;
        const resultLines = renderToolResult(
          part.toolName,
          part.output,
          toolCounter.count,
        );
        lines.push(...resultLines);
        break;
      }
    }
  }

  return lines;
}

function renderMessage(
  message: ModelMessage,
  toolTimestamps: Map<string, TimestampRange>,
  turn: number,
  toolCounter: { count: number },
  timestamps?: TimestampRange,
): string[] {
  switch (message.role) {
    case "assistant": {
      return renderAssistantMessage(
        message,
        undefined,
        toolTimestamps,
        turn,
        toolCounter,
        timestamps,
      );
    }
    case "system": {
      return renderSystemMessage(message, timestamps);
    }
    case "tool": {
      return renderOrphanedToolMessage(message, toolCounter);
    }
    case "user": {
      return renderUserMessage(message, turn, timestamps);
    }
  }
}

function renderOrphanedToolMessage(
  message: ToolModelMessage,
  toolCounter: { count: number },
): string[] {
  const lines: string[] = [];

  for (const part of message.content) {
    if (part.type === "tool-approval-response") {
      continue;
    }

    toolCounter.count++;
    const toolLines = renderToolResult(
      part.toolName,
      part.output,
      toolCounter.count,
    );
    lines.push(...toolLines);
  }

  return lines;
}

// Reproduces, verbatim, the standing project-context blocks the agent receives
// for a task started from a project (instructions + folder-handling guidance),
// using the same builders as the agent so the transcript stays truthful. Sourced
// from the raw session parts because data parts are stripped from the model
// messages the rest of the transcript renders from. Skipped when full context
// messages are included, since the real blocks are already rendered there.
function renderProjectContext(
  session: Session.WithMessagesAndParts,
  includeContextMessages: boolean,
): string[] {
  if (includeContextMessages) {
    return [];
  }

  const allParts = session.messages.flatMap((message) => message.parts);

  const projectPart = allParts.find(
    (part) => part.type === "data-projectContext",
  );
  if (!projectPart) {
    return [];
  }

  // Fold project-folder names from the creation snapshot with later
  // `data-projectChanges` additions/removals and `data-attachedFolderChanges`
  // renames so the list matches what the agent currently sees, keyed by path
  // so removals/renames touch the right entry.
  const folderNamesByPath = new Map<string, string>();
  for (const part of allParts) {
    switch (part.type) {
      case "data-attachedFolderChanges": {
        for (const folder of part.data.renamed) {
          if (folderNamesByPath.has(folder.path)) {
            folderNamesByPath.set(folder.path, folder.newName);
          }
        }
        break;
      }
      case "data-attachments": {
        for (const folder of part.data.folders ?? []) {
          if (folder.source === "project") {
            folderNamesByPath.set(folder.path, folder.name);
          }
        }
        break;
      }
      case "data-projectChanges": {
        for (const folder of part.data.foldersRemoved) {
          folderNamesByPath.delete(folder.path);
        }
        for (const folder of part.data.foldersAdded) {
          folderNamesByPath.set(folder.path, folder.name);
        }
        break;
      }
      default: {
        break;
      }
    }
  }
  const projectFolderNames = [...folderNamesByPath.values()];

  const blocks: string[] = [];

  const effective = getEffectiveProjectContext(allParts);
  const instructions = effective?.instructions?.trim();
  if (instructions) {
    blocks.push(
      buildProjectContextText({
        instructions,
        name: projectPart.data.projectName,
      }),
    );
  }

  if (projectFolderNames.length > 0) {
    blocks.push(
      buildAttachedFoldersText({
        folders: projectFolderNames.map((name) => ({
          mountPoint: attachedFolderMountPoint(name),
          name,
        })),
        intro: projectFoldersIntro(projectPart.data.projectName),
      }),
    );
  }

  if (blocks.length === 0) {
    return [];
  }

  return ["## Project Context", "", fenceText(blocks.join("\n\n"), "xml")];
}

function renderSystemMessage(
  message: SystemModelMessage,
  timestamps?: TimestampRange,
): string[] {
  const indented = message.content
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  return [`## System${formatTimestamp(timestamps)}`, "", indented];
}

function renderToolResult(
  toolName: string,
  output: ToolResultPart["output"],
  toolCallIndex: number,
): string[] {
  const lines: string[] = [
    "",
    `### Tool Result ${toolCallIndex}: ${toolName}`,
    "",
  ];

  lines.push(...renderToolOutput(output));

  return lines;
}

function renderUserMessage(
  message: UserModelMessage,
  turn: number,
  timestamps?: TimestampRange,
): string[] {
  const lines: string[] = [
    `## User (Turn ${turn})${formatTimestamp(timestamps)}`,
    "",
  ];

  const content = message.content;
  if (typeof content === "string") {
    lines.push(content);
    return lines;
  }

  for (const part of content) {
    switch (part.type) {
      case "file": {
        lines.push(
          `*[File: ${part.filename ?? "unknown"} (${part.mediaType})]*`,
        );
        break;
      }
      case "image": {
        lines.push(`*[Image]*`);
        break;
      }
      case "text": {
        lines.push(part.text);
        break;
      }
    }
  }

  return lines;
}

async function sessionToMarkdown(
  rootSession: Session.WithMessagesAndParts,
  {
    frontMatter,
    includeContextMessages = false,
  }: {
    frontMatter?: Record<string, unknown>;
    includeContextMessages?: boolean;
  } = {},
): Promise<string> {
  const contextMessages = rootSession.messages.filter(
    (m) => m.role === "session-context",
  );
  const nonContextMessages = rootSession.messages.filter(
    (m) => m.role !== "session-context",
  );

  const orderedMessages = [
    ...(includeContextMessages
      ? alphabetical(contextMessages, (m) => m.id)
      : []),
    ...alphabetical(nonContextMessages, (m) => m.id),
  ];

  const modelMessages = await SessionMessage.toModelMessages(
    orderedMessages,
    TOOLS_FOR_MODEL_OUTPUT,
  );

  const toolTimestamps = buildToolCallTimestampMap(rootSession);
  const messageTimestamps = buildMessageTimestampQueues(orderedMessages);

  const parts: string[] = [`# Session: ${rootSession.title}`, ""];

  const projectContextLines = renderProjectContext(
    rootSession,
    includeContextMessages,
  );
  if (projectContextLines.length > 0) {
    parts.push(...projectContextLines, "");
  }

  let turn = 0;
  const toolCounter = { count: 0 };
  let i = 0;
  while (i < modelMessages.length) {
    const message = modelMessages[i];
    if (!message) {
      i++;
      continue;
    }

    if (message.role === "user" || message.role === "assistant") {
      turn++;
    }

    if (message.role === "assistant") {
      const nextMessage = modelMessages[i + 1];
      const toolMessage =
        nextMessage?.role === "tool" ? nextMessage : undefined;

      const rendered = renderAssistantMessage(
        message,
        toolMessage,
        toolTimestamps,
        turn,
        toolCounter,
        takeMessageTimestamp(messageTimestamps, message.role),
      );
      for (const line of rendered) {
        parts.push(line);
      }
      parts.push("");

      i += toolMessage ? 2 : 1;
      continue;
    }

    if (message.role === "tool") {
      // Orphaned tool message (not consumed by an assistant message above)
      const rendered = renderOrphanedToolMessage(message, toolCounter);
      for (const line of rendered) {
        parts.push(line);
      }
      parts.push("");
      i++;
      continue;
    }

    const rendered = renderMessage(
      message,
      toolTimestamps,
      turn,
      toolCounter,
      takeMessageTimestamp(messageTimestamps, message.role),
    );
    for (const line of rendered) {
      parts.push(line);
    }
    parts.push("");
    i++;
  }

  const lastMessage = orderedMessages.at(-1);
  if (lastMessage?.role === "assistant") {
    const pendingToolParts = lastMessage.parts.filter(
      (p) =>
        isToolPart(p) &&
        (p.state === "input-available" || p.state === "input-streaming"),
    ) as SessionMessagePart.ToolPart[];

    if (pendingToolParts.length > 0) {
      turn++;
      parts.push(`## Assistant (Turn ${turn})`, "");
      for (const part of pendingToolParts) {
        toolCounter.count++;
        // Tool name is encoded in the type as "tool-{name}"
        const toolName = part.type.slice("tool-".length);
        parts.push(
          "",
          `### Tool Call ${toolCounter.count}: ${toolName} *(incomplete)*`,
          "",
          inputToXml(toolName, part.input),
        );
      }
      parts.push("");
    }
  }

  const body = parts.join("\n");

  if (!frontMatter || Object.keys(frontMatter).length === 0) {
    return body;
  }

  const yamlLines = Object.entries(frontMatter).map(([key, value]) => {
    if (typeof value === "string") {
      return `${key}: ${value.includes("\n") || value.includes(":") ? JSON.stringify(value) : value}`;
    }
    return `${key}: ${JSON.stringify(value)}`;
  });

  return `---\n${yamlLines.join("\n")}\n---\n\n${body}`;
}

function takeMessageTimestamp(
  queues: Map<ModelMessage["role"], TimestampRange[]>,
  role: ModelMessage["role"],
) {
  return queues.get(role)?.shift();
}
