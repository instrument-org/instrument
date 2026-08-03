import {
  isToolPart,
  type SessionMessage,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";

import { dataPartVisibility, isDataPart } from "./chat-stream-data-parts";
import { isToolCallVisible } from "./message-part/tool-call-utils";
import { isReasoningPartVisible } from "./reasoning-utils";

interface RunBoundaryInfo {
  isRunRow: boolean;
  nextIsRunRow: boolean;
  prevIsRunRow: boolean;
}

// The planning row's key in the map. It is not a part, but it renders a run row
// in the position the next call will take, so it joins the run as a trailing
// entry and reads its spacing off the same adjacency.
export const PLANNING_BOUNDARY_ID = "planning";

// Per-part adjacency for runs of the compact status rows the agent emits as it
// works: tool calls, reasoning, and the planning row. They stack against each
// other, and the run as a whole is what gets set off from surrounding prose.
// Skips non-inline parts so they don't artificially split a run.
export function buildRunBoundaryMap({
  hasTrailingPlanning,
  isDeveloperMode,
  isToolStreaming,
  regularMessages,
}: {
  hasTrailingPlanning: boolean;
  isDeveloperMode: boolean;
  isToolStreaming: (
    part: SessionMessagePart.ToolPart,
    message: SessionMessage.WithParts,
  ) => boolean;
  regularMessages: SessionMessage.WithParts[];
}): Map<string, RunBoundaryInfo> {
  const flat: { id: string; isRunRow: boolean }[] = [];
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
          isDeveloperMode,
          isStreaming,
          part,
        })
      ) {
        continue;
      }

      flat.push({
        id: part.metadata.id,
        isRunRow: isToolPart(part) || part.type === "reasoning",
      });
    }
  }

  if (hasTrailingPlanning) {
    flat.push({ id: PLANNING_BOUNDARY_ID, isRunRow: true });
  }

  const result = new Map<string, RunBoundaryInfo>();
  for (const [i, item] of flat.entries()) {
    result.set(item.id, {
      isRunRow: item.isRunRow,
      nextIsRunRow: flat[i + 1]?.isRunRow ?? false,
      prevIsRunRow: flat[i - 1]?.isRunRow ?? false,
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
    return dataPartVisibility(part) === "always";
  }

  // Remaining parts (step-start, file, source-*) never count as visible content.
  return false;
}

// Whether a part renders inline. Data parts derive from `dataPartVisibility`,
// the same source `renderChatPart` uses, so the two stay consistent.
function isRenderableInlinePart({
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

  if (isDataPart(part)) {
    const visibility = dataPartVisibility(part);
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
