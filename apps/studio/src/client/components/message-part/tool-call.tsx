import { useRunningBackgroundProcess } from "@/client/hooks/use-task-background-processes";
import {
  type SessionMessagePart,
  type ChatId,
} from "@instrument-org/workspace/client";

import { ToolBash } from "./tool-bash";
import { ToolCallError } from "./tool-call-error";
import { ToolCallSessionProvider } from "./tool-call-session";
import { isActiveToolPart } from "./tool-call-utils";
import { ToolChoose } from "./tool-choose";
import { ToolConnectApp } from "./tool-connect-app";
import { ToolOfferFeedback } from "./tool-offer-feedback";
import { ToolEditFile } from "./tool-edit-file";
import { ToolGenerateImage } from "./tool-generate-image";
import { ToolLoadSkill } from "./tool-load-skill";
import { ToolReadFile } from "./tool-read-file";
import { ToolUnavailable } from "./tool-unavailable";
import { ToolWebFetch } from "./tool-web-fetch";
import { ToolWebSearch } from "./tool-web-search";
import { ToolWriteFile } from "./tool-write-file";

/**
 * What a call says: the card an opened step shows, and the whole of a call that
 * asks the person something.
 */
export function ToolCallBody({
  onRetry,
  part,
  chatId,
}: {
  onRetry: (prompt: string) => void;
  part: SessionMessagePart.ToolPart;
  chatId: ChatId;
}) {
  const backgroundProcess = useRunningBackgroundProcess({
    processId:
      part.type === "tool-bash" && part.state === "output-available"
        ? part.output.processId
        : undefined,
    sessionId: part.metadata.sessionId,
    chatId,
  });
  const isActive = isActiveToolPart(part);
  return (
    <ToolCallSessionProvider
      backgroundProcess={backgroundProcess}
      isRunning={isActive}
      isStreaming={isActive}
    >
      <ToolCard chatId={chatId} onRetry={onRetry} part={part} />
    </ToolCallSessionProvider>
  );
}

function ToolCard({
  onRetry,
  part,
  chatId,
}: {
  onRetry: (prompt: string) => void;
  part: SessionMessagePart.ToolPart;
  chatId: ChatId;
}) {
  if (part.state === "output-error") {
    return <ToolCallError part={part} />;
  }

  switch (part.type) {
    // The card above the reply box is the whole of an ask.
    case "tool-ask_permission": {
      return null;
    }
    case "tool-bash": {
      return <ToolBash part={part} />;
    }
    case "tool-choose": {
      return <ToolChoose part={part} chatId={chatId} />;
    }
    case "tool-connect_app": {
      return <ToolConnectApp part={part} />;
    }
    case "tool-edit_file": {
      return <ToolEditFile part={part} />;
    }
    case "tool-generate_image": {
      return <ToolGenerateImage id={chatId} onRetry={onRetry} part={part} />;
    }
    case "tool-load_skill": {
      return <ToolLoadSkill part={part} />;
    }
    case "tool-offer_feedback": {
      return <ToolOfferFeedback chatId={chatId} part={part} />;
    }
    case "tool-read_file": {
      return <ToolReadFile part={part} />;
    }
    case "tool-unavailable": {
      return <ToolUnavailable part={part} />;
    }
    case "tool-web_fetch": {
      return <ToolWebFetch part={part} />;
    }
    case "tool-web_search": {
      return <ToolWebSearch onRetry={onRetry} part={part} />;
    }
    case "tool-write_file": {
      return <ToolWriteFile part={part} />;
    }
  }
}
