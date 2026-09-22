import {
  AGENT_MESSAGE_LANGUAGE,
  FILES_FENCE,
  MESSAGE_FENCE,
  parseMessage,
  type SessionMessagePart,
  type TaskId,
} from "@instrument-org/workspace/client";
import { memo } from "react";

import { AgentFilesBlock } from "./agent-files-block";
import { MarkdownTaskContext } from "./markdown-task-context";
import { MessageCard } from "./message-card";
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
 * The face an assistant's bubble wears, the user's shape mirrored: the same
 * soft corners with the short one at the top left, on the card's ground with
 * no edge and no shadow, where the user's is the brand's tint.
 * `--transcript-room` is zeroed inside it so a wide table scrolls within the
 * bubble rather than bleeding past its edge into the room the transcript
 * has: the bubble is the reply's whole width.
 */
export const ASSISTANT_BUBBLE =
  "max-w-[85%] min-w-0 rounded-2xl rounded-tl-md bg-card px-3.5 py-2 text-foreground [--transcript-room:0px]";

/** A ```message fence that has opened and not yet closed, to the end. */
const OPEN_MESSAGE_FENCE = new RegExp(
  String.raw`^[ \t]*\x60{3,}[ \t]*${AGENT_MESSAGE_LANGUAGE}[ \t]*\n([\s\S]*)$`,
  "mu",
);

/**
 * A reply's text cut at its message fences, in order: runs of words and the
 * messages between them. A fence still arriving at the end is a message
 * already, filling in, so it does not draw in the bubble and then jump out of
 * it when the fence closes.
 */
function messageSegments(
  text: string,
): { kind: "message" | "words"; text: string }[] {
  const segments: { kind: "message" | "words"; text: string }[] = [];
  const pushWords = (words: string) => {
    if (words.trim() !== "") {
      segments.push({ kind: "words", text: words.trim() });
    }
  };
  let rest = 0;
  for (const match of text.matchAll(MESSAGE_FENCE)) {
    pushWords(text.slice(rest, match.index));
    segments.push({ kind: "message", text: match[1] ?? "" });
    rest = match.index + match[0].length;
  }
  const tail = text.slice(rest);
  const opening = OPEN_MESSAGE_FENCE.exec(tail);
  if (opening) {
    pushWords(tail.slice(0, opening.index));
    segments.push({ kind: "message", text: opening[1] ?? "" });
  } else {
    pushWords(tail);
  }
  return segments;
}

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
    // A message stands in the stream as the card it is, between the words
    // before and after it and in that order: words the user sends are not
    // the agent's words, and a card squeezed into a bubble sized for a
    // sentence is too narrow to read an email in.
    const segments = messageSegments(messageText.replace(FILES_FENCE, ""));
    const isStreaming = part.state === "streaming";
    return (
      <div className="flex flex-col items-start gap-2">
        {segments.map((segment, index) =>
          segment.kind === "words" ? (
            <div className={ASSISTANT_BUBBLE} key={index}>
              <SessionMarkdown
                assetVersion={part.metadata.id}
                className="text-sm/[1.5]"
                isStreaming={isStreaming}
                markdown={segment.text}
                taskId={taskId}
              />
            </div>
          ) : (
            <MessageCard
              isStreaming={isStreaming}
              key={index}
              message={parseMessage(segment.text)}
            />
          ),
        )}
        {fences.length > 0 && (
          <MarkdownTaskContext
            value={{
              assetVersion: part.metadata.id,
              isStreaming,
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
