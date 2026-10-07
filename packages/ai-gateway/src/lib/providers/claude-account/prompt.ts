import {
  type LanguageModelV4FilePart,
  type LanguageModelV4Message,
  type LanguageModelV4Prompt,
  type LanguageModelV4TextPart,
  type LanguageModelV4ToolResultOutput,
} from "@ai-sdk/provider";
import { type ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
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
