import { featuresAtom } from "@/client/atoms/features";
import {
  getToolNameByType,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";
import {
  CaretRightIcon,
  EyeIcon,
  GlobeIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useAtomValue } from "jotai";
import { type ReactNode, useState } from "react";

import { getToolExplanation } from "../../lib/get-tool-explanation";
import {
  getToolLabelForPart,
  getToolStreamingLabel,
  TOOL_ICONS,
} from "../../lib/tool-display";
import { cn } from "../../lib/utils";
import { PlanningDotIcon } from "../icons/planning-dot";
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
  const { isStreaming } = useToolCallSession();
  const [isOpen, setIsOpen] = useState(false);

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
    <div className="group/tool inline-flex max-w-full min-w-0 items-center gap-3 py-1.5">
      {isDeadDevMode ? (
        <span className="flex shrink-0 items-center gap-1 rounded-full border border-dev-500/30 bg-dev-500/10 px-1.5 py-0.5 text-[10px] font-medium text-dev-500 uppercase">
          <EyeIcon className="size-2.5" />
          Dev
        </span>
      ) : isStreaming ? (
        <PlanningDotIcon className="size-3 shrink-0" />
      ) : (
        Icon && (
          <span className="flex size-5 shrink-0 items-center justify-center rounded-lg bg-black/5 dark:bg-white/5">
            <Icon className="size-3 text-foreground/70" />
          </span>
        )
      )}

      <span
        className={cn(
          "min-w-0 truncate text-sm leading-4",
          isStreaming ? "brand-shiny-text" : "text-muted-foreground",
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

      <CaretRightIcon
        className={cn(
          "size-3 shrink-0 text-muted-foreground/50 transition-transform duration-200 group-hover/tool:text-muted-foreground",
          isOpen && "rotate-90",
        )}
      />
    </div>
  );

  return (
    <Collapsible onOpenChange={setIsOpen} open={isOpen}>
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
