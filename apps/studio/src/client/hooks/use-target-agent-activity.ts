import { rpcClient } from "@/client/rpc/client";
import {
  type BrowserTargetId,
  type ChatId,
} from "@instrument-org/workspace/client";
import { useQueries, useQuery } from "@tanstack/react-query";

/**
 * Which of some guests an agent is at work with, by the chat whose agent it
 * is: one a session with a turn running sent a command in that turn. Every
 * page the turn used keeps the mark until the turn ends, since the agent
 * may go back to any of them, and a page it used only in an earlier turn
 * has none. A tab of the window's handed to a task is the task's, which its
 * chat's work includes.
 */
export function useTargetsAgentActivity(
  targetIds: readonly BrowserTargetId[],
): ReadonlyMap<BrowserTargetId, ChatId> {
  const chats = useQueries({
    combine: (results) =>
      results.map((result) =>
        result.data?.inUse === true ? result.data.chat : undefined,
      ),
    queries: targetIds.map((targetId) =>
      rpcClient.workspace.browser.events.agentActivity.experimental_liveOptions(
        { input: { targetId } },
      ),
    ),
  });
  return new Map(
    targetIds.flatMap((targetId, index) => {
      const chat = chats[index];
      return chat === undefined ? [] : [[targetId, chat] as const];
    }),
  );
}

/**
 * When an agent last sent one guest a command, in ms, moving with each new
 * one; nothing while none has since launch.
 */
export function useTargetAgentLastAt(
  targetId: BrowserTargetId,
): number | undefined {
  const { data } = useQuery(
    rpcClient.workspace.browser.events.agentActivity.experimental_liveOptions({
      input: { targetId },
    }),
  );
  return data?.lastAt;
}
