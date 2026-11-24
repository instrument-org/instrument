import { Button } from "@/client/components/ui/button";
import {
  ClearBox,
  TimeRangeField,
} from "@/client/components/clear-dialog-parts";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { useDeferredModalState } from "@/client/hooks/use-deferred-modal-state";
import { sinceOf, type TimeRangeId } from "@/client/lib/browsing-data";
import {
  activityClearedMessage,
  thingsDetail,
} from "@/client/lib/clear-activity";
import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

/**
 * Clears the record of what the person did in the app the way Clear browsing
 * data clears the browser's: a time range, then what to clear, each with how
 * much there is in it. The pages they visited are the browser's, so they are
 * not among these.
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
  const [picked, setPicked] = useState({
    changes: true,
    opened: true,
    requests: false,
  });
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
      toast.error("Couldn't clear your history", { cause: error });
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
        <DialogTitle>{`Clear ${APP_NAME} history`}</DialogTitle>
        <DialogDescription>
          This clears the record of what you did. Your chats and files stay as
          they are.
        </DialogDescription>
      </div>

      <DialogBody className="flex flex-col gap-4">
        <TimeRangeField onChange={setRange} range={range} />

        <div className="flex flex-col gap-1">
          <ClearBox
            checked={picked.opened}
            detail={summary && thingsDetail(summary.opened)}
            label="Files and chats you opened"
            onCheckedChange={(opened) => {
              setPicked((current) => ({ ...current, opened }));
            }}
          />
          <ClearBox
            checked={picked.changes}
            detail={
              summary &&
              (summary.changes === 0
                ? thingsDetail(0)
                : "Edits, moves, sign-ins and settings")
            }
            label="Changes you made"
            onCheckedChange={(changes) => {
              setPicked((current) => ({ ...current, changes }));
            }}
          />
          <ClearBox
            checked={picked.requests}
            detail={
              summary &&
              (summary.requests === 0
                ? thingsDetail(0)
                : "Which models your chats used, and when")
            }
            label="AI usage"
            onCheckedChange={(requests) => {
              setPicked((current) => ({ ...current, requests }));
            }}
          />
        </div>

        {picked.opened && (
          <p className="text-sm text-muted-foreground">
            This also clears your recent files from that time.
          </p>
        )}
      </DialogBody>

      <DialogFooter>
        <Button onClick={onClose} variant="outline">
          Cancel
        </Button>
        <Button
          disabled={
            !(picked.changes || picked.opened || picked.requests) ||
            clear.isPending
          }
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
