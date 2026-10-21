import { Badge } from "@/client/components/ui/badge";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/client/components/ui/hover-card";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { useTimedFlag } from "@/client/hooks/use-timed-flag";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type NetworkStatus } from "@/shared/network-status";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { CloudSlashIcon } from "@phosphor-icons/react/CloudSlash";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { WifiSlashIcon } from "@phosphor-icons/react/WifiSlash";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

const START_COMMAND = "pnpm --filter @instrument/api dev";

const PILL_CLASS =
  "h-6 cursor-default gap-1.5 border-transparent bg-warning-500/10 px-2.5 text-xs text-warning-700 ring-1 ring-warning-500/25 ring-inset dark:text-warning-300 [&>svg]:size-3.5";

type Shown = Exclude<NetworkStatus, "online">;

function useNetworkStatus() {
  const { data } = useQuery(
    rpcClient.network.live.status.experimental_liveOptions({}),
  );
  return data;
}

function StatusIcon({ status }: { status: Shown }) {
  return status === "offline" ? (
    <WifiSlashIcon weight="bold" />
  ) : (
    <CloudSlashIcon weight="bold" />
  );
}

/**
 * Setup's word that the computer is offline or Instrument's servers don't
 * answer, for its top-right corner. Absent while online; it says nothing
 * about where it sits, so the screen that mounts it places it.
 */
export function SetupNetworkStatusPill({ className }: { className?: string }) {
  const status = useNetworkStatus()?.status;
  if (!status || status === "online") {
    return null;
  }
  return (
    <Badge className={cn(PILL_CLASS, className)} role="status">
      <StatusIcon status={status} />
      {status === "offline"
        ? "You're offline. Connect to continue."
        : "Can't reach Instrument"}
    </Badge>
  );
}

/**
 * The app's pill beside the bell when the computer is offline or Instrument's
 * servers don't answer, opening a card that says what stops working. Goes
 * away by itself. In developer mode the unreachable card also names the API
 * server it expected, and in a development build the command that starts it.
 */
export function NetworkStatusIndicator() {
  const data = useNetworkStatus();
  const isDeveloperMode = useDeveloperMode();
  const [open, setOpen] = useState(false);

  if (!data || data.status === "online") {
    return null;
  }
  const { platformApiBaseUrl, status } = data;
  const label = status === "offline" ? "Offline" : "Can't reach Instrument";

  return (
    <HoverCard
      closeDelay={150}
      onOpenChange={setOpen}
      open={open}
      openDelay={150}
    >
      <HoverCardTrigger asChild>
        <Badge asChild className={PILL_CLASS}>
          {/* A button rather than a span: the bar is a drag region, and only
            buttons are carved out of it to take the pointer. */}
          <button onClick={() => setOpen(true)} type="button">
            <StatusIcon status={status} />
            {label}
          </button>
        </Badge>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-80 p-4 select-text">
        {status === "offline" ? (
          <>
            <p className="text-sm font-semibold text-foreground">
              You're offline
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Instrument can't reach AI providers until your computer is back
              online. Your local files and folders still work.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-foreground">
              Can't reach Instrument models
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Chats on Instrument models, web search, and dictation aren't
              available right now.
            </p>
            {isDeveloperMode && (
              <div className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                <p>
                  Expected the API server at{" "}
                  <span className="font-mono">{platformApiBaseUrl}</span>.
                </p>
                {import.meta.env.DEV && (
                  <>
                    <p className="mt-1">Start it from the internal repo:</p>
                    <CopyCommand command={START_COMMAND} />
                  </>
                )}
              </div>
            )}
          </>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

function CopyCommand({ command }: { command: string }) {
  const { active: copied, trigger } = useTimedFlag();

  return (
    <button
      aria-label={`Copy ${command}`}
      className="group mt-2 flex w-full cursor-default items-center gap-2 rounded-md border bg-muted/50 py-1.5 pr-1.5 pl-2.5 text-left hover:bg-muted"
      onClick={() => {
        void navigator.clipboard.writeText(command).then(trigger);
      }}
      type="button"
    >
      <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
        {command}
      </code>
      <span className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground group-hover:text-foreground">
        {copied ? (
          <>
            <CheckIcon className="size-3" />
            Copied
          </>
        ) : (
          <>
            <CopyIcon className="size-3" />
            Copy
          </>
        )}
      </span>
    </button>
  );
}
