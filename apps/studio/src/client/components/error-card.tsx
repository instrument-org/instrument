import { cn } from "@/client/lib/utils";
import { SUPPORT_URL } from "@instrument-org/shared";
import { rootRouteId, useMatch, useRouter } from "@tanstack/react-router";

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

export function ErrorCard({
  description = "We encountered an error while processing your request",
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

  const errors = normalizeErrors(error);
  const errorInfos = errors.map(extractErrorInfo);

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
          <CopyButton
            className={cn(
              buttonVariants({ size: "icon-sm", variant: "ghost" }),
              "text-muted-foreground",
            )}
            onCopy={() => navigator.clipboard.writeText(copyText)}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {errorInfos.map((errorInfo, index) => (
          <div
            className="space-y-1.5 rounded-md border bg-muted/50 px-3 py-2.5"
            key={index}
          >
            {errorInfos.length > 1 && (
              <p className="text-xs font-medium text-muted-foreground">
                Error {index + 1}
              </p>
            )}
            {errorInfo.code && (
              <p className="text-xs font-medium text-error-600 dark:text-error-400">
                {errorInfo.code}
              </p>
            )}
            <pre className="font-mono text-xs leading-relaxed wrap-break-word whitespace-pre-wrap text-foreground/80">
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
              Stack trace{errorInfos.length > 1 ? "s" : ""}
            </summary>
            <div className="mt-2 space-y-2">
              {errorInfos.map(
                (errorInfo, index) =>
                  errorInfo.stack && (
                    <div key={index}>
                      {errorInfos.length > 1 && (
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
      <CardFooter className="justify-end gap-x-2">
        <Button asChild variant="ghost">
          <ExternalLink href={SUPPORT_URL}>Contact us</ExternalLink>
        </Button>
        {isRoot ? (
          <Button asChild variant="outline">
            <InternalLink to="/">Home</InternalLink>
          </Button>
        ) : (
          <Button asChild variant="outline">
            <InternalLink
              onClick={(e) => {
                e.preventDefault();
                window.history.back();
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
