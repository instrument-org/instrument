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
    <div className="group flex flex-col items-start">
      <SessionMarkdown
        assetBaseUrl={assetBaseUrl}
        className="w-full"
        markdown={messageText}
        taskId={taskId}
      />
    </div>
  );
});
