import { settingsModalAtom } from "@/client/atoms/settings-modal";
import {
  ACTIONS_KEY,
  REQUESTS_KEY,
} from "@/client/components/activity/activity-page";
import { ClearActivityDialog } from "@/client/components/activity/clear-activity-dialog";
import { settingAnchor } from "@/client/components/settings/settings-index";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Checkbox } from "@/client/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Switch } from "@/client/components/ui/switch";
import { useAppTabs } from "@/client/components/window/app-tabs";
import { SCREEN_ROUTES } from "@/client/components/window/window-href";
import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { LockSimpleIcon } from "@phosphor-icons/react/LockSimple";
import { PauseCircleIcon } from "@phosphor-icons/react/PauseCircle";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { type ReactNode, useId, useState } from "react";

/**
 * Settings › Activity: whether the app keeps a history of what the person
 * does in it, whether chats may read it, and clearing it. The history itself
 * is Activity, a tab of its own.
 */
export function ActivitySection() {
  const queryClient = useQueryClient();
  const appTabs = useAppTabs();
  const closeSettings = useSetAtom(settingsModalAtom);
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const onError = (error: Error) => {
    toast.error("Couldn't change that setting", { cause: error });
  };
  const setKeep = useMutation(
    rpcClient.preferences.setKeepHistory.mutationOptions({ onError }),
  );
  const setShare = useMutation(
    rpcClient.preferences.setShareActionsWithChats.mutationOptions({
      onError,
    }),
  );
  const isKeeping = preferences?.keepHistory !== false;
  const [stopping, setStopping] = useState(false);
  const [clearing, setClearing] = useState(false);
  const startOver = () => {
    void queryClient.resetQueries({ queryKey: ACTIONS_KEY });
    void queryClient.resetQueries({ queryKey: REQUESTS_KEY });
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold">Activity</h3>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
          <LockSimpleIcon className="size-3.25 shrink-0" />
          {`${APP_NAME} keeps a history of what you do in it on this computer.`}
        </p>
      </div>
      {isKeeping ? null : (
        <div className="flex items-center gap-3 rounded-xl bg-foreground/5 px-4 py-2.5 text-sm">
          <PauseCircleIcon className="size-4.5 shrink-0 text-foreground/70" />
          <span className="flex-1">
            {`${APP_NAME} isn't keeping a history right now.`}
          </span>
          <Button
            disabled={setKeep.isPending}
            onClick={() => {
              setKeep.mutate({ enabled: true });
            }}
            size="sm"
            variant="outline"
          >
            Turn on
          </Button>
        </div>
      )}
      <Card className="gap-0 divide-y divide-border p-0">
        <Row
          anchor={settingAnchor("keep-history")}
          end={
            <Switch
              aria-label="Keep a history"
              checked={isKeeping}
              disabled={setKeep.isPending}
              onCheckedChange={(enabled) => {
                if (enabled) {
                  setKeep.mutate({ enabled });
                } else {
                  setStopping(true);
                }
              }}
            />
          }
          line={`${APP_NAME} keeps the pages, files and chats you open, so you can find them again and a chat can tell which file you mean.`}
          title="Keep a history"
        />
        <Row
          anchor={settingAnchor("share-activity")}
          end={
            <Switch
              aria-label="Chats can see this"
              checked={preferences?.shareActionsWithChats !== false}
              disabled={setShare.isPending}
              onCheckedChange={(enabled) => {
                setShare.mutate({ enabled });
              }}
            />
          }
          line="Each message you send includes a short list of what you just did, without names."
          title="Chats can see this"
        />
      </Card>
      <Card className="gap-0 divide-y divide-border p-0">
        <Row
          anchor={settingAnchor("activity-history")}
          end={
            <Button
              onClick={() => {
                closeSettings(null);
                appTabs.open(SCREEN_ROUTES.activity);
              }}
              size="sm"
              variant="outline"
            >
              Show activity
            </Button>
          }
          line="Search what you did and the AI requests your chats made."
          title="Your activity"
        />
        <Row
          anchor={settingAnchor("clear-activity")}
          end={
            <Button
              onClick={() => {
                setClearing(true);
              }}
              size="sm"
              variant="outline"
            >
              Clear activity…
            </Button>
          }
          line="Remove what you did, your AI requests, or both, from a time range."
          title="Clear activity"
        />
      </Card>
      <StopKeepingDialog
        onOpenChange={setStopping}
        onStop={async (clear) => {
          await setKeep.mutateAsync({ enabled: false });
          if (clear) {
            await rpcClient.activity.clear.call({
              actions: true,
              requests: true,
            });
            startOver();
          }
        }}
        open={stopping}
      />
      <ClearActivityDialog
        onCleared={startOver}
        onOpenChange={setClearing}
        open={clearing}
      />
    </div>
  );
}

function Row({
  anchor,
  end,
  line,
  title,
}: {
  /** Where a search's jump lands, `settingAnchor`'s marks. */
  anchor: ReturnType<typeof settingAnchor>;
  end: ReactNode;
  line: string;
  title: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 p-4" {...anchor}>
      <div className="min-w-0 space-y-1">
        <div className="text-sm font-medium">{title}</div>
        <p className="text-xs text-muted-foreground">{line}</p>
      </div>
      <div className="shrink-0">{end}</div>
    </div>
  );
}

/**
 * Asks before the history stops, saying the two things the person would
 * notice, and clears what is kept only when they tick the box.
 */
function StopKeepingDialog({
  onOpenChange,
  onStop,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  onStop: (clear: boolean) => Promise<void>;
  open: boolean;
}) {
  const [clear, setClear] = useState(false);
  const [isStopping, setStopping] = useState(false);
  const boxId = useId();
  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          setClear(false);
        }
        onOpenChange(next);
      }}
      open={open}
    >
      <DialogContent maxWidth="28rem">
        <DialogTitle>Stop keeping a history?</DialogTitle>
        <DialogDescription>
          {`${APP_NAME} will stop keeping the pages, files and chats you open, and the AI requests your chats make. Chats won't be able to tell which file you mean, and the address bar won't suggest pages you've been to.`}
        </DialogDescription>
        <label className="flex items-center gap-2.5 text-sm" htmlFor={boxId}>
          <Checkbox
            checked={clear}
            id={boxId}
            onCheckedChange={(value) => {
              setClear(value === true);
            }}
          />
          Also clear the history you have
        </label>
        <DialogFooter>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={isStopping}
            onClick={() => {
              setStopping(true);
              void onStop(clear)
                .then(() => {
                  setClear(false);
                  onOpenChange(false);
                })
                .catch((error: unknown) => {
                  toast.error("Couldn't stop keeping a history", {
                    cause: error,
                  });
                })
                .finally(() => {
                  setStopping(false);
                });
            }}
            variant="default"
          >
            Stop
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
