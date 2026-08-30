import { type AIProviderType } from "@instrument-org/shared";
import {
  getUsageSummaryFromMessages,
  type SessionMessage,
  type SessionMessagePart,
  type TaskId,
} from "@instrument-org/workspace/client";
import { FileTextIcon } from "@phosphor-icons/react/FileText";
import { GitBranchIcon } from "@phosphor-icons/react/GitBranch";
import { sift } from "radashi";
import { useMemo, useState } from "react";

import { useDeveloperMode } from "../hooks/use-developer-mode";
import { formatDuration } from "../lib/format-time";
import {
  modelName,
  modelsAnswering,
  type ModelUsage,
} from "../lib/models-answered";
import { MESSAGE_FOOTER_ICON_SIZE, SHARED } from "../lib/styles";
import { cn } from "../lib/utils";
import { AIProviderIcon } from "./ai-provider-icon";
import { CopyButton } from "./copy-button";
import { Favicon } from "./favicon";
import { ModelChip } from "./model-chip";
import { RelativeTime } from "./relative-time";
import { SourceLink } from "./source-link";
import { BranchTaskModal } from "./task/branch-modal";
import { useReleaseAutoScroll } from "./transcript-scroll-context";
import { Button } from "./ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { UsageStatsTooltip, UsageSummaryText } from "./usage-stats-tooltip";

interface AssistantMessagesFooterProps {
  /**
   * Draw the row rather than waiting for the pointer. For a surface with no
   * reader to hover it: the row takes its space either way, so left to hover it
   * is a band of blank whose height is real and whose contents are not.
   */
  alwaysVisible?: boolean;
  id: TaskId;
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
  messages: SessionMessage.AssistantWithParts[];
}

export function AssistantMessagesFooter({
  alwaysVisible = false,
  id,
  isTurnLive = false,
  messages,
}: AssistantMessagesFooterProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isBranchOpen, setIsBranchOpen] = useState(false);
  const isDeveloperMode = useDeveloperMode();
  const releaseAutoScroll = useReleaseAutoScroll();

  // Branch from the last message of this assistant turn: the new task keeps the
  // conversation through here and drops everything after.
  const branchFrom = messages.at(-1);

  // Compute the summary from the messages this footer already holds -- no need
  // to reload them from the store via RPC.
  const usageSummary = useMemo(
    () => getUsageSummaryFromMessages(messages),
    [messages],
  );

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
      const lastEndedAt =
        lastMessage?.metadata.endedAt ?? lastMessage?.metadata.finishedAt;

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

  const generationDuration = usageSummary.msToFinish;
  const uniqueUrls = extractUniqueUrls(sources);

  return (
    <>
      {branchFrom && (
        <BranchTaskModal
          branchPoint={{
            messageId: branchFrom.id,
            sessionId: branchFrom.metadata.sessionId,
          }}
          isOpen={isBranchOpen}
          onClose={() => {
            setIsBranchOpen(false);
          }}
          sourceTaskId={id}
        />
      )}
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
            "flex min-w-0 items-center gap-2",
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
                  iconSize={MESSAGE_FOOTER_ICON_SIZE}
                  onCopy={handleCopy}
                />
              </TooltipTrigger>
              <TooltipContent>Copy message</TooltipContent>
            </Tooltip>
            {branchFrom && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    aria-label="Branch from here"
                    className={SHARED.messageFooterButton}
                    onClick={() => {
                      setIsBranchOpen(true);
                    }}
                    type="button"
                  >
                    <GitBranchIcon size={MESSAGE_FOOTER_ICON_SIZE} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Branch from here</TooltipContent>
              </Tooltip>
            )}
          </div>
          {generationDuration > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default text-xs text-muted-foreground">
                  {formatDuration(generationDuration)}
                </span>
              </TooltipTrigger>
              <TooltipContent className="p-3 text-xs">
                <div className="space-y-2">
                  <TooltipRow
                    label="Generation time:"
                    tabular
                    value={formatDuration(generationDuration)}
                  />
                  {elapsedDuration != null && (
                    <TooltipRow
                      label="Total time:"
                      tabular
                      value={formatDuration(elapsedDuration)}
                    />
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          )}
          {sources.length > 0 && (
            <CollapsibleTrigger asChild>
              <Button size="sm" variant="ghost">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-xs font-medium">Sources</span>
                  {uniqueUrls.length > 0 && (
                    <div className="flex shrink-0 items-center gap-1">
                      {uniqueUrls.map((url) => (
                        <Favicon className="size-5" key={url} url={url} />
                      ))}
                    </div>
                  )}
                </div>
              </Button>
            </CollapsibleTrigger>
          )}
          {modelsUsed.length > 0 && (
            <div className="flex min-w-0 items-center gap-2">
              {modelsUsed.map((usage, index) => (
                <div
                  className="flex min-w-0 items-center gap-1.5"
                  key={usage.requested?.uri ?? usage.modelId}
                >
                  {index > 0 && (
                    <span className="mr-1 text-muted-foreground/30">•</span>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="min-w-0">
                        <ModelChip
                          aiGatewayModel={usage.requested}
                          modelId={usage.modelId}
                          replacedBy={substitutedBy(usage)}
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent
                      align="start"
                      className="p-3 text-xs"
                      side="top"
                    >
                      <div className="space-y-2">
                        {getModelInfoRows(usage).map((row, rowIndex) => (
                          <TooltipRow key={`${row.label}-${rowIndex}`} {...row} />
                        ))}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </div>
              ))}
            </div>
          )}
          {isDeveloperMode && (
            <UsageStatsTooltip
              messageCount={usageSummary.messageCount}
              stats={{
                activeDuration: usageSummary.activeMs,
                generationDuration: usageSummary.msToFinish,
                inputTokenDetails: usageSummary.inputTokenDetails,
                inputTokens: usageSummary.inputTokens,
                outputTokenDetails: usageSummary.outputTokenDetails,
                outputTokens: usageSummary.outputTokens,
                totalTokens: usageSummary.totalTokens,
              }}
            >
              <UsageSummaryText
                className="min-w-0 text-[10px] text-dev-700/60 hover:text-dev-700 dark:text-dev-300/60 dark:hover:text-dev-300"
                messageCount={usageSummary.messageCount}
                totalTokens={usageSummary.totalTokens}
              />
            </UsageStatsTooltip>
          )}
          {latestCreatedAt && (
            <RelativeTime
              className="ml-auto cursor-default text-xs whitespace-nowrap text-muted-foreground"
              date={latestCreatedAt}
            />
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
  return [...urls].slice(0, 3);
}

/**
 * The card behind a model chip.
 *
 * A routed turn has no `Model` row. The router is already named in the label of
 * the row below it -- and in the chip this card opens from -- so a `Model` row
 * would name it twice while disagreeing with the `Model ID` row underneath,
 * which carries the id of the model that actually answered.
 */
function getModelInfoRows(usage: ModelUsage): {
  glyph?: AIProviderType;
  label: string;
  value: string;
}[] {
  const { requested, served } = usage;
  const [firstAnswered, ...otherAnswered] = served;

  const identity =
    usage.kind === "routed" && requested
      ? // Reads as one sentence across the label and its value: "Auto chose
        // GPT-5.6 Luna". The router's own name rather than the word Auto, so a
        // router we have never heard of needs no case of its own.
        served.map((model, index) => ({
          ...(index === 0 && { glyph: requested.params.provider }),
          label: index === 0 ? `${requested.name.trim()} chose:` : "",
          value: modelName(model),
        }))
      : sift([
          {
            label: "Model:",
            value: firstAnswered
              ? modelName(firstAnswered)
              : (requested?.name ?? usage.modelId),
          },
          ...otherAnswered.map((model) => ({
            label: "",
            value: modelName(model),
          })),
          usage.kind === "substituted" &&
            requested && {
              label: "You asked for:",
              value: requested.name,
            },
        ]);

  return sift([
    ...identity,
    requested?.params.provider && {
      label: "Provider:",
      value: requested.params.provider,
    },
    // Only where the id says something the name above it did not. A model the
    // catalog has no record of is displayed by its id already, so an id row
    // there is the same string twice.
    ...identifyingIds(
      firstAnswered
        ? served.map((model) => ({
            name: modelName(model),
            providerId: model.providerId,
          }))
        : sift([
            requested && {
              name: requested.name,
              providerId: requested.providerId,
            },
          ]),
    ),
  ]);
}

function identifyingIds(
  shown: { name: string; providerId: string }[],
): { label: string; value: string }[] {
  return shown
    .filter((model) => model.name !== model.providerId)
    .map((model, index) => ({
      label: index === 0 ? "Model ID:" : "",
      value: model.providerId,
    }));
}

/**
 * The model that answered instead, on a turn where one did. Absent on a routed
 * turn, where a different answer is the router doing its job rather than
 * something being replaced.
 */
function substitutedBy(usage: ModelUsage): string | undefined {
  if (usage.kind !== "substituted") {
    return;
  }
  const [first] = usage.served;
  return first && modelName(first);
}

function TooltipRow({
  glyph,
  label,
  tabular,
  value,
}: {
  glyph?: AIProviderType;
  label: string;
  tabular?: boolean;
  value: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="flex items-center gap-1.5 opacity-80">
        {glyph && <AIProviderIcon className="size-3.5 shrink-0" type={glyph} />}
        <span>{label}</span>
      </span>
      <span className={cn("font-medium", { "tabular-nums": tabular })}>
        {value}
      </span>
    </div>
  );
}
