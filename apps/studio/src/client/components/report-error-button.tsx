import { type ReportRequest } from "@/client/atoms/report-dialog";
import { StandaloneReportDialog } from "@/client/components/studio-modals/report-dialog";
import { errorReport } from "@/client/lib/problem-reports";
import { rpcClient } from "@/client/rpc/client";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { Button } from "./ui/button";

/**
 * Send a report beside an error screen's own way out. It opens the report
 * dialog right here rather than through the window's modals, because the
 * window's own fallback draws it with the rest of the window gone. Once sent
 * it reads Report sent, so one error isn't reported twice. With error reports
 * set to go automatically, the error is sent as it appears.
 */
export function ReportErrorButton({
  error,
  surface,
}: {
  error: unknown;
  surface: "route-error" | "window-error";
}) {
  const [request, setRequest] = useState<null | ReportRequest>(null);
  const [sent, setSent] = useState(false);
  useSendAutomatically({
    error,
    onSent: () => {
      setSent(true);
    },
    surface,
  });

  if (sent) {
    return (
      <span className="inline-flex h-9 items-center gap-1.5 px-2 text-sm text-muted-foreground">
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
            errorReport({
              error,
              onSent: () => {
                setSent(true);
              },
              surface,
            }),
          );
        }}
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
      const described = await rpcClient.problems.describe.call({
        error: request.error,
        surface,
      });
      await rpcClient.problems.send.call({
        report: {
          automatic: true,
          details: described.details,
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
