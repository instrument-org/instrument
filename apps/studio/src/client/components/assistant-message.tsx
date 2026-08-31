import {
  type SessionMessagePart,
  type TaskId,
} from "@instrument-org/workspace/client";
import { memo } from "react";

import { SessionMarkdown } from "./session-markdown";

interface AssistantMessageProps {
  assetBaseUrl: string;
  part: SessionMessagePart.TextPart;
  taskId: TaskId;
}

export const AssistantMessage = memo(function AssistantMessage({
  assetBaseUrl,
  part,
  taskId,
}: AssistantMessageProps) {
  const messageText = part.text;

  return (
    <div className="flex flex-col items-start">
      <SessionMarkdown
        assetBaseUrl={assetBaseUrl}
        assetVersion={part.metadata.id}
        className="w-full"
        isStreaming={part.state === "streaming"}
        markdown={messageText}
        taskId={taskId}
      />
    </div>
  );
});
