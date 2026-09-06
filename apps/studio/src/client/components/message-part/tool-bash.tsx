import { type SessionMessagePart } from "@instrument-org/workspace/client";

import { useNow } from "../../hooks/use-now";
import { useStopBackgroundProcess } from "../../hooks/use-stop-background-process";
import { useTaskSession } from "../../hooks/use-task-session";
import { formatElapsed } from "../../lib/format-elapsed";
import { getToolLabel, getToolStreamingLabel } from "../../lib/tool-display";
import { cn } from "../../lib/utils";
import { Favicon } from "../favicon";
import { createdTaskId } from "../orchestrator/created-task";
import { CreatedTaskCard } from "../orchestrator/created-task-card";
import { StopProcessButton } from "../task/stop-process-button";
import { BashCommandSection } from "./bash-command-section";
import { isFailedBashExitCode } from "./bash-exit-status";
import { useToolCallSession } from "./tool-call-session";
import {
  ToolCard,
  ToolCardEmpty,
  ToolCardHeader,
  ToolCardSection,
  ToolChip,
} from "./tool-card";

export interface BrowserInfo {
  /** Sorted by visit count, descending. */
  domains: string[];
}
type BashPart = Extract<SessionMessagePart.ToolPart, { type: "tool-bash" }>;

const MAX_BASH_COMMAND_CHIPS = 3;

/** Matches the task header's list, the other place this duration appears. */
const ELAPSED_TICK_MS = 1000;

export function BashCommandChip({ commands }: { commands: string[] }) {
  if (commands.length === 0) {
    return null;
  }
  const visible = commands.slice(0, MAX_BASH_COMMAND_CHIPS);
  const extra = commands.length - visible.length;
  return (
    <ToolChip className="max-w-[10rem] gap-1 px-1.5">
      <span className="truncate font-mono text-xs text-foreground/50">
        {visible.join(", ")}
      </span>
      {extra > 0 && (
        <span className="shrink-0 text-xs text-foreground/30">+{extra}</span>
      )}
    </ToolChip>
  );
}

export function BrowserChip({ info }: { info: BrowserInfo }) {
  const topDomain = info.domains[0] ?? "";
  const extra = info.domains.length - 1;

  return (
    <ToolChip className="max-w-[12rem]">
      <Favicon
        className="size-3.5 border border-muted"
        url={`https://${topDomain}`}
      />
      <span className="truncate text-xs font-medium text-foreground/50">
        {topDomain}
        {extra > 0 && (
          <span className="text-foreground/30"> & {extra} more</span>
        )}
      </span>
    </ToolChip>
  );
}

export function ToolBash({ part }: { part: BashPart }) {
  const { backgroundProcess, isStreaming } = useToolCallSession();
  const now = useNow(ELAPSED_TICK_MS);
  const { taskId } = useTaskSession();
  const { busy, stop } = useStopBackgroundProcess(taskId);
  const command = part.input?.command ?? "";
  const hasOutput = part.state === "output-available";
  const isError = part.state === "output-error";

  if (!part.input) {
    return <ToolCardEmpty message="The command has not arrived yet." />;
  }

  const outputTrimmed = hasOutput ? part.output.output.trim() : "";
  const outputText = hasOutput
    ? outputTrimmed
    : isError
      ? `Error: ${part.errorText || "Command failed"}`
      : "";

  const hasExitError = hasOutput && isFailedBashExitCode(part.output.exitCode);
  const isFailed = isError || hasExitError;
  // The call, not what it started. A promoted command's call is over -- it
  // returned a process id and stopped -- so the streaming label here said the
  // agent was still running a command when it had moved on. What is still going
  // is said beside it, in its own words.
  const label = isStreaming
    ? getToolStreamingLabel("bash")
    : getToolLabel("bash");
  // The orchestrator's `task new`: the task it made follows the command as a
  // card, so the work handed off stays in view here rather than only in a
  // note when it ends.
  const createdTask = createdTaskId(part);

  return (
    <ToolCard>
      {/* The running state belongs on the header line the card already has: it
          is a fact about this call, the same kind of thing the label is, and a
          strip added under the output to carry it read as a second card stuck
          to the bottom of the first. The control that ends it sits with it,
          because the place you learn a server is still up is the place you
          want to be able to take it down.
      
          Read live rather than from `processId`, which a part records once and
          never clears: the same card is scrolled back to after the process has
          ended and after a restart took the whole registry with it. */}
      <ToolCardHeader className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
          {label}
        </p>
        {backgroundProcess && (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {formatElapsed(backgroundProcess.startedAt, now)}
          </span>
        )}
        {backgroundProcess && (
          <StopProcessButton
            className="-my-1"
            disabled={busy}
            label="Stop this process"
            onClick={() => {
              stop(backgroundProcess.id);
            }}
          />
        )}
      </ToolCardHeader>

      <BashCommandSection
        borderBottom={hasOutput || isError}
        collapsedHeight={128}
        command={command}
        copyable={!isStreaming}
      />

      {(hasOutput || isError) && (
        <ToolCardSection
          collapsedHeight={176}
          copyText={isStreaming ? undefined : outputText}
          wrappable
        >
          {outputText.length > 0 ? (
            <pre
              className={cn(
                "font-mono text-sm",
                isFailed
                  ? "text-destructive"
                  : "text-success-700 dark:text-success-300",
              )}
            >
              {outputText}
            </pre>
          ) : (
            <p className="font-mono text-sm leading-relaxed text-muted-foreground italic">
              {/* A promoted command has not finished, so "No output" would be
                  reporting a result it has not reached: only real binaries
                  stream, and a watcher loop or a server that has not logged yet
                  yields nothing inside the window. */}
              {backgroundProcess ? "No output yet" : "No output"}
            </p>
          )}
        </ToolCardSection>
      )}
      {createdTask ? (
        <div className="px-3 pb-3">
          <CreatedTaskCard taskId={createdTask} />
        </div>
      ) : null}
    </ToolCard>
  );
}
