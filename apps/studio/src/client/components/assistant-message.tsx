import {
  type SessionMessagePart,
  type TaskId,
} from "@instrument-org/workspace/client";
import { memo } from "react";

import { SessionMarkdown } from "./session-markdown";

interface AssistantMessageProps {
  /**
   * The words in a bubble at the left, no wider than most of the column,
   * the way a text message reads, facing the user's own bubble at the
   * right; otherwise the words run the width of the column as prose.
   */
  bubble?: boolean;
  part: SessionMessagePart.TextPart;
  taskId: TaskId;
}

/**
 * The face an assistant's bubble wears, mirroring the user's: its tail at
 * the top left. `--transcript-room` is zeroed inside it so a wide table
 * scrolls within the bubble rather than bleeding past its edge into the room
 * the transcript has: the bubble is the reply's whole width.
 */
export const ASSISTANT_BUBBLE =
  "max-w-[85%] min-w-0 rounded-tl rounded-tr-xl rounded-br-xl rounded-bl-xl bg-muted px-3 py-2 text-foreground [--transcript-room:0px]";

export const AssistantMessage = memo(function AssistantMessage({
  bubble = false,
  part,
  taskId,
}: AssistantMessageProps) {
  const messageText = part.text;

  if (bubble) {
    return (
      <div className="flex flex-col items-start">
        <div className={ASSISTANT_BUBBLE}>
          <SessionMarkdown
            assetVersion={part.metadata.id}
            className="text-sm/[1.5]"
            isStreaming={part.state === "streaming"}
            markdown={messageText}
            taskId={taskId}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start">
      <SessionMarkdown
        assetVersion={part.metadata.id}
        className="w-full text-[15px]/[1.5]"
        isStreaming={part.state === "streaming"}
        markdown={messageText}
        taskId={taskId}
      />
    </div>
  );
});
