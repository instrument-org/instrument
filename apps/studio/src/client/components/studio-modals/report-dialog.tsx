import {
  type ProblemReportRequest,
  type ReportRequest,
  reportDialogAtom,
} from "@/client/atoms/report-dialog";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/client/components/ui/dialog";
import {
  DictatedTextarea,
  useDictatedText,
} from "@/client/components/dictation-controls";
import { isDictating } from "@/client/hooks/use-dictation";
import { REPORT_NOTE_MAX_LENGTH } from "@/shared/problem-reports";
import { useDeferredModalState } from "@/client/hooks/use-deferred-modal-state";
import { useModalBack } from "@/client/hooks/use-modal-back";
import { describeReport, SENT_CLOSE_MS } from "@/client/lib/problem-reports";
import { FeedbackDialogContent } from "./feedback-dialog";
import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useEffect, useId, useState } from "react";

/**
 * The one report dialog, modeled on the Mac's own problem report: the
 * person's note, the details behind Show details, Don't send or Send. Every
 * report goes through it, whatever started it. Reads `reportDialogAtom`.
 */
export function ReportDialog() {
  const [state, setState] = useAtom(reportDialogAtom);
  return (
    <StandaloneReportDialog
      onClose={() => {
        setState(null);
      }}
      request={state}
    />
  );
}

/**
 * The same dialog for a surface that draws it itself, like the window's
 * error fallback, where the modals at the window root are gone.
 */
export function StandaloneReportDialog({
  onClose,
  request,
}: {
  onClose: () => void;
  request: null | ReportRequest;
}) {
  const isOpen = request !== null;
  const { content, onExitComplete, openKey } = useDeferredModalState(request);

  useModalBack(onClose, isOpen);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open={isOpen}
    >
      {content?.kind === "feedback" && (
        <FeedbackDialogContent
          key={openKey}
          onClose={onClose}
          onExitComplete={onExitComplete}
          request={content}
        />
      )}
      {content !== null && content.kind !== "feedback" && (
        <ReportDialogContent
          key={openKey}
          onClose={onClose}
          onExitComplete={onExitComplete}
          request={content}
        />
      )}
    </Dialog>
  );
}

function ReportDialogContent({
  onClose,
  onExitComplete,
  request,
}: {
  onClose: () => void;
  onExitComplete: () => void;
  request: ProblemReportRequest;
}) {
  const noteId = useId();
  const [note, setNote] = useState("");
  const noteDictation = useDictatedText({
    maxLength: REPORT_NOTE_MAX_LENGTH,
    onChange: setNote,
    surface: "report",
    value: note,
  });
  const [showDetails, setShowDetails] = useState(false);
  const [showData, setShowData] = useState(false);
  const [alwaysSend, setAlwaysSend] = useState(false);

  // What Show details shows is exactly what Send sends, so what the main
  // process describes is fetched once and kept for both.
  const { data: described } = useQuery({
    gcTime: 0,
    queryFn: () => describeReport(request),
    queryKey: [
      "report-dialog",
      "describe",
      request.surface,
      request.reportTitle,
    ],
    staleTime: Infinity,
  });
  const details = described?.details;

  const send = useMutation({
    mutationFn: async () => {
      if (details === undefined) {
        return;
      }
      await rpcClient.problems.send.call({
        alwaysSend: request.offerAlwaysSend && alwaysSend,
        pending: request.pending,
        report: {
          automatic: false,
          details,
          events: described?.events,
          fingerprint: described?.fingerprint,
          kind: request.kind,
          note: note.trim() || undefined,
          surface: request.surface,
          title: request.reportTitle,
        },
      });
    },
    onError: (error) => {
      toast.error("Couldn't send the report", { cause: error });
    },
    onSuccess: () => {
      request.onSent?.();
    },
  });

  useEffect(() => {
    if (!send.isSuccess) {
      return;
    }
    const timeout = setTimeout(onClose, SENT_CLOSE_MS);
    return () => {
      clearTimeout(timeout);
    };
  }, [onClose, send.isSuccess]);

  if (send.isSuccess) {
    return (
      <DialogContent maxWidth="35rem" onExitComplete={onExitComplete}>
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <CheckCircleIcon className="size-7 text-brand-600" />
          <DialogTitle>Thanks, we got your report.</DialogTitle>
          <DialogDescription className="sr-only">
            The report was sent.
          </DialogDescription>
        </div>
      </DialogContent>
    );
  }

  return (
    <DialogContent maxWidth="35rem" onExitComplete={onExitComplete}>
      <div className="flex flex-col gap-1">
        <DialogTitle>{request.dialogTitle}</DialogTitle>
        <DialogDescription>{request.intro}</DialogDescription>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium" htmlFor={noteId}>
          {request.noteLabel}
        </label>
        <DictatedTextarea
          autoFocus={request.focusNote}
          id={noteId}
          dictation={noteDictation}
          maxLength={REPORT_NOTE_MAX_LENGTH}
          onChange={(event) => {
            setNote(event.target.value);
          }}
          placeholder="Optional"
          value={note}
        />
      </div>

      <div className="flex flex-col gap-2">
        <button
          aria-expanded={showDetails}
          className="flex w-fit items-center gap-1 text-xs font-medium"
          onClick={() => {
            setShowDetails((shown) => !shown);
          }}
          type="button"
        >
          {showDetails ? (
            <CaretDownIcon className="size-3" />
          ) : (
            <CaretRightIcon className="size-3" />
          )}
          {showDetails ? "Hide details" : "Show details"}
        </button>
        {showDetails && (
          <pre className="max-h-60 overflow-auto rounded-lg bg-muted/60 px-3 py-2.5 font-mono text-[11px] leading-[17px] wrap-anywhere whitespace-pre-wrap select-text">
            {details ?? "Gathering the details…"}
          </pre>
        )}
        {showDetails && described && described.events.length > 0 && (
          <>
            <button
              aria-expanded={showData}
              className="flex w-fit items-center gap-1 text-xs font-medium"
              onClick={() => {
                setShowData((shown) => !shown);
              }}
              type="button"
            >
              {showData ? (
                <CaretDownIcon className="size-3" />
              ) : (
                <CaretRightIcon className="size-3" />
              )}
              {showData ? "Hide the error data" : "Show the error data"}
            </button>
            {showData && (
              <pre className="max-h-60 overflow-auto rounded-lg bg-muted/60 px-3 py-2.5 font-mono text-[11px] leading-[17px] wrap-anywhere whitespace-pre-wrap select-text">
                {JSON.stringify(described.events, null, 2)}
              </pre>
            )}
          </>
        )}
      </div>

      {request.offerAlwaysSend && (
        <label className="flex cursor-default items-start gap-2.5">
          <Checkbox
            checked={alwaysSend}
            className="mt-0.5"
            onCheckedChange={(value) => {
              setAlwaysSend(value === true);
            }}
          />
          <span className="text-sm">
            Send error reports automatically from now on
          </span>
        </label>
      )}

      <DialogFooter>
        <Button onClick={onClose} variant="outline">
          Don't send
        </Button>
        <Button
          // Waits for dictated words, so the note goes with them.
          disabled={
            details === undefined ||
            send.isPending ||
            isDictating(noteDictation.phase)
          }
          onClick={() => {
            send.mutate();
          }}
          variant="brand"
        >
          Send
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
