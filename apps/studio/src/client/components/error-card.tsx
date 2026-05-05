import { cn } from "@/client/lib/utils";
import { SUPPORT_URL } from "@instrument-org/shared";
import {
  rootRouteId,
  useCanGoBack,
  useMatch,
  useRouter,
} from "@tanstack/react-router";

import { CopyButton } from "./copy-button";
import { ExternalLink } from "./external-link";
import { InternalLink } from "./internal-link";
import { Button, buttonVariants } from "./ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function ErrorCard({
  description = "An error occurred. Try again, or go back if the problem persists.",
  error,
  title = "Something went wrong",
}: {
  description?: string;
  error: unknown;
  title?: string;
}) {
  const router = useRouter();
  const isRoot = useMatch({
    select: (state) => state.id === rootRouteId,
    strict: false,
  });
  const canGoBack = useCanGoBack();

  const errors = normalizeErrors(error);
  const errorInfos = errors.map(extractErrorInfo);
  const hasMultiple = errorInfos.length > 1;

  const copyText = errorInfos
    .map((info) => {
      const parts = [
        info.code ? `[${info.code}] ${info.message}` : info.message,
      ];
      if (info.cause != null) {
        parts.push(`Cause: ${formatCause(info.cause)}`);
      }
      if (info.stack) {
        parts.push(info.stack);
      }
      return parts.join("\n");
    })
    .join("\n\n---\n\n");

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="text-xl">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
        <CardAction>
          <Tooltip>
            <TooltipTrigger asChild>
              <CopyButton
                className={cn(
                  buttonVariants({ size: "icon-sm", variant: "ghost" }),
                  "text-muted-foreground",
                )}
                onCopy={() => navigator.clipboard.writeText(copyText)}
              />
            </TooltipTrigger>
            <TooltipContent>Copy error details</TooltipContent>
          </Tooltip>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {errorInfos.map((errorInfo, index) => (
          <div
            className={cn(
              "space-y-1.5 rounded-md bg-muted px-3 py-2.5",
              hasMultiple && "border",
            )}
            key={index}
          >
            {hasMultiple && (
              <p className="text-xs font-medium text-muted-foreground">
                Error {index + 1}
              </p>
            )}
            {errorInfo.code && (
              <p className="text-xs font-medium text-error-600 dark:text-error-400">
                <span className="font-normal text-muted-foreground">
                  Error code:{" "}
                </span>
                {errorInfo.code}
              </p>
            )}
            <pre className="font-mono text-xs leading-relaxed wrap-break-word whitespace-pre-wrap text-foreground/90">
              {errorInfo.message}
            </pre>
            {errorInfo.cause != null && (
              <div className="border-t border-border/50 pt-1">
                <p className="mb-0.5 text-xs font-medium text-muted-foreground">
                  Cause
                </p>
                <pre className="font-mono text-xs wrap-break-word whitespace-pre-wrap text-muted-foreground">
                  {formatCause(errorInfo.cause)}
                </pre>
              </div>
            )}
          </div>
        ))}
        {errorInfos.some((info) => info.stack) && (
          <details className="group">
            <summary className="cursor-pointer text-xs text-muted-foreground select-none hover:text-foreground">
              Stack trace{hasMultiple ? "s" : ""}
            </summary>
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
                      <pre className="max-h-48 overflow-auto rounded-md bg-muted px-3 py-2.5 font-mono text-xs leading-relaxed text-muted-foreground scrollbar-color scrollbar-thin">
                        {errorInfo.stack}
                      </pre>
                    </div>
                  ),
              )}
            </div>
          </details>
        )}
      </CardContent>
      <CardFooter className="flex-col items-end gap-y-3">
        <div className="flex gap-x-2">
          {isRoot ? (
            <Button asChild variant="outline">
              <InternalLink to="/">Home</InternalLink>
            </Button>
          ) : (
            <Button asChild variant="outline">
              <InternalLink
                onClick={(e) => {
                  e.preventDefault();
                  if (canGoBack) {
                    router.history.back();
                  } else {
                    void router.navigate({ to: "/" });
                  }
                }}
                to="/"
              >
                Go back
              </InternalLink>
            </Button>
          )}
          <Button
            onClick={() => {
              void router.invalidate();
            }}
          >
            Try again
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Still broken?{" "}
          <ExternalLink
            className="underline underline-offset-2 hover:text-foreground"
            href={SUPPORT_URL}
          >
            Get help from our team
          </ExternalLink>
          .
        </p>
      </CardFooter>
    </Card>
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
        : "An unexpected error occurred";

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
