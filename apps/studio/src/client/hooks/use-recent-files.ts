import { rpcClient } from "@/client/rpc/client";
import { WINDOW_ID } from "@instrument-org/workspace/client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

/** How many of the files the person opened the recents carry. */
const RECENT_FILES_MAX = 100;

/**
 * The files the person opened, most recently opened first, each as the
 * browser shows it and with whether the window's chats can reach it. Main
 * keeps which files and when; the workspace says what each is now, and a file
 * since moved away or thrown out is left off.
 */
export function useRecentFiles({
  enabled = true,
  refetchInterval = false,
}: {
  enabled?: boolean;
  refetchInterval?: false | number;
} = {}) {
  const opened = useQuery(
    rpcClient.history.live.files.experimental_liveOptions({
      enabled,
      input: { limit: RECENT_FILES_MAX },
    }),
  );
  const openedFiles = opened.data ?? [];
  const described = useQuery(
    rpcClient.workspace.computer.describe.queryOptions({
      enabled: enabled && opened.data !== undefined,
      input: { id: WINDOW_ID, paths: openedFiles.map((file) => file.path) },
      // The list keeps its rows while a new open is described, rather than
      // emptying for the moment between the two answers.
      placeholderData: keepPreviousData,
      refetchInterval,
    }),
  );
  const openedAt = new Map(openedFiles.map((file) => [file.path, file.at]));
  const files = (described.data ?? []).flatMap((entry) => {
    const at = openedAt.get(entry.path);
    return at === undefined ? [] : [{ ...entry, openedAt: at }];
  });
  return { files, isPending: opened.isPending || described.isPending };
}

/**
 * Tells history the person opened a file in one of the app's tabs. Said each
 * time a file comes up in the tab they are looking at.
 */
export function noteFileOpened(path: string) {
  void rpcClient.history.noteFileOpened.call({ path }).catch(() => null);
}
