import { shareEqualDeep } from "@/client/lib/share-equal-deep";
import { rpcClient } from "@/client/rpc/client";
import { type ChatId, type TaskId } from "@instrument-org/workspace/client";
import { skipToken, useQueries, useQuery } from "@tanstack/react-query";

/**
 * The tasks one chat has filed, by the chat's record id, kept current by the
 * workspace as any of them changes rather than asked for again on a timer.
 * Every reader of one chat passes the same options, so they share one
 * subscription, and a task that did not change keeps its object across
 * updates. Nothing lists every chat's tasks at once.
 */
export function childTasksOptions(chatId: TaskId | typeof skipToken) {
  return rpcClient.workspace.chats.live.tasks.experimental_liveOptions({
    input: chatId === skipToken ? skipToken : { id: chatId },
    structuralSharing: shareEqualDeep,
  });
}

/** The tasks a chat filed; none read without a chat. */
export function useChatTasks(chat: ChatId | undefined) {
  return useQuery(childTasksOptions(chat ?? skipToken));
}

/**
 * One task as the list of the chat it was filed in has it, where it stands
 * included; nothing for a task filed in no chat.
 */
export function useChildTask(id: TaskId, enabled = true) {
  const record = useQuery({
    ...taskRecordOptions(id),
    enabled,
  });
  const tasks = useQuery({
    ...childTasksOptions(
      record.data && !record.data.isChat ? record.data.chatId : skipToken,
    ),
    enabled,
  });
  return tasks.data?.find((task) => task.id === id);
}

/**
 * A task's record read once: the chat it was filed in never changes, so a
 * read stands for as long as the window is open.
 */
export function taskRecordOptions(id: TaskId) {
  return rpcClient.workspace.task.byId.queryOptions({
    input: { id },
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Each task's title, kept current, for the tasks named. */
export function useTaskTitlesOf(ids: readonly TaskId[]): Map<TaskId, string> {
  return useQueries({
    queries: ids.map((id) =>
      rpcClient.workspace.task.live.byId.experimental_liveOptions({
        input: { id },
        retry: false,
        structuralSharing: shareEqualDeep,
      }),
    ),
    combine: (results) =>
      new Map(
        results.flatMap((result) =>
          result.data ? [[result.data.id, result.data.title] as const] : [],
        ),
      ),
  });
}
