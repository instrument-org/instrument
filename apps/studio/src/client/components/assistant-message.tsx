import {
  type SessionMessagePart,
  type ChatId,
} from "@instrument-org/workspace/client";
import { memo } from "react";

import { SessionMarkdown } from "./session-markdown";
import { useRevealedText } from "./transcript/stage/use-revealed-text";

/** A reply's words, the width of the column, as prose. */
export const AssistantMessage = memo(function AssistantMessage({
  part,
  chatId,
}: {
  part: SessionMessagePart.TextPart;
  chatId: ChatId;
}) {
  const isStreaming = part.state === "streaming";
  // Words arriving while the reply is on screen come out at the stage's pace,
  // and the reply reads as streaming until the last of them is out.
  const revealed = useRevealedText(part.metadata.id, part.text, isStreaming);
  return (
    <div
      className="flex flex-col items-start"
      // Words still to come out, which the rows after it wait for.
      data-revealing={revealed.text.length < part.text.length || undefined}
    >
      <SessionMarkdown
        assetVersion={part.metadata.id}
        className="w-full"
        isStreaming={isStreaming || revealed.isRevealing}
        markdown={revealed.text}
        size="md"
        chatId={chatId}
      />
    </div>
  );
});
