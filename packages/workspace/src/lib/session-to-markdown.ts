import { namesSameModel } from "@instrument-org/ai-gateway";
import {
  type AssistantModelMessage,
  type ModelMessage,
  type SystemModelMessage,
  type ToolModelMessage,
  type ToolResultPart,
  type UserModelMessage,
} from "ai";
import { alphabetical } from "radashi";

import { type FolderAttachment } from "../schemas/folder-attachment";
import { type Session } from "../schemas/session";
import { SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { TOOLS_FOR_MODEL_OUTPUT } from "../tools/all";
import { attachedFolderMountPoint } from "./attached-folder-mounts";
import { buildAttachedFoldersText } from "./build-attached-folders-text";
import {
  buildProjectContextText,
  projectFoldersIntro,
} from "./build-project-context-text";
import { getEffectiveProjectContext } from "./effective-project-context";
import { isUntitledChatSessionTitle } from "./generate-session-title";
import { isToolPart } from "./is-tool-part";
import { normalizeProjectInstructions } from "./project-instructions";
import { Store } from "./store";
import { taskDir } from "./task-dir-utils";
import { getTaskSettings } from "./task-settings";
import { getUsageSummaryFromMessages } from "./usage-summary-compute";

interface MessageRenderInfo {
  assistantMetadata?: SessionMessage.Assistant["metadata"];
  contextMetadata?: SessionMessage.Context["metadata"];
  endedAt?: Date;
  sourceMessage: SessionMessage.WithParts;
  startedAt: Date;
}

const EMPTY_ASSISTANT_TRANSCRIPT_MARKER =
  "__INSTRUMENT_TRANSCRIPT_EMPTY_ASSISTANT_STEP__";

export function buildSessionFrontMatter(
  session: Session.WithMessagesAndParts,
): Record<string, unknown> {
  const assistantMessages = session.messages.filter(
    (message) => message.role === "assistant",
  );
  const usage = getUsageSummaryFromMessages(session.messages);

  const modelMap = new Map<
    string,
    { modelId: string; modelUri?: string; providerId: string }
  >();
  for (const message of assistantMessages) {
    const { aiGatewayModel, modelId, providerId } = message.metadata;
    const modelUri = aiGatewayModel?.uri;
    modelMap.set(modelUri ?? `${providerId}\0${modelId}`, {
      modelId,
      ...(modelUri ? { modelUri } : {}),
      providerId,
    });
  }

  // Kept apart from modelsUsed, which answers what the session asked for. A
  // session run entirely on one routing alias asks for one thing and can be
  // served by several, and that set is the one worth having when a transcript
  // is read to explain how a turn went.
  const modelsServed = [
    ...new Set(
      assistantMessages.flatMap(({ metadata }) =>
        metadata.modelIdServed &&
        !namesSameModel(
          metadata.aiGatewayModel?.providerId,
          metadata.modelIdServed,
        )
          ? [metadata.modelIdServed]
          : [],
      ),
    ),
  ].sort((a, b) => a.localeCompare(b));

  const toolCallCount = session.messages
    .flatMap((message) => message.parts)
    .filter(isToolPart).length;
  const userMessageCount = session.messages.filter(
    (message) => message.role === "user",
  ).length;

  return {
    // Time the session spent working, which is not the span it covers: a
    // session sits idle between one turn and the next prompt, and counting that
    // reports the reader's coffee break as work.
    activeDurationMs: usage.activeMs,
    aiGenerationDurationMs: usage.msToFinish,
    assistantMessageCount: assistantMessages.length,
    messageCount: session.messages.length,
    ...(modelsServed.length > 0 ? { modelsServed } : {}),
    modelsUsed: [...modelMap.values()].sort((a, b) =>
      `${a.providerId}/${a.modelId}`.localeCompare(
        `${b.providerId}/${b.modelId}`,
      ),
    ),
    parentSessionId: session.parentId,
    sessionCreatedAt: session.createdAt.toISOString(),
    sessionId: session.id,
    sessionTitle: session.title,
    toolCallCount,
    usage: {
      cacheReadTokens: usage.inputTokenDetails.cacheReadTokens,
      cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.outputTokenDetails.reasoningTokens,
      totalTokens: usage.totalTokens,
    },
    userMessageCount,
  };
}

export async function getSessionMarkdown({
  frontMatter,
  includeContextMessages = true,
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
  const settings = await getTaskSettings(taskDir(taskId));

  return sessionToMarkdown(result.value, {
    frontMatter,
    includeContextMessages,
    taskName: settings?.name,
  });
}

export function renderAssistantMetadata(
  metadata: SessionMessage.Assistant["metadata"] | undefined,
): string[] {
  if (!metadata) {
    return [];
  }

  const fields = [
    `provider=${metadata.providerId}`,
    `model=${metadata.modelId}`,
  ];
  // Read by the same rule as the transcript, and against the provider's own id
  // for the requested model rather than against `modelId`, which is the
  // canonical id and so never equals a provider id: `claude-haiku-4.5` against
  // `anthropic/claude-haiku-4.5` differs on every message, and dropping the
  // author from one side of a comparison is enough to report an alias on a step
  // that never went through one. Messages recorded before the field only held
  // differences still come through here.
  if (
    metadata.modelIdServed &&
    !namesSameModel(metadata.aiGatewayModel?.providerId, metadata.modelIdServed)
  ) {
    fields.push(`served=${metadata.modelIdServed}`);
  }
  if (metadata.aiGatewayModel) {
    fields.push(`modelUri=${metadata.aiGatewayModel.uri}`);
  }

  if (metadata.synthetic) {
    fields.push("synthetic=true");
  }
  fields.push(`finishReason=${metadata.finishReason}`);

  const usage = metadata.usage;
  if (usage) {
    fields.push(
      `inputTokens=${usage.inputTokens ?? "unknown"}`,
      `cacheReadTokens=${usage.inputTokenDetails.cacheReadTokens ?? "unknown"}`,
      `cacheWriteTokens=${usage.inputTokenDetails.cacheWriteTokens ?? "unknown"}`,
      `noCacheTokens=${usage.inputTokenDetails.noCacheTokens ?? "unknown"}`,
      `outputTokens=${usage.outputTokens ?? "unknown"}`,
      `reasoningTokens=${usage.outputTokenDetails.reasoningTokens ?? "unknown"}`,
      `textTokens=${usage.outputTokenDetails.textTokens ?? "unknown"}`,
      `totalTokens=${usage.totalTokens ?? "unknown"}`,
    );
  }
  if (metadata.msToFirstChunk !== undefined) {
    fields.push(`timeToFirstChunk=${formatDuration(metadata.msToFirstChunk)}`);
  }
  if (metadata.msToFinish !== undefined) {
    fields.push(`generationDuration=${formatDuration(metadata.msToFinish)}`);
  }
  if (metadata.completionTokensPerSecond !== undefined) {
    fields.push(
      `completionTokensPerSecond=${metadata.completionTokensPerSecond}`,
    );
  }

  const lines = [`*Response metadata: ${fields.join(", ")}*`, ""];
  if (metadata.error) {
    lines.push(
      "**Assistant error:**",
      fenceText(JSON.stringify(metadata.error, null, 2), "json"),
      "",
    );
  }

  return lines;
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
      lines.push("**Error:**", fenceText(output.value, "text"));
      break;
    }
    case "execution-denied": {
      if (output.reason) {
        lines.push(`*Execution denied:*`, fenceText(output.reason, "text"));
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

export async function sessionToMarkdown(
  rootSession: Session.WithMessagesAndParts,
  {
    frontMatter,
    includeContextMessages = true,
    taskName,
  }: {
    frontMatter?: Record<string, unknown>;
    includeContextMessages?: boolean;
    /**
     * What the transcript is headed with when the session has no name of its
     * own. A session's title names it among the task's other sessions (a
     * channel's name, a later chat's), and a session that is the task's only
     * one keeps the placeholder it was created with, so the task's name is
     * the one a reader knows it by.
     */
    taskName?: string;
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

  // The session's baseline names the agent it was written for, which is the
  // agent every note in the transcript was phrased for.
  const agentName = rootSession.messages.find(
    (m): m is SessionMessage.ContextWithParts => m.role === "session-context",
  )?.metadata.agentName;
  const modelMessages = await SessionMessage.toModelMessages(
    makeEmptyAssistantStepsVisible(orderedMessages),
    TOOLS_FOR_MODEL_OUTPUT,
    { agentName },
  );

  const toolTimestamps = buildToolCallTimestampMap(rootSession);
  const messageTimestamps = buildMessageTimestampQueues(orderedMessages);

  const heading =
    isUntitledChatSessionTitle(rootSession.title) && taskName
      ? taskName
      : rootSession.title;
  const parts: string[] = [`# ${heading}`, ""];

  if (includeContextMessages && contextMessages.length > 0) {
    parts.push(
      "## Latest Persisted Context Snapshot",
      "",
      "> These are the latest context messages retained for this session. Context can be refreshed during long sessions, so this snapshot may differ from context used by earlier responses. Turn-level injected context is reconstructed by the currently running app version.",
      "",
    );
  }

  const projectContextLines = renderProjectContext(
    rootSession,
    includeContextMessages,
  );
  if (projectContextLines.length > 0) {
    parts.push(...projectContextLines, "");
  }

  let userTurn = 0;
  const toolCounter = { count: 0 };
  const renderedToolCallIds = new Set<string>();
  let i = 0;
  while (i < modelMessages.length) {
    const message = modelMessages[i];
    if (!message) {
      i++;
      continue;
    }

    const renderInfo =
      message.role === "tool"
        ? undefined
        : takeMessageTimestamp(messageTimestamps, message.role);

    if (renderInfo?.contextMetadata) {
      const rendered = renderContextMessage(
        message,
        renderInfo,
        toolTimestamps,
        toolCounter,
      );
      parts.push(...rendered, "");
      i++;
      continue;
    }

    if (message.role === "user") {
      userTurn++;
    }

    if (message.role === "assistant") {
      const nextMessage = modelMessages[i + 1];
      const toolMessage =
        nextMessage?.role === "tool" ? nextMessage : undefined;

      const rendered = renderAssistantMessage(
        message,
        toolMessage,
        toolTimestamps,
        userTurn,
        toolCounter,
        renderedToolCallIds,
        renderInfo,
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
      userTurn,
      toolCounter,
      renderedToolCallIds,
      renderInfo,
    );
    for (const line of rendered) {
      parts.push(line);
    }
    parts.push("");
    i++;
  }

  const body = parts.join("\n");

  const combinedFrontMatter = {
    ...frontMatter,
    ...buildSessionFrontMatter(rootSession),
  };

  const yamlLines = Object.entries(combinedFrontMatter).flatMap(
    ([key, value]) => {
      if (value === undefined) {
        return [];
      }
      const serialized = JSON.stringify(value);
      return [`${key}: ${serialized}`];
    },
  );

  return `---\n${yamlLines.join("\n")}\n---\n\n${body}`;
}

function buildMessageTimestampQueues(
  messages: SessionMessage.WithParts[],
): Map<ModelMessage["role"], MessageRenderInfo[]> {
  const queues = new Map<ModelMessage["role"], MessageRenderInfo[]>();

  for (const message of messages) {
    const role =
      message.role === "session-context"
        ? message.metadata.realRole
        : message.role;
    const endedAt = getEndedAt(message.metadata);
    const queue = queues.get(role) ?? [];
    queue.push({
      assistantMetadata:
        message.role === "assistant" ? message.metadata : undefined,
      contextMetadata:
        message.role === "session-context" ? message.metadata : undefined,
      endedAt,
      sourceMessage: message,
      startedAt: message.metadata.createdAt,
    });
    queues.set(role, queue);
  }

  return queues;
}

function buildToolCallTimestampMap(
  session: Session.WithMessagesAndParts,
): Map<string, MessageRenderInfo> {
  const map = new Map<string, MessageRenderInfo>();
  for (const message of session.messages) {
    for (const part of message.parts) {
      if (!isToolPart(part)) {
        continue;
      }
      const endedAt = getEndedAt(part.metadata);
      map.set(part.toolCallId, {
        endedAt,
        sourceMessage: message,
        startedAt: part.metadata.createdAt,
      });
    }
  }
  return map;
}

// Wraps content in a code fence so embedded markdown (headings, lists) and
// embedded HTML don't bleed into the transcript's structure. Fence length
// adapts to the longest backtick run inside the content so nested fences don't
// break out. The language tag drives syntax highlighting for the fenced block.
//
// This is the transcript's contract: its structure is the generator's own
// headings and labels, and everything else -- the model's context, the user's
// turn, reasoning, tool input, tool output -- is fenced. The one exception is
// the assistant's reply, which is markdown written to be rendered, and whose
// `files` fence is what a viewer draws as file chips.
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

function formatTimestamp(timestamps: MessageRenderInfo | undefined) {
  return timestamps ? ` @ ${timestamps.startedAt.toISOString()}` : "";
}

function formatTimestampRange(timestamps: MessageRenderInfo | undefined) {
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

// The longest argument that still sits on its own list line. Past this, or at
// the first line break, a value gets a fence of its own.
const INLINE_ARGUMENT_MAX_LENGTH = 120;

// Code span delimiters sized to the value, the inline counterpart of
// `fenceText`: one more backtick than the longest run inside, and a space of
// padding when the value starts or ends with one, which is the case where the
// delimiters would otherwise merge with the content.
function codeSpan(text: string): string {
  const longestBacktickRun = Math.max(
    0,
    ...[...text.matchAll(/`+/g)].map((match) => match[0].length),
  );
  const delimiter = "`".repeat(longestBacktickRun + 1);
  const padded =
    text.startsWith("`") || text.endsWith("`") ? ` ${text} ` : text;
  return `${delimiter}${padded}${delimiter}`;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  bash: "bash",
  c: "c",
  cjs: "js",
  cpp: "cpp",
  css: "css",
  csv: "csv",
  go: "go",
  h: "c",
  htm: "html",
  html: "html",
  java: "java",
  js: "js",
  json: "json",
  jsx: "jsx",
  kt: "kotlin",
  md: "markdown",
  mjs: "js",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  sql: "sql",
  svg: "xml",
  swift: "swift",
  toml: "toml",
  ts: "ts",
  tsx: "tsx",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

/**
 * A tool call's arguments, with every value held apart from the transcript's
 * own markup.
 *
 * Short scalars share one list, each in a code span; anything with a line
 * break or too long for a line gets a labeled fence, tagged with the language
 * its key implies. What this rules out is any argument being read as
 * structure: a `command` holding `<a href=` or a `content` holding a README's
 * headings is content, and a renderer that saw it bare would draw the anchor
 * and the headings -- and, for the HTML5 recovery a raw `<a>` triggers, wrap
 * everything after it in the link.
 *
 * Non-object input is what a call that never finished arriving carries, its
 * raw JSON text so far, and is shown as that.
 */
export function renderToolInput(input: unknown): string[] {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return [
      fenceText(
        typeof input === "string" ? input : JSON.stringify(input, null, 2),
        "json",
      ),
    ];
  }

  const record = input as Record<string, unknown>;
  const inline: string[] = [];
  const blocks: string[][] = [];
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) {
      continue;
    }
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (!text.includes("\n") && text.length <= INLINE_ARGUMENT_MAX_LENGTH) {
      inline.push(
        `- **${key}:** ${text === "" ? "*(empty)*" : codeSpan(text)}`,
      );
      continue;
    }
    const fenced =
      typeof value === "string"
        ? fenceText(value, argumentLanguage(key, record))
        : fenceText(JSON.stringify(value, null, 2), "json");
    blocks.push([`**${key}**`, "", fenced]);
  }

  const groups = [...(inline.length > 0 ? [inline] : []), ...blocks];
  if (groups.length === 0) {
    return ["*(no arguments)*"];
  }
  return groups.flatMap((group, index) =>
    index === 0 ? group : ["", ...group],
  );
}

// The language a fenced argument is highlighted as: a shell command is bash,
// and text bound for a file takes the file's own language, read off the
// `filePath` argument beside it. Everything else is prose or a path.
function argumentLanguage(key: string, input: Record<string, unknown>): string {
  if (key === "command") {
    return "bash";
  }
  if (key === "content" || key === "newString" || key === "oldString") {
    const filePath = input.filePath;
    const extension =
      typeof filePath === "string"
        ? /\.([a-z0-9]+)$/i.exec(filePath)?.[1]?.toLowerCase()
        : undefined;
    return (extension && LANGUAGE_BY_EXTENSION[extension]) ?? "text";
  }
  return "text";
}

function isDataPart(
  part: SessionMessagePart.Type,
): part is SessionMessagePart.DataPart {
  return part.type.startsWith("data-");
}

function isModelVisibleAssistantPart(part: SessionMessagePart.Type) {
  if (
    part.type === "file" ||
    part.type === "reasoning" ||
    part.type === "source-document" ||
    part.type === "source-url"
  ) {
    return true;
  }
  if (part.type === "text") {
    return part.text.trim().length > 0;
  }
  return (
    isToolPart(part) &&
    (part.state === "output-available" || part.state === "output-error")
  );
}

function makeEmptyAssistantStepsVisible(
  messages: SessionMessage.WithParts[],
): SessionMessage.WithParts[] {
  return messages.map((message) => {
    if (
      message.role !== "assistant" ||
      message.parts.some(isModelVisibleAssistantPart)
    ) {
      return message;
    }

    return {
      ...message,
      parts: [
        ...message.parts,
        {
          metadata: {
            createdAt: message.metadata.createdAt,
            id: StoreId.newPartId(),
            messageId: message.id,
            sessionId: message.metadata.sessionId,
          },
          text: EMPTY_ASSISTANT_TRANSCRIPT_MARKER,
          type: "text",
        },
      ],
    };
  });
}

function renderAssistantMessage(
  message: AssistantModelMessage,
  toolMessage: ToolModelMessage | undefined,
  toolTimestamps: Map<string, MessageRenderInfo>,
  userTurn: number,
  toolCounter: { count: number },
  renderedToolCallIds: Set<string>,
  renderInfo?: MessageRenderInfo,
): string[] {
  const stepCount = renderInfo?.sourceMessage.parts.find(
    (part) => part.type === "step-start",
  )?.metadata.stepCount;
  const turnAndStep = [
    `User Turn ${userTurn}`,
    ...(stepCount === undefined ? [] : [`Step ${stepCount}`]),
  ].join(", ");
  const lines: string[] = [
    `## Assistant (${turnAndStep})${formatTimestamp(renderInfo)}`,
    "",
    ...renderAssistantMetadata(renderInfo?.assistantMetadata),
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
    lines.push(renderAssistantText(content));
  } else {
    for (const part of content) {
      switch (part.type) {
        case "file": {
          lines.push(
            `*[File: ${part.filename ?? "unknown"} (${part.mediaType})]*`,
          );
          break;
        }
        case "reasoning": {
          lines.push("", `*[Reasoning]*`, "", fenceText(part.text), "");
          break;
        }
        case "text": {
          lines.push(renderAssistantText(part.text));
          break;
        }
        case "tool-call": {
          renderedToolCallIds.add(part.toolCallId);
          toolCounter.count++;
          const persistedPart = renderInfo?.sourceMessage.parts.find(
            (candidate) =>
              isToolPart(candidate) && candidate.toolCallId === part.toolCallId,
          );
          lines.push(
            "",
            [
              `### Tool Call ${toolCounter.count}: ${part.toolName}`,
              formatTimestampRange(toolTimestamps.get(part.toolCallId)),
            ].join(""),
            "",
            ...renderToolInput(part.input),
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
          if (persistedPart && isToolPart(persistedPart)) {
            lines.push(...renderToolDiagnostics(persistedPart));
          }
          break;
        }
        case "tool-result": {
          // tool-result parts embedded in assistant messages (some providers)
          renderedToolCallIds.add(part.toolCallId);
          toolCounter.count++;
          const resultLines = renderToolResult(
            part.toolName,
            part.output,
            toolCounter.count,
          );
          lines.push(...resultLines);
          const persistedPart = renderInfo?.sourceMessage.parts.find(
            (candidate) =>
              isToolPart(candidate) && candidate.toolCallId === part.toolCallId,
          );
          if (persistedPart && isToolPart(persistedPart)) {
            lines.push(...renderToolDiagnostics(persistedPart));
          }
          break;
        }
      }
    }
  }

  if (renderInfo) {
    lines.push(
      ...renderPersistedAssistantParts(
        renderInfo.sourceMessage,
        renderedToolCallIds,
        toolCounter,
      ),
    );
  }

  return lines;
}

function renderAssistantText(text: string) {
  return text === EMPTY_ASSISTANT_TRANSCRIPT_MARKER
    ? "> No model-visible assistant content was persisted for this step."
    : text;
}

function renderContextMessage(
  message: ModelMessage,
  renderInfo: MessageRenderInfo,
  toolTimestamps: Map<string, MessageRenderInfo>,
  toolCounter: { count: number },
): string[] {
  const metadata = renderInfo.contextMetadata;
  if (!metadata) {
    return [];
  }
  if (message.role === "tool") {
    return [];
  }

  const roleLabel =
    metadata.realRole === "system"
      ? "System Context"
      : metadata.realRole === "user"
        ? "Agent Context"
        : "Assistant Context";
  const heading = `### ${roleLabel} (${metadata.agentName})${formatTimestamp(renderInfo)}`;
  const rendered =
    message.role === "assistant"
      ? renderAssistantMessage(
          message,
          undefined,
          toolTimestamps,
          0,
          toolCounter,
          new Set(),
          renderInfo,
        )
      : message.role === "system"
        ? renderSystemMessage(message, renderInfo)
        : renderUserMessage(message, 0, renderInfo);

  return [heading, "", ...rendered.slice(2)];
}

function renderMessage(
  message: ModelMessage,
  toolTimestamps: Map<string, MessageRenderInfo>,
  userTurn: number,
  toolCounter: { count: number },
  renderedToolCallIds: Set<string>,
  renderInfo?: MessageRenderInfo,
): string[] {
  switch (message.role) {
    case "assistant": {
      return renderAssistantMessage(
        message,
        undefined,
        toolTimestamps,
        userTurn,
        toolCounter,
        renderedToolCallIds,
        renderInfo,
      );
    }
    case "system": {
      return renderSystemMessage(message, renderInfo);
    }
    case "tool": {
      return renderOrphanedToolMessage(message, toolCounter);
    }
    case "user": {
      return renderUserMessage(message, userTurn, renderInfo);
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

function renderPersistedAssistantParts(
  message: SessionMessage.WithParts,
  renderedToolCallIds: Set<string>,
  toolCounter: { count: number },
): string[] {
  const lines: string[] = [];
  const seenSourceIds = new Set<string>();
  const sources: Record<string, unknown>[] = [];

  for (const part of message.parts) {
    if (part.type === "source-url") {
      if (seenSourceIds.has(part.sourceId)) {
        continue;
      }
      seenSourceIds.add(part.sourceId);
      sources.push({
        sourceId: part.sourceId,
        title: part.title,
        type: "url",
        url: part.url,
      });
      continue;
    }
    if (part.type === "source-document") {
      if (seenSourceIds.has(part.sourceId)) {
        continue;
      }
      seenSourceIds.add(part.sourceId);
      sources.push({
        filename: part.filename,
        mediaType: part.mediaType,
        sourceId: part.sourceId,
        title: part.title,
        type: "document",
      });
      continue;
    }
    if (isDataPart(part)) {
      lines.push(
        "",
        `### Persisted Data: ${part.type.slice("data-".length)}`,
        "",
        fenceText(JSON.stringify(part.data, null, 2), "json"),
      );
      continue;
    }
    if (!isToolPart(part) || renderedToolCallIds.has(part.toolCallId)) {
      continue;
    }
    if (
      part.state !== "input-available" &&
      part.state !== "input-streaming" &&
      part.state !== "output-error"
    ) {
      continue;
    }

    renderedToolCallIds.add(part.toolCallId);
    toolCounter.count++;
    const toolName = part.type.slice("tool-".length);
    const status =
      part.state === "output-error" ? "failed" : `incomplete: ${part.state}`;
    lines.push(
      "",
      [
        `### Tool Call ${toolCounter.count}: ${toolName} *(${status})*`,
        formatTimestampRange({
          endedAt: getEndedAt(part.metadata),
          sourceMessage: message,
          startedAt: part.metadata.createdAt,
        }),
      ].join(""),
      "",
      ...renderToolInput(part.rawInput ?? part.input),
      ...renderToolDiagnostics(part),
    );
  }

  if (sources.length > 0) {
    lines.push(
      "",
      "### Sources",
      "",
      fenceText(JSON.stringify(sources, null, 2), "json"),
    );
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
  const projectFoldersByPath = new Map<
    string,
    { access: FolderAttachment.Access; name: string }
  >();
  for (const part of allParts) {
    switch (part.type) {
      case "data-attachedFolderChanges": {
        for (const folder of part.data.renamed) {
          const current = projectFoldersByPath.get(folder.path);
          if (current) {
            projectFoldersByPath.set(folder.path, {
              ...current,
              name: folder.newName,
            });
          }
        }
        break;
      }
      case "data-attachments": {
        for (const folder of part.data.folders ?? []) {
          if (folder.source === "project") {
            projectFoldersByPath.set(folder.path, {
              access: folder.access,
              name: folder.mountName,
            });
          }
        }
        break;
      }
      case "data-projectChanges": {
        for (const folder of part.data.foldersRemoved) {
          projectFoldersByPath.delete(folder.path);
        }
        for (const folder of part.data.foldersAdded) {
          projectFoldersByPath.set(folder.path, {
            access: folder.access,
            name: folder.name,
          });
        }
        break;
      }
      default: {
        break;
      }
    }
  }
  const projectFolders = [...projectFoldersByPath.entries()].map(
    ([path, folder]) => ({ ...folder, path }),
  );

  const blocks: string[] = [];

  const effective = getEffectiveProjectContext(allParts);
  // Capped the same way the session context is, so the transcript reproduces
  // what the agent was given rather than the whole file behind it.
  const instructions = normalizeProjectInstructions(
    effective?.instructions ?? "",
  );
  blocks.push(
    buildProjectContextText({
      instructions,
      name: projectPart.data.projectName,
    }),
  );

  if (projectFolders.length > 0) {
    blocks.push(
      buildAttachedFoldersText({
        folders: projectFolders.map(({ access, name, path }) => ({
          access,
          mountPoint: attachedFolderMountPoint(name),
          path,
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
  timestamps?: MessageRenderInfo,
): string[] {
  return [
    `## System${formatTimestamp(timestamps)}`,
    "",
    fenceText(message.content),
  ];
}

function renderToolDiagnostics(part: SessionMessagePart.ToolPart): string[] {
  const hasDiagnostics =
    part.state === "output-error" ||
    part.approval !== undefined ||
    part.preliminary === true ||
    part.providerExecuted === true ||
    part.rawInput !== undefined ||
    part.title !== undefined;
  if (!hasDiagnostics) {
    return [];
  }

  return [
    "",
    "**Persisted tool diagnostics:**",
    "",
    fenceText(
      JSON.stringify(
        {
          state: part.state,
          ...(part.title === undefined ? {} : { title: part.title }),
          ...(part.errorText === undefined
            ? {}
            : { errorText: part.errorText }),
          ...(part.rawInput === undefined ? {} : { rawInput: part.rawInput }),
          ...(part.providerExecuted === undefined
            ? {}
            : { providerExecuted: part.providerExecuted }),
          ...(part.preliminary === undefined
            ? {}
            : { preliminary: part.preliminary }),
          ...(part.approval === undefined ? {} : { approval: part.approval }),
        },
        null,
        2,
      ),
      "json",
    ),
  ];
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
  timestamps?: MessageRenderInfo,
): string[] {
  const lines: string[] = [
    `## User (Turn ${turn})${formatTimestamp(timestamps)}`,
    "",
  ];

  const content = message.content;
  if (typeof content === "string") {
    lines.push(fenceText(content));
    return lines;
  }

  // The message reaches the model as a run of text parts -- the wrapper, the
  // words, the closing tag, the folder list -- which is one text to a reader,
  // so consecutive ones share a fence rather than each taking their own.
  let text: string[] = [];
  const flush = () => {
    if (text.length > 0) {
      lines.push(fenceText(text.join("\n")));
      text = [];
    }
  };
  for (const part of content) {
    switch (part.type) {
      case "file": {
        flush();
        lines.push(
          `*[File: ${part.filename ?? "unknown"} (${part.mediaType})]*`,
        );
        break;
      }
      case "image": {
        flush();
        lines.push(`*[Image]*`);
        break;
      }
      case "text": {
        text.push(part.text);
        break;
      }
    }
  }
  flush();

  return lines;
}

function takeMessageTimestamp(
  queues: Map<ModelMessage["role"], MessageRenderInfo[]>,
  role: ModelMessage["role"],
) {
  return queues.get(role)?.shift();
}
