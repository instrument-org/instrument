import { shareEqualDeep } from "@/client/lib/share-equal-deep";
import { rpcClient } from "@/client/rpc/client";
import { type ChatId, type StoreId } from "@instrument-org/workspace/client";
import { skipToken, useQueries, useQuery } from "@tanstack/react-query";

/**
 * The tasks one chat has started, by the chat's record id, kept current by
 * the workspace as any of them changes rather than asked for again on a
 * timer. Every reader of one chat passes the same options, so they share one
 * subscription, and a task that did not change keeps its object across
 * updates. Nothing lists every chat's tasks at once.
 */
export function childTasksOptions(chatId: ChatId | typeof skipToken) {
  return rpcClient.workspace.chats.live.tasks.experimental_liveOptions({
    input: chatId === skipToken ? skipToken : { id: chatId },
    structuralSharing: shareEqualDeep,
  });
}

/** The tasks a chat started; none read without a chat. */
export function useChatTasks(chat: ChatId | undefined) {
  return useQuery(childTasksOptions(chat ?? skipToken));
}

/**
 * One task as its chat's list has it, where it stands included: by its
 * session, in the chat whose store holds it. Nothing without a chat, or for
 * a session that is none of its tasks.
 */
export function useChildTask(
  chat: ChatId | undefined,
  id: StoreId.Session,
  enabled = true,
) {
  const tasks = useQuery({
    ...childTasksOptions(chat ?? skipToken),
    enabled,
  });
  return tasks.data?.find((task) => task.id === id);
}

/** Each task's title, kept current, for the tasks named, each in its chat. */
export function useTaskTitlesOf(
  tasks: readonly { chat: ChatId; id: StoreId.Session }[],
): Map<StoreId.Session, string> {
  const chats = [...new Set(tasks.map((task) => task.chat))].toSorted();
  return useQueries({
    queries: chats.map((chat) => ({
      ...childTasksOptions(chat),
      retry: false,
    })),
    combine: (results) =>
      new Map(
        results.flatMap((result) =>
          (result.data ?? []).map((task) => [task.id, task.title] as const),
        ),
      ),
  });
}
