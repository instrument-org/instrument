import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/client/components/ui/accordion";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { rpcClient } from "@/client/rpc/client";
import { WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { isEqual } from "radashi";
import { useMemo } from "react";

import { CopyButton } from "./copy-button";

interface GroupedExceptionItem {
  code?: string;
  content: string;
  count: number;
  firstLine: string;
  id: string;
  rpcPath?: string;
}

export function ServerExceptionsAlert() {
  const { data: serverExceptions } = useQuery(
    rpcClient.utils.live.serverExceptions.experimental_liveOptions({}),
  );

  const groupedExceptions = useMemo<GroupedExceptionItem[]>(() => {
    if (!serverExceptions) {
      return [];
    }

    const groups: GroupedExceptionItem[] = [];

    for (const exception of serverExceptions) {
      const content = exception.details || exception.message;
      const firstLine = content.split("\n")[0] || content;
      const firstLineWithoutErrorPrefix = firstLine.replace(/^Error:\s*/i, "");

      const existingGroup = groups.find((group) =>
        isEqual(
          {
            code: group.code,
            content: group.content,
            firstLine: group.firstLine,
            rpcPath: group.rpcPath,
          },
          {
            code: exception.code,
            content,
            firstLine: firstLineWithoutErrorPrefix,
            rpcPath: exception.rpcPath,
          },
        ),
      );

      if (existingGroup) {
        existingGroup.count++;
      } else {
        groups.push({
          code: exception.code,
          content,
          count: 1,
          firstLine: firstLineWithoutErrorPrefix,
          id: exception.id,
          rpcPath: exception.rpcPath,
        });
      }
    }

    return groups;
  }, [serverExceptions]);

  const { mutate: clearExceptions } = useMutation(
    rpcClient.utils.clearExceptions.mutationOptions({}),
  );

  const totalExceptionCount = useMemo(
    () =>
      groupedExceptions.reduce((sum, exception) => sum + exception.count, 0),
    [groupedExceptions],
  );

  if (groupedExceptions.length === 0) {
    return null;
  }

  return (
    <div className="border-b bg-background select-text">
      <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5">
        <WarningCircleIcon className="size-3.5 shrink-0 text-destructive" />
        <span className="flex-1 text-xs font-medium text-foreground">
          Server {groupedExceptions.length === 1 ? "Exception" : "Exceptions"}
        </span>
        <Badge
          className="h-4 min-w-[16px] shrink-0 px-1 py-0 text-[10px] tabular-nums"
          variant="destructive"
        >
          {totalExceptionCount}
        </Badge>
        <Tooltip>
          <TooltipTrigger asChild>
            <CopyButton
              className="size-5 rounded-sm p-0.5 text-muted-foreground select-none hover:bg-foreground/5 hover:text-foreground"
              iconSize={12}
              onCopy={() =>
                navigator.clipboard.writeText(
                  formatExceptionsForCopy(groupedExceptions),
                )
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
          <TooltipContent>
            <p>Clear</p>
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="max-h-32 overflow-y-auto">
        <Accordion className="border-0" type="multiple">
          {groupedExceptions.map((exception) => (
            <AccordionItem
              className="relative isolate border-b last:border-b-0"
              key={exception.id}
              value={exception.id}
            >
              <AccordionTrigger className="min-w-0 gap-2 py-1.5 pr-12 pl-1 hover:bg-muted/50 hover:no-underline data-[state=open]:bg-muted/50">
                <div className="flex min-w-0 flex-1 items-center gap-0.5">
                  {exception.count > 1 && (
                    <Badge
                      className="flex h-3.5 min-w-[14px] shrink-0 items-center justify-center p-0 text-[9px] tabular-nums"
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

function formatExceptionForCopy(exception: GroupedExceptionItem) {
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

function formatExceptionsForCopy(exceptions: GroupedExceptionItem[]) {
  return exceptions.map(formatExceptionForCopy).join("\n\n");
}
