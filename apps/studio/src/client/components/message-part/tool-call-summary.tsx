import { featuresAtom } from "@/client/atoms/features";
import {
  getToolNameByType,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";
import { EyeIcon, GlobeIcon, type Icon } from "@phosphor-icons/react";
import { useAtomValue } from "jotai";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { getBrowserDomains } from "../../lib/get-browser-domains";
import { getToolExplanation } from "../../lib/get-tool-explanation";
import {
  getToolLabelForPart,
  getToolStreamingLabel,
  TOOL_ICONS,
} from "../../lib/tool-display";
import { cn } from "../../lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { Spinner } from "../ui/spinner";
import { BashCommandChip, BrowserChip, type BrowserInfo } from "./tool-bash";
import { useToolCallSession } from "./tool-call-session";
import { isPendingInteractiveToolCall } from "./tool-call-utils";
import { FileChip } from "./tool-card";
import { SourceImagesChip } from "./tool-generate-image";
import { WebSearchChip } from "./tool-web-search";

// Auto-expand only long-running tools; short browser/tool calls stay collapsed.
const AUTO_OPEN_DELAY_MS = 1500;
const AUTO_CLOSE_DELAY_MS = 800;
const AUTO_MIN_OPEN_MS = 1200;

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
  const { isAgentRunning, isCurrentTool, isStreaming } = useToolCallSession();
  const [isManuallyOpen, setIsManuallyOpen] = useState(false);
  const [isAutoOpen, setIsAutoOpen] = useState(false);
  const autoOpenedAtRef = useRef<null | number>(null);
  const isAutoOpenRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(
      () => {
        if (isCurrentTool) {
          autoOpenedAtRef.current = Date.now();
          isAutoOpenRef.current = true;
          setIsAutoOpen(true);
          return;
        }

        autoOpenedAtRef.current = null;
        isAutoOpenRef.current = false;
        setIsAutoOpen(false);
      },
      getAutoOpenDelay({
        isAutoOpen: isAutoOpenRef.current,
        isCurrentTool,
        openedAt: autoOpenedAtRef.current,
      }),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [isCurrentTool]);

  // A parked interactive tool call (credential prompt, choose) is an inline
  // question: keep it expanded so its input is visible until the user answers.
  const isAwaitingInput = isPendingInteractiveToolCall(part);
  const isCollapsibleOpen = isManuallyOpen || isAutoOpen || isAwaitingInput;
  const isEmphasized =
    isCollapsibleOpen && !isStreaming && !isAgentRunning && !isAwaitingInput;

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
    <div
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-3 rounded-full border py-2 pr-4 pl-3",
        isEmphasized
          ? "border-foreground/5 bg-accent"
          : "border-border bg-card",
      )}
    >
      {isDeadDevMode ? (
        <span className="flex shrink-0 items-center gap-1 rounded-full border border-dev-500/30 bg-dev-500/10 px-1.5 py-0.5 text-[10px] font-medium text-dev-500 uppercase">
          <EyeIcon className="size-2.5" />
          Dev
        </span>
      ) : isStreaming ? (
        <span className="flex size-5 shrink-0 items-center justify-center">
          <Spinner className="size-3 text-foreground/60" />
        </span>
      ) : (
        Icon && (
          <span className="flex size-5 shrink-0 items-center justify-center rounded-lg bg-black/5 dark:bg-white/5">
            <Icon className="size-3 text-foreground/70" />
          </span>
        )
      )}

      <span
        className={cn(
          "min-w-0 truncate text-sm leading-4 text-foreground",
          isStreaming && "shiny-text",
        )}
      >
        {deadLabel ?? label}
      </span>

      {browserInfo ? (
        <BrowserChip info={browserInfo} isEmphasized={isEmphasized} />
      ) : (
        features.bash_summary_chip &&
        part.type === "tool-bash" &&
        part.state === "output-available" && (
          <BashCommandChip
            commands={part.output.commands}
            isEmphasized={isEmphasized}
          />
        )
      )}
      <WebSearchChip isEmphasized={isEmphasized} part={part} />
      <SourceImagesChip
        assetBaseUrl={assetBaseUrl}
        isEmphasized={isEmphasized}
        part={part}
      />
      <FileChip isEmphasized={isEmphasized} part={part} />
    </div>
  );

  return (
    <Collapsible onOpenChange={setIsManuallyOpen} open={isCollapsibleOpen}>
      <CollapsibleTrigger asChild>{trigger}</CollapsibleTrigger>
      <CollapsibleContent animated>{children}</CollapsibleContent>
    </Collapsible>
  );
}

function getAutoOpenDelay({
  isAutoOpen,
  isCurrentTool,
  openedAt,
}: {
  isAutoOpen: boolean;
  isCurrentTool: boolean;
  openedAt: null | number;
}) {
  if (isCurrentTool) {
    return AUTO_OPEN_DELAY_MS;
  }

  if (!isAutoOpen || !openedAt) {
    return 0;
  }

  return Math.max(
    AUTO_CLOSE_DELAY_MS,
    AUTO_MIN_OPEN_MS - (Date.now() - openedAt),
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

  const domains = getBrowserDomains(command);
  if (domains.length === 0) {
    return null;
  }

  return { domains };
}
