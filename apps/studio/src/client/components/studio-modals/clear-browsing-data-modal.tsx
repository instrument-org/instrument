import { clearBrowsingDataModalAtom } from "@/client/atoms/clear-browsing-data-modal";
import { ACTIONS_KEY } from "@/client/components/activity/activity-keys";
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
import { useModalBack } from "@/client/hooks/use-modal-back";
import { useDeferredModalState } from "@/client/hooks/use-deferred-modal-state";
import {
  allTimeNote,
  cacheDetail,
  clearedMessage,
  cookiesDetail,
  historyDetail,
  sinceOf,
  type TimeRangeId,
} from "@/client/lib/browsing-data";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useState } from "react";
import { toast } from "@/client/lib/toast";

/**
 * Clears what the in-app browser keeps, the way a browser's own dialog does:
 * a time range, then what to clear, each with a line saying how much there
 * is. Reads `clearBrowsingDataModalAtom`.
 */
export function ClearBrowsingDataModal() {
  const [state, setState] = useAtom(clearBrowsingDataModalAtom);
  const isOpen = state !== null;
  const { content, onExitComplete, openKey } = useDeferredModalState(state);

  useModalBack(() => {
    setState(null);
  }, isOpen);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          setState(null);
        }
      }}
      open={isOpen}
    >
      {content !== null && (
        <ClearBrowsingDataContent
          key={openKey}
          onClose={() => {
            setState(null);
          }}
          onExitComplete={onExitComplete}
        />
      )}
    </Dialog>
  );
}

type Picked = { cache: boolean; history: boolean; siteData: boolean };

function ClearBrowsingDataContent({
  onClose,
  onExitComplete,
}: {
  onClose: () => void;
  onExitComplete: () => void;
}) {
  const [range, setRange] = useState<TimeRangeId>("hour");
  // Ranges count back from when the dialog opened, so the history summary
  // asks the same thing until the range changes.
  const [openedAt] = useState(() => Date.now());
  // Cookies go from all time whatever the range, and clearing them signs
  // the person out, so that one waits to be asked for.
  const [picked, setPicked] = useState<Picked>({
    cache: true,
    history: true,
    siteData: false,
  });
  const { data: history } = useQuery({
    ...rpcClient.history.summary.queryOptions({
      input: { since: sinceOf(range, openedAt) },
    }),
    gcTime: 0,
  });
  const { data: summary } = useQuery({
    ...rpcClient.browsingData.summary.queryOptions(),
    // What is there changes with every page; each opening asks again.
    gcTime: 0,
  });
  const queryClient = useQueryClient();
  const clear = useMutation({
    mutationFn: async () => {
      const since = sinceOf(range, Date.now());
      await Promise.all([
        picked.history &&
          rpcClient.history.clear.call({ closedTabs: true, since }),
        (picked.cache || picked.siteData) &&
          rpcClient.browsingData.clear.call({
            cache: picked.cache,
            siteData: picked.siteData,
          }),
      ]);
    },
    onError: (error) => {
      toast.error("Couldn't clear your browsing data", { cause: error });
    },
    onSuccess: () => {
      void queryClient.resetQueries({ queryKey: ACTIONS_KEY });
      toast.success(clearedMessage({ ...picked, range }));
      onClose();
    },
  });

  const anyPicked = picked.cache || picked.history || picked.siteData;
  const note = allTimeNote({ ...picked, range });

  return (
    <DialogContent maxWidth="28rem" onExitComplete={onExitComplete}>
      <div className="flex flex-col gap-2">
        <DialogTitle>Clear browsing data</DialogTitle>
        <DialogDescription>
          {`This clears what the browser in ${APP_NAME} has kept from the sites you visit. Your chats and files stay as they are.`}
        </DialogDescription>
      </div>

      <DialogBody className="flex flex-col gap-4">
        <TimeRangeField onChange={setRange} range={range} />

        <div className="flex flex-col gap-1">
          <ClearBox
            checked={picked.history}
            detail={history && historyDetail(history)}
            label="Browsing history"
            onCheckedChange={(checked) => {
              setPicked((current) => ({ ...current, history: checked }));
            }}
          />
          <ClearBox
            checked={picked.siteData}
            detail={summary && cookiesDetail(summary.cookieSites)}
            label="Cookies and other site data"
            onCheckedChange={(siteData) => {
              setPicked((current) => ({ ...current, siteData }));
            }}
          />
          <ClearBox
            checked={picked.cache}
            detail={summary && cacheDetail(summary.cacheBytes)}
            label="Cached images and files"
            onCheckedChange={(cache) => {
              setPicked((current) => ({ ...current, cache }));
            }}
          />
        </div>

        {note && <p className="text-sm text-muted-foreground">{note}</p>}
      </DialogBody>

      <DialogFooter>
        <Button onClick={onClose} variant="outline">
          Cancel
        </Button>
        <Button
          disabled={!anyPicked || clear.isPending}
          onClick={() => {
            clear.mutate();
          }}
        >
          Clear data
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
