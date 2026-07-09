import {
  isToolPart,
  type SessionMessage,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";

import { dataPartVisibility, isDataPart } from "./chat-stream-data-parts";
import { isToolCallVisible } from "./message-part/tool-call-utils";
import { isReasoningPartVisible } from "./reasoning-utils";

interface ToolBoundaryInfo {
  isToolCall: boolean;
  nextIsToolCall: boolean;
  prevIsToolCall: boolean;
}

// Per-part adjacency for tool-call runs, keyed by part id. Skips non-inline
// parts so they don't artificially split a run.
export function buildToolBoundaryMap({
  hideUserMessages,
  isDeveloperMode,
  isToolStreaming,
  regularMessages,
}: {
  hideUserMessages: boolean;
  isDeveloperMode: boolean;
  isToolStreaming: (
    part: SessionMessagePart.ToolPart,
    message: SessionMessage.WithParts,
  ) => boolean;
  regularMessages: SessionMessage.WithParts[];
}): Map<string, ToolBoundaryInfo> {
  const flat: { id: string; isToolCall: boolean }[] = [];
  const seenSourceIds = new Set<string>();

  for (const message of regularMessages) {
    for (const part of message.parts) {
      if (part.type === "source-document" || part.type === "source-url") {
        if (seenSourceIds.has(part.sourceId)) {
          continue;
        }
        seenSourceIds.add(part.sourceId);
        continue;
      }

      const isStreaming = isToolPart(part)
        ? isToolStreaming(part, message)
        : false;
      if (
        !isRenderableInlinePart({
          hideUserMessages,
          isDeveloperMode,
          isStreaming,
          message,
          part,
        })
      ) {
        continue;
      }

      flat.push({
        id: part.metadata.id,
        isToolCall: isToolPart(part),
      });
    }
  }

  const result = new Map<string, ToolBoundaryInfo>();
  for (const [i, item] of flat.entries()) {
    result.set(item.id, {
      isToolCall: item.isToolCall,
      nextIsToolCall: flat[i + 1]?.isToolCall ?? false,
      prevIsToolCall: flat[i - 1]?.isToolCall ?? false,
    });
  }

  return result;
}

export function isActiveToolPart(part: SessionMessagePart.ToolPart) {
  return (
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    (part.state === "output-available" && part.preliminary === true)
  );
}

export function isVisibleAssistantPart({
  isDeveloperMode,
  isStreaming,
  part,
}: {
  isDeveloperMode: boolean;
  isStreaming: boolean;
  part: SessionMessagePart.Type;
}) {
  if (part.type === "text") {
    return part.state !== "done" || part.text.trim() !== "";
  }

  if (isToolPart(part)) {
    return isToolCallVisible({ isDeveloperMode, isStreaming, part });
  }

  if (part.type === "reasoning") {
    return isReasoningPartVisible(part);
  }

  if (isDataPart(part)) {
    return dataPartVisibility(part.type) === "always";
  }

  // Remaining parts (step-start, file, source-*) never count as visible content.
  return false;
}

// Whether a part renders inline. Data parts derive from `dataPartVisibility`,
// the same source `renderChatPart` uses, so the two stay consistent.
function isRenderableInlinePart({
  hideUserMessages,
  isDeveloperMode,
  isStreaming,
  message,
  part,
}: {
  hideUserMessages: boolean;
  isDeveloperMode: boolean;
  isStreaming: boolean;
  message: SessionMessage.WithParts;
  part: SessionMessagePart.Type;
}) {
  if (part.type === "text") {
    if (part.state === "done" && part.text.trim() === "") {
      return false;
    }
    if (message.role === "user" && hideUserMessages) {
      return false;
    }
    return true;
  }

  if (isDataPart(part)) {
    const visibility = dataPartVisibility(part.type);
    if (visibility === "hidden") {
      return false;
    }
    // Developer-mode-only debug peek; otherwise hidden like attachments.
    if (visibility === "dev") {
      return isDeveloperMode;
    }
    return true;
  }

  if (part.type === "step-start") {
    return false;
  }

  if (part.type === "source-document" || part.type === "source-url") {
    return false;
  }

  if (part.type === "file") {
    return false;
  }

  if (isToolPart(part)) {
    return isToolCallVisible({ isDeveloperMode, isStreaming, part });
  }

  // Only reasoning parts remain; visibility depends on their content.
  return isReasoningPartVisible(part);
}
