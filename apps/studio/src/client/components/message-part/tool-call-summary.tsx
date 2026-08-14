import { featuresAtom } from "@/client/atoms/features";
import {
  getToolNameByType,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";
import { type Icon } from "@phosphor-icons/react";
import { EyeIcon } from "@phosphor-icons/react/Eye";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { useAtomValue } from "jotai";
import { type ReactNode } from "react";

import { getToolExplanation } from "../../lib/get-tool-explanation";
import {
  getToolLabelForPart,
  getToolStreamingLabel,
  TOOL_ICONS,
} from "../../lib/tool-display";
import { cn } from "../../lib/utils";
import { PlanningDotIcon } from "../icons/planning-dot";
import { RunRowChevron } from "../run-row-chevron";
import { useRowExpansion } from "../transcript-expansion";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { BashCommandChip, BrowserChip, type BrowserInfo } from "./tool-bash";
import { useToolCallSession } from "./tool-call-session";
import { FileChip } from "./tool-card";
import { SourceImagesChip } from "./tool-generate-image";
import { WebSearchChip } from "./tool-web-search";
import { TRANSCRIPT_ROW, useTranscriptGroup } from "./transcript-group";

export function ToolCallSummary({
  assetBaseUrl,
  children,
  isDeadDevMode = false,
  part,
}: {
  assetBaseUrl: string;
  children?: ReactNode;
  isDeadDevMode?: boolean;
  part: SessionMessagePart.ToolPart;
}) {
  const features = useAtomValue(featuresAtom);
  const { isRunning, isStreaming } = useToolCallSession();
  const group = useTranscriptGroup();
  const { isExpanded, setIsExpanded } = useRowExpansion(part.metadata.id);

  // Non-null when this row is the head line of a group that has somewhere else
  // to draw what it holds -- steps behind the line, or the line already opened
  // -- which is what makes it answer a click on the group's behalf. Its own
  // output then belongs to its row in the run rather than to the head line, so
  // opening the group does not draw the same call twice.
  const groupHead =
    group?.isHead === true && (group.canExpand || group.isExpanded)
      ? group
      : null;

  // A call is asked for well before it is worked on, so a row has three states
  // and not two: the one the agent is on, the ones queued behind it, and the
  // ones already done. `isStreaming` covers the first two -- asked for, not
  // finished -- and `isRunning` narrows to the first.
  //
  // One row draws the live indicator and every other row is at rest, queued
  // calls included. A second row moving under the head line would read as two
  // things happening at once, and a call waiting its turn is not work in
  // progress worth announcing: what it is waiting on is already saying so.
  const showsLiveIndicator = isRunning && (group === null || group.isHead);

  const toolName = getToolNameByType(part.type);
  const browserInfo = getBrowserInfo(part);
  const Icon: Icon | undefined = browserInfo
    ? GlobeIcon
    : (TOOL_ICONS[toolName] ?? undefined);

  const isFileNotFound =
    part.state === "output-available" &&
    part.type === "tool-read_file" &&
    part.output.state === "does-not-exist";
  const isSkillNotFound =
    part.state === "output-available" &&
    part.type === "tool-load_skill" &&
    part.output.state === "not-found";
  const isError = part.state === "output-error" || isFileNotFound;
  const hasCapabilityFailure =
    (part.state === "output-available" &&
      (part.type === "tool-web_search" ||
        part.type === "tool-generate_image") &&
      part.output.state === "failure") ||
    isSkillNotFound;
  const isFailed = isError || hasCapabilityFailure;

  const explanation = getToolExplanation(part);

  const label =
    !isFailed && explanation
      ? explanation
      : isStreaming
        ? getToolStreamingLabel(toolName)
        : getToolLabelForPart({
            hasCapabilityFailure,
            state: isFailed ? "tried" : "completed",
            toolName,
          });

  const deadLabel = isDeadDevMode
    ? `${getToolLabelForPart({ state: "streaming", toolName })} stopped while ${part.state}`
    : null;

  const trigger = (
    // Inline, unlike the rows that are a whole line: a call's chips follow its
    // label and the hover target ends with them rather than running to the
    // margin.
    <div className={cn(TRANSCRIPT_ROW, "inline-flex max-w-full")}>
      {isDeadDevMode ? (
        <span className="flex shrink-0 items-center gap-1 rounded-full border border-dev-500/30 bg-dev-500/10 px-1.5 py-0.5 text-[10px] font-medium text-dev-500 uppercase">
          <EyeIcon className="size-2.5" />
          Dev
        </span>
      ) : showsLiveIndicator ? (
        <PlanningDotIcon />
      ) : (
        Icon && (
          <span className="flex size-5 shrink-0 items-center justify-center rounded-lg bg-black/5 dark:bg-white/5">
            <Icon className="size-3 text-foreground/70" />
          </span>
        )
      )}

      <span
        className={cn(
          // No leading override: the label's own 20px line box is what holds
          // the row at one height, and it is the same 20px the indicator beside
          // it takes in every state.
          "min-w-0 truncate text-sm",
          showsLiveIndicator
            ? "brand-shiny-text"
            : "text-muted-foreground group-hover/run-row:text-foreground",
        )}
      >
        {deadLabel ?? label}
      </span>

      {browserInfo ? (
        <BrowserChip info={browserInfo} />
      ) : (
        features.bash_summary_chip &&
        part.type === "tool-bash" &&
        part.state === "output-available" && (
          <BashCommandChip commands={part.output.commands} />
        )
      )}
      <WebSearchChip part={part} />
      <SourceImagesChip assetBaseUrl={assetBaseUrl} part={part} />
      <FileChip part={part} />

      <RunRowChevron
        isOpen={groupHead === null ? isExpanded : groupHead.isExpanded}
      />
    </div>
  );

  // As a group's head line the row's click belongs to the group: the reader is
  // asking to see the steps behind it, not this one call's output. It keeps the
  // click while the group is open, since it is then the only way to shut it.
  if (groupHead !== null) {
    return (
      <Collapsible onOpenChange={groupHead.toggle} open={groupHead.isExpanded}>
        <CollapsibleTrigger asChild>{trigger}</CollapsibleTrigger>
      </Collapsible>
    );
  }

  return (
    <Collapsible onOpenChange={setIsExpanded} open={isExpanded}>
      <CollapsibleTrigger asChild>{trigger}</CollapsibleTrigger>
      <CollapsibleContent animated>{children}</CollapsibleContent>
    </Collapsible>
  );
}

function getBrowserInfo(part: SessionMessagePart.ToolPart): BrowserInfo | null {
  if (part.type !== "tool-bash") {
    return null;
  }

  const command = part.input?.command ?? "";
  if (!command.includes("agent-browser")) {
    return null;
  }

  const domainCounts = new Map<string, number>();
  for (const token of command.split(/\s+/)) {
    if (!token.startsWith("http")) {
      continue;
    }
    try {
      const hostname = new URL(token).hostname.replace(/^www\./, "");
      domainCounts.set(hostname, (domainCounts.get(hostname) ?? 0) + 1);
    } catch {
      // not a valid URL
    }
  }

  if (domainCounts.size === 0) {
    return null;
  }

  const domains = [...domainCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([domain]) => domain);

  return { domains };
}
