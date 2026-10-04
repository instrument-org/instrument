import { cn } from "@/client/lib/utils";
import {
  AGENT_MESSAGE_LANGUAGE,
  FILES_FENCE,
  MESSAGE_FENCE,
  parseMessage,
  replyExcerpt,
  type SessionMessagePart,
  type TaskId,
} from "@instrument-org/workspace/client";
import { memo, useContext } from "react";

import { AgentFilesBlock } from "./agent-files-block";
import { BubbleActions } from "./bubble-actions";
import { FollowedBubblesContext } from "./bubble-run-context";
import { MarkdownTaskContext } from "./markdown-task-context";
import { MessageCard } from "./message-card";
import { ReplyContext } from "./reply-context";
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
 * soft corners, on the card's ground with no edge and no shadow, where the
 * user's is the brand's tint. `--transcript-room` is zeroed inside it so a
 * wide table scrolls within the bubble rather than bleeding past its edge into
 * the room the transcript has: the bubble is the reply's whole width.
 */
export const ASSISTANT_BUBBLE =
  "max-w-[85%] min-w-0 rounded-2xl bg-card px-3.5 py-2 text-foreground [--transcript-room:0px]";

/**
 * The short corner at the bottom left that the last bubble of a run of the
 * assistant's wears, the tail a text chat draws there; see
 * `FollowedBubblesContext`.
 */
export const ASSISTANT_BUBBLE_TAIL = "rounded-bl-md";

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
    segments.push({ kind: "message", text: match.groups?.body ?? "" });
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

/** Whether a reply's text draws any words in a bubble, not only cards. */
export function hasBubbleWords(text: string): boolean {
  return messageSegments(text.replace(FILES_FENCE, "")).some(
    (segment) => segment.kind === "words",
  );
}

export const AssistantMessage = memo(function AssistantMessage({
  bubble = false,
  part,
  taskId,
}: AssistantMessageProps) {
  const messageText = part.text;
  const startReply = useContext(ReplyContext);
  const isFollowed = useContext(FollowedBubblesContext).has(part.metadata.id);

  if (bubble) {
    // The bubble is for the words. The files a reply hands over stand under
    // it at the width a bubble reaches, as the cards a task page draws them,
    // where a card is not squeezed by a bubble sized to a sentence.
    const fences = [...messageText.matchAll(FILES_FENCE)].map(
      (match) => match[1] ?? "",
    );
    // A message stands in the stream as the card it is, between the words
    // before and after it and in that order: words the user sends are not
    // the agent's words, and a card squeezed into a bubble sized for a
    // sentence is too narrow to read an email in.
    const segments = messageSegments(messageText.replace(FILES_FENCE, ""));
    const isStreaming = part.state === "streaming";
    // The part's last bubble ends the run unless a later one carries it on;
    // a card under it is not a bubble and leaves the tail where it is.
    const tailIndex = isFollowed
      ? -1
      : segments.findLastIndex((segment) => segment.kind === "words");
    return (
      <div className="flex flex-col items-start gap-2">
        {segments.map((segment, index) =>
          segment.kind === "words" ? (
            <div
              className="group/bubble-row flex w-full items-end gap-1"
              // What a reply to this bubble scrolls back to.
              data-reply-target={part.metadata.id}
              key={index}
            >
              <div
                className={cn(
                  ASSISTANT_BUBBLE,
                  index === tailIndex && ASSISTANT_BUBBLE_TAIL,
                )}
              >
                <SessionMarkdown
                  assetVersion={part.metadata.id}
                  className="text-sm/[1.5]"
                  isStreaming={isStreaming}
                  markdown={segment.text}
                  taskId={taskId}
                />
              </div>
              <BubbleActions
                onCopy={() => navigator.clipboard.writeText(segment.text)}
                onReply={
                  startReply &&
                  (() => {
                    startReply({
                      messageId: part.metadata.messageId,
                      partId: part.metadata.id,
                      text: replyExcerpt(segment.text),
                    });
                  })
                }
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
            {/* Within what a bubble reaches at its widest, spaced from the
                bubbles as they are from each other. A lone card, a folder's
                included, is as wide as its name needs, keeping the room for
                its menu so it does not grow under the pointer; several fill
                columns of at least 11rem, two across a chat of the usual
                width, so their edges line up. */}
            <div className="flex w-full max-w-[85%] flex-col gap-2 [&_[data-slot=files-grid-card]:only-child]:col-span-full [&_[data-slot=files-grid-card]:only-child]:justify-self-start [&_[data-slot=files-grid-card]:only-child_[data-slot=file-row-actions]]:ml-0 [&_[data-slot=files-grid-card]:only-child_[data-slot=file-row-actions]]:w-auto [&_[data-slot=files-grid-cards]]:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] [&_[data-slot=files-grid-media]:only-child]:w-full">
              {fences.map((content, index) => (
                <AgentFilesBlock
                  className="my-0"
                  content={content}
                  key={index}
                />
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
