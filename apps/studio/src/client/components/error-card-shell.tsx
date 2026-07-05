import { SUPPORT_URL } from "@instrument-org/shared";
import { type ReactNode } from "react";

import { ErrorDetails } from "./error-details";
import { ExternalLink } from "./external-link";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";

/**
 * Router-free shell shared by {@link ErrorCard} (router-caught) and
 * {@link AppErrorFallback} (shell crashes, rendered outside any router): the
 * card chrome, error details, and support link. Recovery affordances differ per
 * caller, so they pass their own footer `actions`.
 */
export function ErrorCardShell({
  actions,
  description,
  error,
  title = "Something went wrong",
}: {
  actions: ReactNode;
  description: string;
  error: unknown;
  title?: string;
}) {
  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <ErrorDetails error={error} />
      </CardContent>
      <CardFooter className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Still having trouble?{" "}
          <ExternalLink
            className="underline underline-offset-2 hover:text-foreground"
            href={SUPPORT_URL}
          >
            Get help
          </ExternalLink>
        </p>
        {actions}
      </CardFooter>
    </Card>
  );
}
