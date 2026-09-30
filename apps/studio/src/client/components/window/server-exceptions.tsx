import { openSettings } from "@/client/atoms/settings-modal";
import { CopyButton } from "@/client/components/copy-button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/client/components/ui/accordion";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { rpcClient } from "@/client/rpc/client";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { XIcon } from "@phosphor-icons/react/X";
import { useMutation, useQuery } from "@tanstack/react-query";
import { isEqual } from "radashi";
import { useState } from "react";

interface GroupedException {
  code?: string;
  content: string;
  count: number;
  firstLine: string;
  id: string;
  rpcPath?: string;
}

interface ServerException {
  code?: string;
  details?: string;
  id: string;
  message: string;
  rpcPath?: string;
}

/**
 * What the main process has thrown since it started or was last cleared, as a
 * count in the window's corner beside the developer panel. Absent while there
 * is nothing to report. Opens onto the exceptions themselves, grouped where
 * they repeat, each expandable to its stack and copyable, with the diagnostic
 * log a click further for what happened around them.
 */
export function ServerExceptionsIndicator() {
  const { data: exceptions } = useQuery(
    rpcClient.utils.live.serverExceptions.experimental_liveOptions({}),
  );
  const [open, setOpen] = useState(false);

  const grouped = groupExceptions(exceptions ?? []);
  const total = exceptions?.length ?? 0;

  if (total === 0) {
    return null;
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-label={`${total} server ${total === 1 ? "exception" : "exceptions"}`}
          className="flex h-5 shrink-0 items-center gap-1 rounded-full bg-destructive/10 px-1.5 text-destructive ring-1 ring-destructive/20 ring-inset hover:bg-destructive/15 aria-expanded:bg-destructive/20"
          type="button"
        >
          <WarningCircleIcon className="size-3" weight="fill" />
          <span className="font-mono text-[9px] leading-none tabular-nums">
            {total}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[min(480px,calc(var(--radix-popover-content-available-height)/var(--content-zoom)))] w-120 overflow-hidden p-0 select-text"
      >
        <ServerExceptionsList
          grouped={grouped}
          onViewLog={() => {
            setOpen(false);
            openSettings({ diagnosticLog: true, tab: "General" });
          }}
          total={total}
        />
      </PopoverContent>
    </Popover>
  );
}

function formatExceptionForCopy(exception: GroupedException) {
  const prefixParts: string[] = [];
  if (exception.rpcPath) {
    prefixParts.push(`[${exception.rpcPath}]`);
  }
  if (exception.code) {
    prefixParts.push(`[${exception.code}]`);
  }

  return [prefixParts.join(" "), exception.firstLine, exception.content]
    .filter((part) => part.length > 0)
    .join("\n");
}

function formatExceptionsForCopy(exceptions: GroupedException[]) {
  return exceptions.map(formatExceptionForCopy).join("\n\n");
}

/** One entry per distinct exception, counting how often each was thrown. */
function groupExceptions(exceptions: ServerException[]): GroupedException[] {
  const groups: GroupedException[] = [];

  for (const exception of exceptions) {
    const content = exception.details || exception.message;
    const firstLine = (content.split("\n")[0] || content).replace(
      /^Error:\s*/i,
      "",
    );
    const key = {
      code: exception.code,
      content,
      firstLine,
      rpcPath: exception.rpcPath,
    };

    const existing = groups.find((group) =>
      isEqual(
        {
          code: group.code,
          content: group.content,
          firstLine: group.firstLine,
          rpcPath: group.rpcPath,
        },
        key,
      ),
    );

    if (existing) {
      existing.count++;
    } else {
      groups.push({ ...key, count: 1, id: exception.id });
    }
  }

  return groups;
}

function ServerExceptionsList({
  grouped,
  onViewLog,
  total,
}: {
  grouped: GroupedException[];
  onViewLog: () => void;
  total: number;
}) {
  const { mutate: clearExceptions } = useMutation(
    rpcClient.utils.clearExceptions.mutationOptions({}),
  );

  return (
    <div className="flex max-h-[inherit] flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-3 py-1.5">
        <WarningCircleIcon className="size-3.5 shrink-0 text-destructive" />
        <span className="flex-1 text-xs font-medium text-foreground">
          Server {total === 1 ? "exception" : "exceptions"}
        </span>
        <Badge
          className="h-4 min-w-4 shrink-0 px-1 py-0 text-[10px] tabular-nums"
          variant="destructive"
        >
          {total}
        </Badge>
        <Button
          className="h-5 px-1.5 text-[11px] select-none"
          onClick={onViewLog}
          size="xs"
          variant="ghost"
        >
          View log
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <CopyButton
              className="size-5 rounded-sm p-0.5 text-muted-foreground select-none hover:bg-foreground/5 hover:text-foreground"
              iconSize={12}
              onCopy={() =>
                navigator.clipboard.writeText(formatExceptionsForCopy(grouped))
              }
            />
          </TooltipTrigger>
          <TooltipContent>Copy all exceptions</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Clear"
              className="size-5 select-none"
              onClick={() => {
                clearExceptions();
              }}
              size="icon"
              variant="ghost"
            >
              <XIcon className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Clear</TooltipContent>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Accordion className="border-0" type="multiple">
          {grouped.map((exception) => (
            <AccordionItem
              className="relative isolate border-b last:border-b-0"
              key={exception.id}
              value={exception.id}
            >
              <AccordionTrigger className="min-w-0 gap-2 py-1.5 pr-12 pl-1 hover:bg-muted/50 hover:no-underline data-[state=open]:bg-muted/50">
                <div className="flex min-w-0 flex-1 items-center gap-0.5">
                  {exception.count > 1 && (
                    <Badge
                      className="flex h-3.5 min-w-3.5 shrink-0 items-center justify-center p-0 text-[9px] tabular-nums"
                      variant="secondary"
                    >
                      {exception.count}
                    </Badge>
                  )}
                  <span className="block truncate overflow-hidden text-left font-mono text-[11px] leading-tight text-foreground/90">
                    {exception.code ? `[${exception.code}] ` : ""}
                    {exception.rpcPath ? `[${exception.rpcPath}] ` : ""}
                    {exception.firstLine}
                  </span>
                </div>
              </AccordionTrigger>
              <div className="absolute top-1.5 right-6 z-10">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <CopyButton
                      className="size-5 rounded-sm p-0.5 text-muted-foreground select-none hover:bg-foreground/5 hover:text-foreground"
                      iconSize={12}
                      onCopy={() =>
                        navigator.clipboard.writeText(
                          formatExceptionForCopy(exception),
                        )
                      }
                    />
                  </TooltipTrigger>
                  <TooltipContent>Copy exception</TooltipContent>
                </Tooltip>
              </div>
              <AccordionContent className="px-3 pt-0 pb-2">
                <div className="mb-2 rounded-sm border bg-muted/50 p-1.5 font-mono text-[11px] leading-relaxed wrap-break-word text-foreground/90">
                  {exception.rpcPath && (
                    <span className="text-dev-700 dark:text-dev-300">
                      [{exception.rpcPath}]{" "}
                    </span>
                  )}
                  {exception.code && (
                    <span className="text-warning-700 dark:text-warning-300">
                      [{exception.code}]{" "}
                    </span>
                  )}
                  <span>{exception.firstLine}</span>
                </div>
                <pre className="rounded-sm border bg-muted/50 p-1.5 font-mono text-[10px] leading-snug wrap-break-word whitespace-pre-wrap text-foreground/80">
                  {exception.content}
                </pre>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </div>
  );
}
