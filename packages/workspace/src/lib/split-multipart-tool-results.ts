import type { AIProviderType } from "@instrument-org/shared";
import type { FilePart, ModelMessage } from "ai";

import { getProviderMetadata } from "@instrument-org/ai-gateway";

import { viewToolOutputItem } from "./model-message-parts";

/**
 * Move media out of tool results for providers that only take text there.
 *
 * The text stays with the tool result and the media follows as its own user
 * message, which is the shape every provider accepts. Only `tool` messages are
 * rewritten: a provider-executed result rides on an assistant message, and a
 * provider that ran the tool itself can read back what it produced.
 */
export function splitMultipartToolResults({
  messages,
  provider,
}: {
  messages: ModelMessage[];
  provider: AIProviderType;
}): ModelMessage[] {
  const quirks = getProviderMetadata(provider).quirks;
  if (quirks.supportsMultipartToolResults) {
    return messages;
  }
  const result: ModelMessage[] = [];

  for (const message of messages) {
    if (message.role !== "tool") {
      result.push(message);
      continue;
    }

    const media: FilePart[] = [];

    const content = message.content.map((part) => {
      if (part.type !== "tool-result" || part.output.type !== "content") {
        return part;
      }
      const text: string[] = [];
      for (const item of part.output.value) {
        const view = viewToolOutputItem(item);
        if (view.kind === "text") {
          text.push(view.text);
        } else if (view.kind === "media") {
          media.push({
            data: view.data,
            mediaType: view.mediaType,
            type: "file",
          });
        }
        // Anything else is a reference we cannot carry into a text output, and
        // no tool produces one.
      }
      return {
        ...part,
        output: { type: "text" as const, value: text.join("\n") },
      };
    });

    if (media.length === 0) {
      // Collapsing a text-only content output to a text output would be a
      // rewrite with nothing to show for it.
      result.push(message);
      continue;
    }

    result.push({ ...message, content }, { content: media, role: "user" });
  }

  return result;
}
