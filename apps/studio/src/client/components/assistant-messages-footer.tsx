import {
  type ChatId,
  type SessionMessage,
  type SessionMessagePart,
  type TranscriptPart,
} from "@instrument-org/workspace/client";
import { FileTextIcon } from "@phosphor-icons/react/FileText";
import { useMemo, useState } from "react";

import { formatDuration } from "../lib/format-time";
import { useSameIconSites } from "../lib/same-icon-sites";
import { modelsAnswering } from "../lib/models-answered";
import { MESSAGE_FOOTER_ICON_SIZE, SHARED } from "../lib/styles";
import { cn } from "../lib/utils";
import { BranchFromReply } from "./branch-from-reply";
import { UndoReplyFiles } from "./undo-reply-files";
import { CopyButton } from "./copy-button";
import { Favicon } from "./favicon";
import { ModelUsageChip, TooltipRow } from "./model-usage-chip";
import { RelativeTime } from "./relative-time";
import { SourceLink } from "./source-link";
import { useReleaseAutoScroll } from "./transcript-scroll-context";
import { Button } from "./ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface AssistantMessagesFooterProps {
  /**
   * Draw the row rather than waiting for the pointer. For a surface with no
   * reader to hover it: the row takes its space either way, so left to hover it
   * is a band of blank whose height is real and whose contents are not.
   */
  alwaysVisible?: boolean;
  /** The chat the reply is in, for undoing the files it changed; absent where it can't be undone. */
  chatId?: ChatId;
  /**
   * The turn this footer belongs to is still being produced, so the row holds
   * its space and shows nothing.
   *
   * The space is reserved from the moment the turn has anything in it, rather
   * than the row being mounted once the turn ends. Mounting it late puts a row's
   * worth of growth into the frame where the session has just stopped and
   * nothing is following the transcript, and unmounting it when the next turn
   * starts takes that height back out from under whatever the reader is on.
   */
  isTurnLive?: boolean;
  messages: readonly (SessionMessage.Assistant & {
    parts: readonly (SessionMessagePart.Type | TranscriptPart)[];
  })[];
  /** Starts a new chat from this reply; absent where the transcript can't branch, such as a task's. */
  onBranch?: () => Promise<void>;
}

export function AssistantMessagesFooter({
  alwaysVisible = false,
  chatId,
  isTurnLive = false,
  messages,
  onBranch,
}: AssistantMessagesFooterProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const releaseAutoScroll = useReleaseAutoScroll();

  const { elapsedDuration, latestCreatedAt, messageText, modelsUsed, sources } =
    useMemo(() => {
      const seenSourceIds = new Set<string>();
      const allSources: (
        | SessionMessagePart.SourceDocumentPart
        | SessionMessagePart.SourceUrlPart
      )[] = [];
      const textParts: string[] = [];
      let latestDate: Date | undefined;

      for (const message of messages) {
        for (const part of message.parts) {
          if (
            (part.type === "source-document" || part.type === "source-url") &&
            !seenSourceIds.has(part.sourceId)
          ) {
            seenSourceIds.add(part.sourceId);
            allSources.push(part);
          }
          // Each text part is a separately rendered block. Retain that
          // separation when copying, and skip blocks the transcript omits.
          if (part.type === "text") {
            const text = part.text.trim();
            if (text) {
              textParts.push(text);
            }
          }
        }

        if (!latestDate || message.metadata.createdAt > latestDate) {
          latestDate = message.metadata.createdAt;
        }
      }

      const firstCreatedAt = messages[0]?.metadata.createdAt;
      const lastMessage = messages.at(-1);
      // A call the app's quit cut off ends after its step did: the quit
      // records when the app closed on the call, not on the message.
      const lastEndedAt = [
        lastMessage?.metadata.endedAt ?? lastMessage?.metadata.finishedAt,
        ...messages.flatMap((message) =>
          message.parts.flatMap((part) =>
            part.metadata.endedAt instanceof Date
              ? [part.metadata.endedAt]
              : [],
          ),
        ),
      ].reduce<Date | undefined>(
        (latest, at) => (at && (!latest || at > latest) ? at : latest),
        undefined,
      );

      const elapsed =
        firstCreatedAt && lastEndedAt
          ? lastEndedAt.getTime() - firstCreatedAt.getTime()
          : undefined;

      return {
        elapsedDuration: elapsed,
        latestCreatedAt: latestDate,
        messageText: textParts.join("\n\n"),
        modelsUsed: modelsAnswering(messages),
        sources: allSources,
      };
    }, [messages]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(messageText);
  };

  // The message that recorded the files the reply handed over, which Undo
  // is asked about.
  const handedOver = messages.find((message) =>
    message.parts.some(
      (part) =>
        part.type === "data-fileVersions" && part.data.kind === undefined,
    ),
  );

  const generationDuration = messages.reduce(
    (sum, message) => sum + (message.metadata.msToFinish ?? 0),
    0,
  );
  const sourceIcons = useSameIconSites(extractUniqueUrls(sources)).slice(
    0,
    SOURCE_ICONS_SHOWN,
  );

  return (
    <>
      <Collapsible
        className="mt-2 flex flex-col gap-2"
        onOpenChange={(open) => {
          releaseAutoScroll();
          setIsExpanded(open);
        }}
        open={isExpanded}
      >
        <div
          className={cn(
            // A container, so the row drops its details in order as it narrows
            // instead of wrapping: the time taken, then the model's name (its
            // icon stays), then when it was sent. The buttons always stay.
            "@container/footer flex min-w-0 items-center gap-2",
            // `invisible` rather than an opacity of nought: a turn still being
            // written should not answer a click or a tab stop, and the row is
            // only here to hold the height.
            isTurnLive
              ? "invisible"
              : alwaysVisible || sources.length > 0
                ? "opacity-100"
                : "opacity-0 group-hover/assistant-turn:opacity-100",
          )}
        >
          {/* The negative margins cancel the buttons' own padding so their icons
              still sit on the row's outer edges, not inset from them. */}
          <div className="-mx-1 flex items-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <CopyButton
                  className={SHARED.messageFooterButton}
                  data-copy-message=""
                  iconSize={MESSAGE_FOOTER_ICON_SIZE}
                  onCopy={handleCopy}
                />
              </TooltipTrigger>
              <TooltipContent>Copy message</TooltipContent>
            </Tooltip>
            {onBranch && (
              <BranchFromReply
                at={latestCreatedAt}
                onBranch={onBranch}
                text={messageText}
              />
            )}
          </div>
          <div className="flex min-w-0 items-center gap-2.5 text-xs whitespace-nowrap text-muted-foreground">
            {[
              generationDuration > 0 && {
                // First to go as the row narrows.
                drop: "hidden @[30rem]/footer:flex",
                key: "duration",
                node: (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      {/* The time the reply took on the clock. Generation time adds
                        up every model call, and calls that ran side by side make
                        it longer than the wait it stands for. */}
                      <span className="cursor-default">
                        {formatDuration(elapsedDuration ?? generationDuration)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="p-3 text-xs">
                      <div className="space-y-2">
                        {elapsedDuration != null && (
                          <TooltipRow
                            label="Total time:"
                            tabular
                            value={formatDuration(elapsedDuration)}
                          />
                        )}
                        <TooltipRow
                          label="Generation time:"
                          tabular
                          value={formatDuration(generationDuration)}
                        />
                      </div>
                    </TooltipContent>
                  </Tooltip>
                ),
              },
              sources.length > 0 && {
                key: "sources",
                node: (
                  <CollapsibleTrigger asChild>
                    {/* The negative margin cancels the button's own padding, so
                      the mid-dots on either side sit as far from its text as
                      they do from the plain text beside them. */}
                    <Button
                      className="-mx-2.5 font-normal text-muted-foreground hover:text-foreground"
                      size="xs"
                      variant="ghost"
                    >
                      Sources
                      {sourceIcons.length > 0 && (
                        <span className="flex shrink-0 items-center gap-1">
                          {sourceIcons.map(({ hosts, url }) => (
                            <Favicon
                              className="size-3.5"
                              key={url}
                              tooltip={hosts.join(", ")}
                              url={url}
                            />
                          ))}
                        </span>
                      )}
                    </Button>
                  </CollapsibleTrigger>
                ),
              },
              ...modelsUsed.map((usage) => ({
                key: usage.requested?.uri ?? usage.modelId,
                node: (
                  <ModelUsageChip
                    // Down to the provider's icon on a narrow row; the card
                    // on hover still names it.
                    className="@max-[26rem]/footer:[&>span:not(:only-child):last-child]:hidden"
                    usage={usage}
                  />
                ),
              })),
              latestCreatedAt && {
                drop: "hidden @[22rem]/footer:flex",
                key: "time",
                node: (
                  <RelativeTime
                    className="cursor-default whitespace-nowrap"
                    date={latestCreatedAt}
                  />
                ),
              },
            ]
              .filter((item) => item !== false && item !== undefined)
              .map(({ drop, key, node }, index, items) => (
                // The dots sit on the side of each item that faces the
                // middle, the first's after it and the rest's before them, so
                // the first or the last drops with its dot.
                <span
                  className={cn("flex min-w-0 items-center gap-2.5", drop)}
                  key={key}
                >
                  {index > 1 && <span aria-hidden>·</span>}
                  {node}
                  {index === 0 && items.length > 1 && (
                    <span aria-hidden>·</span>
                  )}
                </span>
              ))}
          </div>
          {chatId !== undefined &&
            handedOver && (
              // At the far end, apart from Copy and Branch: the one button
              // here that changes files.
              <div className="-mr-1 ml-auto shrink-0">
                <UndoReplyFiles chatId={chatId} messageId={handedOver.id} />
              </div>
            )}
        </div>

        {sources.length > 0 && (
          <CollapsibleContent>
            <div className="mt-2 space-y-2 pl-1">
              {sources.map((source) => {
                if (source.type === "source-url") {
                  return (
                    <SourceLink
                      key={source.metadata.id}
                      title={source.title}
                      url={source.url}
                    />
                  );
                }

                return (
                  <div
                    className="flex items-center gap-2 text-sm"
                    key={source.metadata.id}
                  >
                    <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-medium text-foreground">
                        {source.title}
                      </span>
                      {(source.filename || source.mediaType) && (
                        <span className="truncate text-xs text-muted-foreground">
                          {source.filename && source.mediaType
                            ? `${source.filename} • ${source.mediaType}`
                            : source.filename || source.mediaType}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CollapsibleContent>
        )}
      </Collapsible>
    </>
  );
}

/** The most source icons the Sources button shows; the list it opens has every one. */
const SOURCE_ICONS_SHOWN = 3;

function extractUniqueUrls(
  sources: (
    | SessionMessagePart.SourceDocumentPart
    | SessionMessagePart.SourceUrlPart
  )[],
): string[] {
  const urls = new Set<string>();
  for (const source of sources) {
    if (source.type === "source-url") {
      try {
        const urlObj = new URL(source.url);
        urls.add(urlObj.origin);
      } catch {
        urls.add(source.url);
      }
    }
  }
  return [...urls];
}
