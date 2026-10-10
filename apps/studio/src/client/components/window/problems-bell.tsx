import { openReportDialog } from "@/client/atoms/report-dialog";
import { Button } from "@/client/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { pendingProblemReport } from "@/client/lib/problem-reports";
import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { type PendingProblem } from "@/shared/problem-reports";
import { APP_NAME } from "@instrument-org/shared";
import { BellIcon } from "@phosphor-icons/react/Bell";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

/**
 * The window's notifications, in its corner: what needs the person and
 * nothing else. For now that is a crash or hang from an earlier session,
 * waiting to be sent or dismissed; a red dot says one is waiting. A crash
 * never interrupts with a toast, so someone whose app keeps crashing can let
 * it wait.
 */
export function ProblemsBell() {
  const { data: problems = [] } = useQuery(
    rpcClient.problems.live.pending.experimental_liveOptions(),
  );
  const [open, setOpen] = useState(false);
  const waiting = problems.length > 0;

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-label={
            waiting ? "Notifications, something needs you" : "Notifications"
          }
          className="relative size-7 [-webkit-app-region:no-drag]"
          size="icon-sm"
          variant="ghost-toolbar"
        >
          <BellIcon className="size-4" />
          {waiting && (
            <span className="absolute top-1 right-1 size-2 rounded-full bg-destructive ring-2 ring-background" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-95 overflow-hidden p-0">
        <div className="flex h-10 items-center border-b border-border px-4 text-[13px] font-semibold">
          Notifications
        </div>
        {waiting ? (
          <div className="divide-y divide-border">
            {problems.map((problem) => (
              <ProblemItem
                key={problem.fingerprint}
                onReport={() => {
                  setOpen(false);
                  openReportDialog(pendingProblemReport(problem));
                }}
                problem={problem}
              />
            ))}
          </div>
        ) : (
          <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">
            Nothing needs you right now.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ProblemItem({
  onReport,
  problem,
}: {
  onReport: () => void;
  problem: PendingProblem;
}) {
  const dismiss = useMutation({
    mutationFn: () =>
      rpcClient.problems.dismiss.call({ fingerprint: problem.fingerprint }),
    onError: (error) => {
      toast.error("Couldn't dismiss it", { cause: error });
    },
  });
  const crashed = problem.kind === "crash";
  const title = crashed
    ? `${APP_NAME} quit unexpectedly`
    : `${APP_NAME} didn't close properly`;
  const line =
    problem.count > 1
      ? `This happened ${problem.count} times. One report covers all of them.`
      : crashed
        ? "Sending a report helps us fix what went wrong."
        : "It may have stopped responding before it was quit. A report helps us find out why.";

  return (
    <div className="flex gap-3 px-4 py-3">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-destructive">
        <WarningCircleIcon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 text-[13px] font-medium">
            {title}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {formatWhen(problem.lastAt)}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{line}</p>
        <div className="mt-2 flex gap-1.5">
          <Button onClick={onReport} size="xs" variant="outline">
            Send a report
          </Button>
          <Button
            disabled={dismiss.isPending}
            onClick={() => {
              dismiss.mutate();
            }}
            size="xs"
            variant="ghost"
          >
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatWhen(at: number) {
  const date = new Date(at);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { day: "numeric", month: "short" });
}
