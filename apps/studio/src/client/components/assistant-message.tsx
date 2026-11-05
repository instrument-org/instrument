import {
  type SessionMessagePart,
  type ChatId,
} from "@instrument-org/workspace/client";
import { memo } from "react";

import { SessionMarkdown } from "./session-markdown";

/** A reply's words, the width of the column, as prose. */
export const AssistantMessage = memo(function AssistantMessage({
  part,
  chatId,
}: {
  part: SessionMessagePart.TextPart;
  chatId: ChatId;
}) {
  return (
    <div className="flex flex-col items-start">
      <SessionMarkdown
        assetVersion={part.metadata.id}
        className="w-full text-[15px]/[1.5]"
        isStreaming={part.state === "streaming"}
        markdown={part.text}
        chatId={chatId}
      />
    </div>
  );
});
