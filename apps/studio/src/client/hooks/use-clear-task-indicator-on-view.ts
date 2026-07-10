import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

// Delay before a viewed task is marked read. Short enough that a genuine glance
// clears the dot, but long enough to skip an accidental flick past the task
// (rapid tab-cycling, arrowing through the list).
const VIEW_CLEAR_DELAY_MS = 500;

// Clears a task's unread indicator a few seconds after its page is actually
// being viewed. Every tab stays mounted (hidden via CSS visibility) in a single
// renderer, so `document.visibilityState` can't tell tabs apart -- gate on the
// foreground tab via `useIsActiveTab`, and additionally require the window to be
// shown so a background/minimized window doesn't clear it.
export function useClearTaskIndicatorOnView(id: TaskId) {
  // The task page already subscribes to this same byId stream, so this shares
  // its data rather than adding a fetch.
  const { data: task } = useQuery(
    rpcClient.workspace.task.live.byId.experimental_liveOptions({
      input: { id },
    }),
  );
  const isUnread = Boolean(task?.unreadIndicator);
  const isActiveTab = useIsActiveTab();
  const { mutate: clearIndicator } = useMutation(
    rpcClient.workspace.task.clearIndicator.mutationOptions(),
  );

  useEffect(() => {
    if (!isUnread || !isActiveTab) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    const stop = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    const start = () => {
      stop();
      if (document.visibilityState !== "visible") {
        return;
      }
      timer = setTimeout(() => {
        clearIndicator({ id });
      }, VIEW_CLEAR_DELAY_MS);
    };

    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", start);
    };
  }, [id, isUnread, isActiveTab, clearIndicator]);
}
