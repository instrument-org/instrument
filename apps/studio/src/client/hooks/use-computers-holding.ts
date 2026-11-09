import { rpcClient } from "@/client/rpc/client";
import { type ChatId } from "@instrument-org/workspace/client";
import { skipToken, useQuery } from "@tanstack/react-query";
import { unique } from "radashi";

/**
 * The computer that has each of these files, by its name, for files a
 * message written on another computer kept in a folder only that computer
 * has. Asked only of paths with no place here, so a card can say where the
 * file is rather than only that it is missing; a path left out is missing.
 */
export function useComputersHolding(
  chatId: ChatId | undefined,
  filePaths: readonly string[],
): Record<string, string> {
  const asked = unique(filePaths).toSorted();
  const { data } = useQuery(
    chatId !== undefined && asked.length > 0
      ? rpcClient.workspace.chats.files.computersHolding.queryOptions({
          input: { filePaths: asked, chatId },
          refetchOnWindowFocus: false,
        })
      : { queryFn: skipToken, queryKey: ["computers-holding", "nothing"] },
  );
  return data ?? {};
}
