import { cn } from "@/client/lib/utils";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { useState } from "react";

import { CopyButton } from "./copy-button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * Router-independent presentation of one or more errors: a message card per
 * error (with copy affordance) plus a collapsible stack trace. Shared by
 * {@link ErrorCard} (router-aware footer) and the top-level app error fallback
 * (router-free), so it must not use router hooks.
 */
export function ErrorDetails({ error }: { error: unknown }) {
  const errorInfos = normalizeErrors(error).map(extractErrorInfo);
  const hasMultiple = errorInfos.length > 1;

  return (
    <>
      {errorInfos.map((errorInfo, index) => (
        <div
          className={cn(
            "group/error relative rounded-lg bg-muted px-3 py-2.5",
            hasMultiple && "border",
          )}
          key={index}
        >
          <div className="absolute top-2 right-2 opacity-0 group-hover/error:opacity-100">
            <Tooltip>
              <TooltipTrigger asChild>
                <CopyButton
                  className="size-6 rounded-sm p-0.5 text-muted-foreground/60 hover:bg-foreground/5 hover:text-foreground"
                  iconSize={13}
                  onCopy={() => {
                    const info = errorInfos[index];
                    if (!info) {
                      return;
                    }
                    const parts = [
                      info.code
                        ? `[${info.code}] ${info.message}`
                        : info.message,
                    ];
                    if (info.cause != null) {
                      parts.push(`Cause: ${formatCause(info.cause)}`);
                    }
                    if (info.stack) {
                      parts.push(info.stack);
                    }
                    return navigator.clipboard.writeText(parts.join("\n"));
                  }}
                />
              </TooltipTrigger>
              <TooltipContent>Copy error</TooltipContent>
            </Tooltip>
          </div>
          <div className="mb-1.5 flex items-center gap-2">
            {hasMultiple && (
              <span className="text-xs font-medium text-muted-foreground">
                Error {index + 1}
              </span>
            )}
            {errorInfo.code && (
              <span className="rounded-full bg-destructive/10 px-2 py-0.5 font-mono text-xs font-medium text-destructive">
                {errorInfo.code}
              </span>
            )}
          </div>
          <pre className="font-mono text-xs leading-relaxed wrap-break-word whitespace-pre-wrap text-foreground/90">
            {errorInfo.message}
          </pre>
          {errorInfo.cause != null && (
            <div className="mt-2 border-t border-border/40 pt-2">
              <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground/70 uppercase">
                Caused by
              </p>
              <pre className="font-mono text-xs wrap-break-word whitespace-pre-wrap text-muted-foreground">
                {formatCause(errorInfo.cause)}
              </pre>
            </div>
          )}
        </div>
      ))}
      <StackTraceCollapsible
        errorInfos={errorInfos}
        hasMultiple={hasMultiple}
      />
    </>
  );
}

function extractErrorInfo(error: unknown): {
  cause?: unknown;
  code?: string;
  message: string;
  stack?: string;
} {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "An unexpected error occurred. Please try again.";

  const stack = error instanceof Error && error.stack ? error.stack : undefined;

  const cause =
    error instanceof Error && "cause" in error ? error.cause : undefined;

  const code =
    error != null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : undefined;

  return { cause, code, message, stack };
}

function formatCause(cause: unknown): string {
  if (typeof cause === "string") {
    return cause;
  }
  if (cause instanceof Error) {
    return cause.message;
  }
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}

function normalizeErrors(error: unknown): unknown[] {
  return Array.isArray(error) ? error.filter((e) => e != null) : [error];
}

function StackTraceCollapsible({
  errorInfos,
  hasMultiple,
}: {
  errorInfos: ReturnType<typeof extractErrorInfo>[];
  hasMultiple: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  if (!errorInfos.some((info) => info.stack)) {
    return null;
  }

  return (
    <Collapsible onOpenChange={setIsOpen} open={isOpen}>
      <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <CaretDownIcon
          className={cn(
            "size-3 shrink-0 transition-transform duration-150",
            isOpen && "rotate-180",
          )}
        />
        Error detail{hasMultiple ? "s" : ""}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 space-y-2">
          {errorInfos.map(
            (errorInfo, index) =>
              errorInfo.stack && (
                <div key={index}>
                  {hasMultiple && (
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      Error {index + 1}
                    </p>
                  )}
                  <pre className="max-h-48 scrollbar-thin scrollbar-color overflow-auto rounded-lg bg-muted px-3 py-2.5 font-mono text-xs leading-relaxed text-muted-foreground">
                    {errorInfo.stack}
                  </pre>
                </div>
              ),
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
