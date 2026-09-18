import {
  FILES_FENCE,
  type SessionMessagePart,
  type TaskId,
} from "@instrument-org/workspace/client";
import { memo } from "react";

import { AgentFilesBlock } from "./agent-files-block";
import { MarkdownTaskContext } from "./markdown-task-context";
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
 * the top left, on the card's ground with a faint edge, where the user's is
 * the brand's tint. `--transcript-room` is zeroed inside it so a wide table
 * scrolls within the bubble rather than bleeding past its edge into the room
 * the transcript has: the bubble is the reply's whole width.
 */
export const ASSISTANT_BUBBLE =
  "max-w-[85%] min-w-0 rounded-tl rounded-tr-xl rounded-br-xl rounded-bl-xl bg-card px-3 py-2 text-foreground shadow-xs ring-1 ring-foreground/6 [--transcript-room:0px]";

export const AssistantMessage = memo(function AssistantMessage({
  bubble = false,
  part,
  taskId,
}: AssistantMessageProps) {
  const messageText = part.text;

  if (bubble) {
    // The bubble is for the words. The files a reply hands over stand under
    // it at the column's width, as the cards a task page draws them, where
    // a card is not squeezed by a bubble sized to a sentence.
    const fences = [...messageText.matchAll(FILES_FENCE)].map(
      (match) => match[1] ?? "",
    );
    const words = messageText.replace(FILES_FENCE, "").trim();
    return (
      <div className="flex flex-col items-start gap-2">
        {words !== "" && (
          <div className={ASSISTANT_BUBBLE}>
            <SessionMarkdown
              assetVersion={part.metadata.id}
              className="text-sm/[1.5]"
              isStreaming={part.state === "streaming"}
              markdown={words}
              taskId={taskId}
            />
          </div>
        )}
        {fences.length > 0 && (
          <MarkdownTaskContext
            value={{
              assetVersion: part.metadata.id,
              isStreaming: part.state === "streaming",
              taskId,
            }}
          >
            <div className="w-full">
              {fences.map((content, index) => (
                <AgentFilesBlock content={content} key={index} />
              ))}
            </div>
          </MarkdownTaskContext>
        )}
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
