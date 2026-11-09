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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { useDeferredModalState } from "@/client/hooks/use-deferred-modal-state";
import {
  sinceOf,
  TIME_RANGES,
  type TimeRangeId,
} from "@/client/lib/browsing-data";
import {
  activityClearedMessage,
  requestsDetail,
  thingsDetail,
} from "@/client/lib/clear-activity";
import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

/**
 * Clears the person's activity the way Clear browsing data clears history:
 * a time range, then what to clear, each with how much there is in it.
 * What they did in the app goes from the action log and the app's history,
 * which takes the recent files and the address field's suggestions with it;
 * the AI requests go from this computer's own log.
 */
export function ClearActivityDialog({
  onCleared,
  onOpenChange,
  open,
}: {
  onCleared: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const { content, onExitComplete, openKey } = useDeferredModalState(
    open ? true : null,
  );
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {content !== null && (
        <ClearActivityContent
          key={openKey}
          onClose={() => {
            onOpenChange(false);
          }}
          onCleared={onCleared}
          onExitComplete={onExitComplete}
        />
      )}
    </Dialog>
  );
}

function ClearActivityContent({
  onCleared,
  onClose,
  onExitComplete,
}: {
  onCleared: () => void;
  onClose: () => void;
  onExitComplete: () => void;
}) {
  const [range, setRange] = useState<TimeRangeId>("hour");
  // Ranges count back from when the dialog opened, so the summary asks the
  // same thing until the range changes.
  const [openedAt] = useState(() => Date.now());
  const [picked, setPicked] = useState({ actions: true, requests: false });
  const { data: summary } = useQuery({
    ...rpcClient.activity.summary.queryOptions({
      input: { since: sinceOf(range, openedAt) },
    }),
    gcTime: 0,
  });
  const clear = useMutation({
    mutationFn: () =>
      rpcClient.activity.clear.call({
        ...picked,
        since: sinceOf(range, Date.now()),
      }),
    onError: (error) => {
      toast.error("Couldn't clear your activity", { cause: error });
    },
    onSuccess: () => {
      toast.success(activityClearedMessage({ ...picked, range }));
      onCleared();
      onClose();
    },
  });

  return (
    <DialogContent maxWidth="28rem" onExitComplete={onExitComplete}>
      <div className="flex flex-col gap-2">
        <DialogTitle>Clear activity</DialogTitle>
        <DialogDescription>
          Your chats and files stay as they are.
        </DialogDescription>
      </div>

      <div className="flex items-center justify-between gap-4">
        <label className="text-sm" htmlFor="clear-activity-range">
          Time range
        </label>
        <Select
          onValueChange={(value) => {
            const option = TIME_RANGES.find((each) => each.id === value);
            if (option) {
              setRange(option.id);
            }
          }}
          value={range}
        >
          <SelectTrigger className="w-40" id="clear-activity-range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end" position="popper">
            {TIME_RANGES.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <BoxRow
          checked={picked.actions}
          detail={summary && thingsDetail(summary.actions)}
          label={`What you did in ${APP_NAME}`}
          onCheckedChange={(actions) => {
            setPicked((current) => ({ ...current, actions }));
          }}
        />
        <BoxRow
          checked={picked.requests}
          detail={summary && requestsDetail(summary.requests)}
          label="AI requests"
          onCheckedChange={(requests) => {
            setPicked((current) => ({ ...current, requests }));
          }}
        />
      </div>

      {picked.actions && (
        <p className="text-sm text-muted-foreground">
          {
            "This also clears recent files and the address bar's suggestions from that time."
          }
        </p>
      )}

      <DialogFooter>
        <Button onClick={onClose} variant="outline">
          Cancel
        </Button>
        <Button
          disabled={(!picked.actions && !picked.requests) || clear.isPending}
          onClick={() => {
            clear.mutate();
          }}
        >
          Clear
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function BoxRow({
  checked,
  detail,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  /** How much there is in the range, once it is known. */
  detail: string | undefined;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <label className="flex cursor-default items-start gap-3 rounded-lg px-1 py-2">
      <Checkbox
        aria-describedby={`${id}-detail`}
        aria-labelledby={`${id}-label`}
        checked={checked}
        className="mt-0.5"
        onCheckedChange={(value) => {
          onCheckedChange(value === true);
        }}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm" id={`${id}-label`}>
          {label}
        </span>
        <span
          className="min-h-4 text-xs text-muted-foreground"
          id={`${id}-detail`}
        >
          {detail}
        </span>
      </span>
    </label>
  );
}
