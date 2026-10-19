import { type ReportRequest } from "@/client/atoms/report-dialog";
import { StandaloneReportDialog } from "@/client/components/studio-modals/report-dialog";
import { describeReport, errorReport } from "@/client/lib/problem-reports";
import { rpcClient } from "@/client/rpc/client";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/client/lib/utils";

import { Button } from "./ui/button";

/**
 * Send a report beside an error screen's own way out. With error reports set
 * to go automatically, the error is sent as it appears.
 */
export function ReportErrorButton({
  error,
  surface,
}: {
  error: unknown;
  surface: "route-error" | "window-error";
}) {
  const [sent, setSent] = useState(false);
  useSendAutomatically({
    error,
    onSent: () => {
      setSent(true);
    },
    surface,
  });
  return (
    <SendReportButton
      request={(onSent) => errorReport({ error, onSent, surface })}
      sent={sent}
    />
  );
}

/**
 * Send a report about what this surface shows. It opens the report dialog
 * right here rather than through the window's modals, because the window's
 * own fallback draws it with the rest of the window gone, and Settings is
 * itself one of those modals. Once sent it reads Report sent, so one problem
 * isn't reported twice.
 */
export function SendReportButton({
  onSent,
  request: makeRequest,
  sent: sentAlready = false,
  size,
}: {
  onSent?: () => void;
  request: (onSent: () => void) => ReportRequest;
  sent?: boolean;
  size?: "sm";
}) {
  const [request, setRequest] = useState<null | ReportRequest>(null);
  const [sentHere, setSentHere] = useState(false);

  if (sentAlready || sentHere) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 px-2 text-sm text-muted-foreground",
          size === "sm" ? "h-8" : "h-9",
        )}
      >
        <CheckIcon className="size-3.5 text-brand-600" />
        Report sent
      </span>
    );
  }

  return (
    <>
      <Button
        onClick={() => {
          setRequest(
            makeRequest(() => {
              setSentHere(true);
              onSent?.();
            }),
          );
        }}
        size={size}
        variant="outline"
      >
        Send a report
      </Button>
      <StandaloneReportDialog
        onClose={() => {
          setRequest(null);
        }}
        request={request}
      />
    </>
  );
}

function useSendAutomatically({
  error,
  onSent,
  surface,
}: {
  error: unknown;
  onSent: () => void;
  surface: "route-error" | "window-error";
}) {
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const automatic = preferences?.sendErrorReportsAutomatically === true;
  const sentFor = useRef<unknown>(null);

  useEffect(() => {
    if (!automatic || sentFor.current === error) {
      return;
    }
    sentFor.current = error;
    const request = errorReport({ error, surface });
    void (async () => {
      const described = await describeReport(request);
      await rpcClient.problems.send.call({
        report: {
          automatic: true,
          details: described.details,
          events: described.events,
          fingerprint: described.fingerprint,
          kind: request.kind,
          surface,
          title: request.reportTitle,
        },
      });
      onSent();
    })().catch(() => {
      // The main process logs a send that failed; the button stays for a
      // person to try by hand.
    });
  }, [automatic, error, onSent, surface]);
}
