import { SUPPORT_URL } from "@instrument-org/shared";
import { WarningCircleIcon } from "@phosphor-icons/react";

import { ExternalLink } from "./external-link";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";

export function ContactErrorAlert({
  children,
  className,
  onRetry,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  onRetry?: () => void;
  title: string;
}) {
  return (
    <Alert className={className} variant="destructive">
      <WarningCircleIcon className="size-4" />
      <div className="col-start-2 flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <div>{children}</div>
            <div className="text-xs text-muted-foreground">
              Need help?{" "}
              <ExternalLink
                className="inline underline hover:no-underline"
                href={SUPPORT_URL}
              >
                Contact us
              </ExternalLink>
            </div>
          </AlertDescription>
        </div>
        {onRetry && (
          <Button
            className="text-primary"
            onClick={onRetry}
            size="sm"
            variant="outline"
          >
            Retry
          </Button>
        )}
      </div>
    </Alert>
  );
}
