import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { planClearOnView } from "./clear-task-indicator-plan";

// Clears a task's unread indicator once it is actually being viewed -- i.e. it is
// the foreground tab (every tab stays mounted in one renderer, so `useIsActiveTab`
// is what distinguishes them) and the window is visible (not minimized/occluded).
// The clear/hold/debounce decision lives in `planClearOnView`; this hook is the
// React plumbing around it: subscribe to the task, remember the prior view state,
// run the timer, and gate on window visibility.
export function useClearTaskIndicatorOnView(id: TaskId) {
  // The task page already subscribes to this same byId stream, so this shares
  // its data rather than adding a fetch.
  const { data: task } = useQuery(
    rpcClient.workspace.task.live.byId.experimental_liveOptions({
      input: { id },
    }),
  );
  const indicator = task?.unreadIndicator;
  const isUnread = Boolean(indicator);
  const isManual = Boolean(indicator?.manual);
  const isActiveTab = useIsActiveTab();
  const { mutate: clearIndicator } = useMutation(
    rpcClient.workspace.task.clearIndicator.mutationOptions(),
  );

  // Previous render's foreground state and viewed task id, so the plan can tell
  // a fresh arrival from sitting on a task that was already open. Both `null`
  // until the first render, which counts as an arrival.
  const wasActive = useRef<boolean | null>(null);
  const previousId = useRef<null | TaskId>(null);

  useEffect(() => {
    const plan = planClearOnView({
      currentId: id,
      isActiveTab,
      isManual,
      isUnread,
      previousId: previousId.current,
      wasActive: wasActive.current,
    });
    wasActive.current = isActiveTab;
    previousId.current = id;

    if (!plan) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    const cancel = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    // Arm the clear only while the window is on screen; re-check on every
    // visibility change so hiding the window pauses it and showing it resumes.
    const scheduleWhileVisible = () => {
      cancel();
      if (document.visibilityState !== "visible") {
        return;
      }
      timer = setTimeout(() => {
        clearIndicator({ id });
      }, plan.delayMs);
    };

    scheduleWhileVisible();
    document.addEventListener("visibilitychange", scheduleWhileVisible);
    return () => {
      cancel();
      document.removeEventListener("visibilitychange", scheduleWhileVisible);
    };
  }, [id, isUnread, isManual, isActiveTab, clearIndicator]);
}
