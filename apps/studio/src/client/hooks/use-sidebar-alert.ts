import { useNetworkStatus } from "@/client/hooks/use-network-status";
import { rpcClient } from "@/client/rpc/client";
import { type BellNotice } from "@/shared/notices";
import { useQuery } from "@tanstack/react-query";

/**
 * What the bell's dot says: a problem (a crash or hang waiting to be sent, or
 * a critical notice, which stays until its cause is gone), something new (a
 * notice not yet seen), or nothing.
 */
export function bellDotOf({
  notices,
  problemCount,
}: {
  notices: readonly BellNotice[];
  problemCount: number;
}): "new" | "problem" | null {
  if (
    problemCount > 0 ||
    notices.some((notice) => notice.severity === "critical")
  ) {
    return "problem";
  }
  return notices.some((notice) => !notice.seen) ? "new" : null;
}

/**
 * Whether the updater is on its way to a newer build: a download, even one
 * nobody sees, or a build ready to install, which may yet land by itself.
 */
export function isUpdateOnItsWay(status: string | undefined) {
  return (
    status !== undefined &&
    ["available", "downloading", "downloaded", "installing"].includes(status)
  );
}

/**
 * The one dot the sidebar's button carries while the sidebar is away, for
 * something waiting in it: a warning for the connection or a build that
 * can't update (the top row's amber pills), a problem from the bell, or
 * something new (an update ready, an unseen notice).
 */
export function useSidebarAlert(): "new" | "problem" | "warning" | null {
  const network = useNetworkStatus();
  const { data: updateState } = useQuery(
    rpcClient.updates.live.status.experimental_liveOptions(),
  );
  const { data: stuckBuild } = useQuery(
    rpcClient.notices.live.stuckBuild.experimental_liveOptions(),
  );
  const { data: problems = [] } = useQuery(
    rpcClient.problems.live.pending.experimental_liveOptions(),
  );
  const { data: notices = [] } = useQuery(
    rpcClient.notices.live.list.experimental_liveOptions(),
  );
  const isOffline = !!network && network.status !== "online";
  const isStuck = !!stuckBuild && !isUpdateOnItsWay(updateState?.type);
  if (isOffline || isStuck) {
    return "warning";
  }
  const bell = bellDotOf({ notices, problemCount: problems.length });
  if (bell === "problem") {
    return "problem";
  }
  return (updateState?.type === "downloaded" && updateState.notifyUser) ||
    bell === "new"
    ? "new"
    : null;
}
