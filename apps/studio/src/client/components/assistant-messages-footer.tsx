import { immediateClickHandlers } from "@/client/lib/immediate-click";
import {
  getUsageSummaryFromMessages,
  type SessionMessage,
  type SessionMessagePart,
  type TaskId,
} from "@instrument-org/workspace/client";
import { FileTextIcon, GitBranchIcon } from "@phosphor-icons/react";
import { sift } from "radashi";
import { useMemo, useState } from "react";

import { useDeveloperMode } from "../hooks/use-developer-mode";
import { formatDuration } from "../lib/format-time";
import { cn } from "../lib/utils";
import { CopyButton } from "./copy-button";
import { Favicon } from "./favicon";
import { ModelChip } from "./model-chip";
import { RelativeTime } from "./relative-time";
import { SourceLink } from "./source-link";
import { BranchTaskModal } from "./task/branch-modal";
import { Button } from "./ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { UsageStatsTooltip, UsageSummaryText } from "./usage-stats-tooltip";

interface AssistantMessagesFooterProps {
  id: TaskId;
  messages: SessionMessage.AssistantWithParts[];
}

interface ModelUsageData {
  aiGatewayModel?: SessionMessage.AssistantWithParts["metadata"]["aiGatewayModel"];
  modelId: string;
}

export function AssistantMessagesFooter({
  id,
  messages,
}: AssistantMessagesFooterProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isBranchOpen, setIsBranchOpen] = useState(false);
  const isDeveloperMode = useDeveloperMode();

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
      let combinedText = "";
      let latestDate: Date | undefined;

      const modelMap = new Map<string, ModelUsageData>();

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
            combinedText += part.text;
          }
        }

        if (!latestDate || message.metadata.createdAt > latestDate) {
          latestDate = message.metadata.createdAt;
        }

        if (message.metadata.modelId && !message.metadata.synthetic) {
          const modelId = message.metadata.modelId;
          const aiGatewayModel = message.metadata.aiGatewayModel;
          const key = aiGatewayModel?.uri ?? modelId;
          modelMap.set(key, { aiGatewayModel, modelId });
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
        messageText: combinedText,
        modelsUsed: [...modelMap.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, data]) => data),
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
        onOpenChange={setIsExpanded}
        open={isExpanded}
      >
        <div
          className={cn(
            "flex min-w-0 items-center gap-2 transition-opacity",
            sources.length > 0
              ? "opacity-100"
              : "opacity-0 group-hover/assistant-message-footer:opacity-100",
          )}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <CopyButton
                className="text-muted-foreground"
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
                  className="text-muted-foreground"
                  {...immediateClickHandlers<HTMLButtonElement>({
        onClick: () => {
                    setIsBranchOpen(true);
                  },
      })}
                  type="button"
                >
                  <GitBranchIcon size={16} />
                </button>
              </TooltipTrigger>
              <TooltipContent>Branch from here</TooltipContent>
            </Tooltip>
          )}
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
              {modelsUsed.map((model, index) => (
                <div
                  className="flex min-w-0 items-center gap-1.5"
                  key={model.aiGatewayModel?.uri ?? model.modelId}
                >
                  {index > 0 && (
                    <span className="mr-1 text-muted-foreground/30">•</span>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="min-w-0">
                        <ModelChip
                          aiGatewayModel={model.aiGatewayModel}
                          modelId={model.modelId}
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent
                      align="start"
                      className="p-3 text-xs"
                      side="top"
                    >
                      <div className="space-y-2">
                        {getModelInfoRows(model).map((row) => (
                          <TooltipRow key={row.label} {...row} />
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
                inputTokenDetails: usageSummary.inputTokenDetails,
                inputTokens: usageSummary.inputTokens,
                outputTokenDetails: usageSummary.outputTokenDetails,
                outputTokens: usageSummary.outputTokens,
                totalDuration: usageSummary.msToFinish,
                totalTokens: usageSummary.totalTokens,
              }}
            >
              <UsageSummaryText
                className="min-w-0 text-[10px] text-dev-700/60 transition-colors hover:text-dev-700 dark:text-dev-300/60 dark:hover:text-dev-300"
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

function getModelInfoRows(model: ModelUsageData): {
  label: string;
  value: string;
}[] {
  return sift([
    model.aiGatewayModel?.name && {
      label: "Model:",
      value: model.aiGatewayModel.name,
    },
    model.aiGatewayModel?.params.provider && {
      label: "Provider:",
      value: model.aiGatewayModel.params.provider,
    },
    model.aiGatewayModel?.providerId && {
      label: "Model ID:",
      value: model.aiGatewayModel.providerId,
    },
  ]);
}

function TooltipRow({
  label,
  tabular,
  value,
}: {
  label: string;
  tabular?: boolean;
  value: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="opacity-80">{label}</span>
      <span className={cn("font-medium", { "tabular-nums": tabular })}>
        {value}
      </span>
    </div>
  );
}
