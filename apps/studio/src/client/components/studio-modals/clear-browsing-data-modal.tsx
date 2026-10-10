import { clearBrowsingDataModalAtom } from "@/client/atoms/clear-browsing-data-modal";
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
import { useBlockTabNavigation } from "@/client/hooks/use-block-tab-navigation";
import { useDeferredModalState } from "@/client/hooks/use-deferred-modal-state";
import {
  allTimeNote,
  cacheDetail,
  clearedMessage,
  cookiesDetail,
  historyDetail,
  sinceOf,
  TIME_RANGES,
  type TimeRangeId,
} from "@/client/lib/browsing-data";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useId, useState } from "react";
import { toast } from "sonner";

/**
 * Clears what the in-app browser keeps, the way a browser's own dialog does:
 * a time range, then what to clear, each with a line saying how much there
 * is. Reads `clearBrowsingDataModalAtom`.
 */
export function ClearBrowsingDataModal() {
  const [state, setState] = useAtom(clearBrowsingDataModalAtom);
  const isOpen = state !== null;
  const { content, onExitComplete, openKey } = useDeferredModalState(state);

  useBlockTabNavigation(isOpen);

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
  const clear = useMutation({
    mutationFn: async () => {
      await Promise.all([
        picked.history &&
          rpcClient.history.clear.call({ since: sinceOf(range, Date.now()) }),
        (picked.cache || picked.siteData) &&
          rpcClient.browsingData.clear.call({
            cache: picked.cache,
            siteData: picked.siteData,
          }),
      ]);
    },
    onError: () => {
      toast.error(
        "Something went wrong while clearing your browsing data. Please try again.",
      );
    },
    onSuccess: () => {
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

      <div className="flex items-center justify-between gap-4">
        <label className="text-sm" htmlFor="clear-browsing-data-range">
          Time range
        </label>
        <Select
          onValueChange={(value) => {
            const option = TIME_RANGES.find((r) => r.id === value);
            if (option) {
              setRange(option.id);
            }
          }}
          value={range}
        >
          <SelectTrigger className="w-40" id="clear-browsing-data-range">
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
        <BucketRow
          checked={picked.history}
          detail={history && historyDetail(history)}
          label="Browsing history"
          onCheckedChange={(checked) => {
            setPicked((current) => ({ ...current, history: checked }));
          }}
        />
        <BucketRow
          checked={picked.siteData}
          detail={summary && cookiesDetail(summary.cookieSites)}
          label="Cookies and other site data"
          onCheckedChange={(siteData) => {
            setPicked((current) => ({ ...current, siteData }));
          }}
        />
        <BucketRow
          checked={picked.cache}
          detail={summary && cacheDetail(summary.cacheBytes)}
          label="Cached images and files"
          onCheckedChange={(cache) => {
            setPicked((current) => ({ ...current, cache }));
          }}
        />
      </div>

      {note && <p className="text-sm text-muted-foreground">{note}</p>}

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

function BucketRow({
  checked,
  detail,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  /** How much there is, once it is known. */
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
