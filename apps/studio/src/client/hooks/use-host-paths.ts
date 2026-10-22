import { rpcClient } from "@/client/rpc/client";
import { type ChatId } from "@instrument-org/workspace/client";
import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import { unique } from "radashi";

/**
 * Where the files the agent named sit on the computer, by the path it
 * wrote: the translation every person-facing surface makes once, on the way
 * to the screen, since a viewer reads by the real path and a tab is addressed
 * by one. A path the task cannot reach maps to null; a path not yet answered
 * is absent, and a surface draws it once it is.
 *
 * Asked for the whole surface at once rather than per file, against one
 * reading of the task's layout. The answer from the last set stays up while
 * a larger one is asked for, so a transcript that grows does not blink.
 *
 * Asked again when the chat's own folder moves to its title: a file the
 * first turn put there is answered under the folder's first name until then.
 */
export function useHostPaths(
  chatId: ChatId | undefined,
  filePaths: readonly string[],
): Record<string, null | string> {
  const asked = unique(filePaths).toSorted();
  const isAsking = chatId !== undefined && asked.length > 0;
  const { data: ownFolder } = useQuery(
    isAsking
      ? rpcClient.workspace.chats.live.ownFolder.experimental_liveOptions({
          input: { id: chatId },
        })
      : { queryFn: skipToken, queryKey: ["own-folder", "nothing"] },
  );
  const { data } = useQuery(
    isAsking
      ? (() => {
          const options =
            rpcClient.workspace.chats.files.hostPaths.queryOptions({
              input: { filePaths: asked, chatId },
              placeholderData: keepPreviousData,
              refetchOnWindowFocus: false,
            });
          return { ...options, queryKey: [...options.queryKey, ownFolder] };
        })()
      : // Nothing to ask, and nothing to reach for: a surface outside a task
        // renders without a client that knows the workspace at all.
        { queryFn: skipToken, queryKey: ["host-paths", "nothing"] },
  );
  return data ?? {};
}
