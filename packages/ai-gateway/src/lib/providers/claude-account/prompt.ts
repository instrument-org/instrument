import { createHash } from "node:crypto";
import {
  type LanguageModelV4FilePart,
  type LanguageModelV4Message,
  type LanguageModelV4Prompt,
  type LanguageModelV4TextPart,
  type LanguageModelV4ToolResultOutput,
} from "@ai-sdk/provider";
import {
  type ContentBlockParam,
  type ImageBlockParam,
  type TextBlockParam,
} from "@anthropic-ai/sdk/resources/messages";
import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

type UserContentPart = LanguageModelV4FilePart | LanguageModelV4TextPart;

/**
 * The leading system messages, which become the CLI's system prompt. A system
 * message later in the prompt is a correction riding with a turn, and is sent
 * as that turn's text instead.
 */
export function splitSystemPrompt(prompt: LanguageModelV4Prompt) {
  const firstOther = prompt.findIndex((message) => message.role !== "system");
  const leading = firstOther === -1 ? prompt : prompt.slice(0, firstOther);
  return {
    rest: firstOther === -1 ? [] : prompt.slice(firstOther),
    systemPrompt: leading
      .flatMap((message) =>
        message.role === "system" ? [message.content] : [],
      )
      .join("\n\n"),
  };
}

/**
 * Messages the CLI has not seen yet that open a new turn: user messages and
 * the system corrections between them, as one user message's content.
 */
export function turnContent(
  messages: LanguageModelV4Message[],
): ContentBlockParam[] {
  return messages.flatMap((message) => {
    switch (message.role) {
      case "system": {
        return [{ text: message.content, type: "text" as const }];
      }
      case "user": {
        return message.content.flatMap(userPartToBlock);
      }
      default: {
        return [];
      }
    }
  });
}

/**
 * A prompt the CLI never saw, flattened into one user message: the earlier
 * conversation as a transcript, then the turn to answer. Lossy by design.
 * Reasoning is dropped, files in earlier turns become their names, and the
 * provider cache starts over.
 */
export function coldStartContent(
  messages: LanguageModelV4Message[],
): ContentBlockParam[] {
  let tailStart = messages.length;
  while (
    tailStart > 0 &&
    (messages[tailStart - 1]?.role === "user" ||
      messages[tailStart - 1]?.role === "system")
  ) {
    tailStart--;
  }
  const history = messages.slice(0, tailStart);
  const tail = messages.slice(tailStart);
  const blocks: ContentBlockParam[] = [];

  if (history.length > 0) {
    blocks.push({
      text: [
        "<conversation_history>",
        ...history.map(renderHistoryMessage),
        "</conversation_history>",
        tail.length === 0
          ? "Continue from the last tool results above."
          : "The conversation so far is above. The new message follows.",
      ].join("\n"),
      type: "text",
    });
  }
  blocks.push(...turnContent(tail));
  return blocks;
}

/**
 * One message of history as Claude Code takes it on its input: a user-side
 * message (text, files, tool results) or an assistant message of ours.
 */
export type ReplayFrame =
  | { content: ContentBlockParam[]; role: "user" }
  | {
      content: ContentBlockParam[];
      model: string | undefined;
      role: "assistant";
    };

/** What a reasoning part of ours carries back to Claude, written by `pumpStep`. */
interface ClaudeReasoningMetadata {
  /** The model that thought it; Claude Code drops a signed block from another. */
  model?: string;
  /** A redacted block's opaque data, in place of its text. */
  redactedData?: string;
  signature?: string;
}

function reasoningMetadataOf(
  providerOptions: Record<string, unknown> | undefined,
): ClaudeReasoningMetadata {
  const value = providerOptions?.[CLAUDE_ACCOUNT_KEY];
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const read = (name: string) => {
    const field: unknown = Reflect.get(value, name);
    return typeof field === "string" ? field : undefined;
  };
  return {
    model: read("model"),
    redactedData: read("redactedData"),
    signature: read("signature"),
  };
}

const CLAUDE_ACCOUNT_KEY = "claude-account";

/** The ids Claude takes for a tool call. */
const CLAUDE_TOOL_ID = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * A tool call's id as Claude takes it: unchanged when it can, else one made
 * from it, the same for the call and its result. Another provider's ids can
 * hold characters Claude refuses (`functions.bash:0`).
 */
function claudeToolId(id: string) {
  return CLAUDE_TOOL_ID.test(id)
    ? id
    : `toolu_${createHash("sha256").update(id).digest("hex").slice(0, 40)}`;
}

/**
 * A prompt the CLI never saw, as Claude Code's own history: user messages,
 * our assistant messages with their tool calls, and tool results, files and
 * images intact, ending on the user-side message that starts the step.
 * Reasoning is kept when Claude signed it; reasoning from anyone else is
 * left out. Throws when the history cannot be told this way (it does not
 * end on the user's side), so the caller can fall back to `coldStartContent`.
 */
export function replayFrames(
  messages: LanguageModelV4Message[],
  toolPrefix: string,
): ReplayFrame[] {
  const frames: ReplayFrame[] = [];
  const userSide = (blocks: ContentBlockParam[]) => {
    if (blocks.length === 0) {
      return;
    }
    const last = frames.at(-1);
    if (last?.role === "user") {
      last.content.push(...blocks);
    } else {
      frames.push({ content: blocks, role: "user" });
    }
  };
  // Calls a replayed assistant message made, until a result answers each.
  let unanswered: string[] = [];
  const answerUnanswered = () => {
    // An interrupted call has no result, which Claude refuses to read past.
    userSide(
      unanswered.map((id) => ({
        content: "The call did not finish.",
        is_error: true,
        tool_use_id: claudeToolId(id),
        type: "tool_result" as const,
      })),
    );
    unanswered = [];
  };

  for (const message of messages) {
    switch (message.role) {
      case "system": {
        answerUnanswered();
        userSide([{ text: message.content, type: "text" }]);
        break;
      }
      case "user": {
        answerUnanswered();
        userSide(message.content.flatMap(userPartToBlock));
        break;
      }
      case "assistant": {
        answerUnanswered();
        const content: ContentBlockParam[] = [];
        let model: string | undefined;
        for (const part of message.content) {
          if (part.type === "text" && part.text.length > 0) {
            content.push({ text: part.text, type: "text" });
          } else if (part.type === "reasoning") {
            const metadata = reasoningMetadataOf(part.providerOptions);
            if (metadata.redactedData !== undefined) {
              content.push({
                data: metadata.redactedData,
                type: "redacted_thinking",
              });
              model ??= metadata.model;
            } else if (metadata.signature !== undefined) {
              content.push({
                signature: metadata.signature,
                thinking: part.text,
                type: "thinking",
              });
              model ??= metadata.model;
            }
          } else if (part.type === "tool-call" && !part.providerExecuted) {
            content.push({
              id: claudeToolId(part.toolCallId),
              input: part.input,
              name: `${toolPrefix}${part.toolName}`,
              type: "tool_use",
            });
            unanswered.push(part.toolCallId);
          }
        }
        if (content.length > 0) {
          frames.push({ content, model, role: "assistant" });
        }
        break;
      }
      case "tool": {
        const results = message.content.flatMap((part) => {
          if (
            part.type !== "tool-result" ||
            !unanswered.includes(part.toolCallId)
          ) {
            return [];
          }
          unanswered = unanswered.filter((id) => id !== part.toolCallId);
          const result = toolResultToMCP(part.output);
          return [
            {
              content: result.content.flatMap(mcpContentToBlock),
              ...(result.isError && { is_error: true }),
              tool_use_id: claudeToolId(part.toolCallId),
              type: "tool_result" as const,
            },
          ];
        });
        userSide(results);
        break;
      }
    }
  }
  answerUnanswered();
  if (frames.at(-1)?.role !== "user" || frames[0]?.role !== "user") {
    throw new Error("The history neither starts nor ends on the user's side.");
  }
  return frames;
}

function mcpContentToBlock(
  item: CallToolResult["content"][number],
): (ImageBlockParam | TextBlockParam)[] {
  if (item.type === "text") {
    return [{ text: item.text, type: "text" }];
  }
  if (item.type === "image") {
    const media_type = IMAGE_MEDIA_TYPES.find((type) => type === item.mimeType);
    return media_type
      ? [
          {
            source: { data: item.data, media_type, type: "base64" },
            type: "image",
          },
        ]
      : [{ text: `[${item.mimeType}]`, type: "text" }];
  }
  return [];
}

function renderHistoryMessage(message: LanguageModelV4Message): string {
  switch (message.role) {
    case "system": {
      return `<system>\n${message.content}\n</system>`;
    }
    case "user": {
      return `<user>\n${message.content.map(renderUserPart).join("\n")}\n</user>`;
    }
    case "assistant": {
      const lines = message.content.flatMap((part) => {
        switch (part.type) {
          case "text": {
            return [part.text];
          }
          case "tool-call": {
            return [
              `<tool_call id="${part.toolCallId}" name="${part.toolName}">${JSON.stringify(part.input)}</tool_call>`,
            ];
          }
          case "tool-result": {
            return [renderToolResult(part.toolCallId, part.output)];
          }
          default: {
            return [];
          }
        }
      });
      return `<assistant>\n${lines.join("\n")}\n</assistant>`;
    }
    case "tool": {
      return message.content
        .flatMap((part) =>
          part.type === "tool-result"
            ? [renderToolResult(part.toolCallId, part.output)]
            : [],
        )
        .join("\n");
    }
  }
}

function renderToolResult(
  toolCallId: string,
  output: LanguageModelV4ToolResultOutput,
) {
  const result = toolResultToMCP(output);
  const text = result.content
    .map((item) => (item.type === "text" ? item.text : `[${item.type}]`))
    .join("\n");
  return `<tool_result id="${toolCallId}"${result.isError ? ' error="true"' : ""}>${text}</tool_result>`;
}

function renderUserPart(part: UserContentPart) {
  if (part.type === "text") {
    return part.text;
  }
  return `[file: ${part.filename ?? part.mediaType}]`;
}

function userPartToBlock(part: UserContentPart): ContentBlockParam[] {
  if (part.type === "text") {
    return [{ text: part.text, type: "text" }];
  }
  const image = imageBlock(part.mediaType, part.data);
  if (image) {
    return [image];
  }
  if (part.data.type === "text") {
    return [{ text: part.data.text, type: "text" }];
  }
  if (part.mediaType === "application/pdf" && part.data.type === "data") {
    return [
      {
        source: {
          data: toBase64(part.data.data),
          media_type: "application/pdf",
          type: "base64",
        },
        type: "document",
      },
    ];
  }
  return [{ text: renderUserPart(part), type: "text" }];
}

const IMAGE_MEDIA_TYPES = [
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

function imageBlock(
  mediaType: string,
  data: LanguageModelV4FilePart["data"],
): ContentBlockParam | undefined {
  const media_type = IMAGE_MEDIA_TYPES.find((type) => type === mediaType);
  if (!media_type) {
    return undefined;
  }
  if (data.type === "data") {
    return {
      source: { data: toBase64(data.data), media_type, type: "base64" },
      type: "image",
    };
  }
  if (data.type === "url") {
    return { source: { type: "url", url: data.url.href }, type: "image" };
  }
  return undefined;
}

function toBase64(data: string | Uint8Array) {
  return typeof data === "string" ? data : Buffer.from(data).toString("base64");
}

/** What our loop produced for a tool call, in the shape the CLI's MCP client takes. */
export function toolResultToMCP(
  output: LanguageModelV4ToolResultOutput,
): CallToolResult {
  switch (output.type) {
    case "text": {
      return { content: [{ text: output.value, type: "text" }] };
    }
    case "json": {
      return {
        content: [{ text: JSON.stringify(output.value), type: "text" }],
      };
    }
    case "error-text": {
      return { content: [{ text: output.value, type: "text" }], isError: true };
    }
    case "error-json": {
      return {
        content: [{ text: JSON.stringify(output.value), type: "text" }],
        isError: true,
      };
    }
    case "execution-denied": {
      return {
        content: [
          { text: output.reason ?? "The tool call was denied.", type: "text" },
        ],
        isError: true,
      };
    }
    case "content": {
      return {
        content: output.value.flatMap((item): CallToolResult["content"] => {
          if (item.type === "text") {
            return [{ text: item.text, type: "text" as const }];
          }
          if (
            item.type === "file" &&
            item.data.type === "data" &&
            item.mediaType.startsWith("image/")
          ) {
            return [
              {
                data: toBase64(item.data.data),
                mimeType: item.mediaType,
                type: "image" as const,
              },
            ];
          }
          if (item.type === "file") {
            return [
              {
                text: `[file: ${item.filename ?? item.mediaType}]`,
                type: "text" as const,
              },
            ];
          }
          return [];
        }),
      };
    }
  }
}
