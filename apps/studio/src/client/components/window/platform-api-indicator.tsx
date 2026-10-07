import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/client/components/ui/hover-card";
import { useTimedFlag } from "@/client/hooks/use-timed-flag";
import { rpcClient } from "@/client/rpc/client";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { PlugsIcon } from "@phosphor-icons/react/Plugs";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

const START_COMMAND = "pnpm --filter @instrument/api dev";

/**
 * A development build's word that nothing answers at the platform API it was
 * built against, usually because the local API server is not running, with
 * the command that starts it. Absent otherwise, and always in a packaged
 * build. Goes away by itself once the server answers.
 */
export function PlatformApiIndicator() {
  const { data } = useQuery(
    rpcClient.utils.live.platformApiReachability.experimental_liveOptions({}),
  );
  const [open, setOpen] = useState(false);

  if (data?.status !== "unreachable") {
    return null;
  }

  return (
    <HoverCard
      closeDelay={150}
      onOpenChange={setOpen}
      open={open}
      openDelay={150}
    >
      <HoverCardTrigger asChild>
        {/* A button rather than a span: the bar is a drag region, and only
          buttons are carved out of it to take the pointer. */}
        <button
          aria-label="API server not running"
          className="flex h-5 shrink-0 cursor-default items-center gap-1 rounded-full bg-warning-500/10 px-1.5 text-warning-700 ring-1 ring-warning-500/25 ring-inset dark:text-warning-300"
          onClick={() => setOpen(true)}
          type="button"
        >
          <PlugsIcon className="size-3" weight="bold" />
          <span className="text-[10px] leading-none font-medium">API</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-80 p-3 text-xs select-text">
        <p className="font-medium text-foreground">API server isn’t running</p>
        <p className="mt-1 text-muted-foreground">
          Sign-in, plans, web search, and Instrument models need it. Start it
          from the internal repo:
        </p>
        <CopyCommand command={START_COMMAND} />
        <p className="mt-2.5 text-[11px] text-muted-foreground">
          Expected at <span className="font-mono">{data.baseUrl}</span>. This
          goes away once it’s up.
        </p>
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
