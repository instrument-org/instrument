import { openReportDialog } from "@/client/atoms/report-dialog";
import { feedbackReport } from "@/client/lib/problem-reports";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";

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
              <button
                className="inline underline hover:no-underline"
                onClick={() => {
                  openReportDialog(feedbackReport({ surface: "error-alert" }));
                }}
                type="button"
              >
                Contact us
              </button>
            </div>
          </AlertDescription>
        </div>
        {onRetry && (
          <Button onClick={onRetry} size="sm" variant="outline">
            Retry
          </Button>
        )}
      </div>
    </Alert>
  );
}
