import { type WindowTab } from "@/client/atoms/window";
import { useHostPaths } from "@/client/hooks/use-host-paths";
import { useChatCommands } from "@/client/hooks/use-task-background-processes";
import { rpcClient } from "@/client/rpc/client";
import {
  browserTargetOf,
  type ChatId,
  type ChildTask,
  type DeveloperNote,
  type DeveloperNoteBody,
  isToolPart,
  type SessionMessagePart,
  type StepPart,
  type StoreId,
  type TranscriptMessage,
} from "@instrument-org/workspace/client";
import { skipToken, useQueries, useQuery } from "@tanstack/react-query";
import { createContext, use } from "react";

import { useChatTasks } from "../window/child-tasks-query";
import { useWindowTabs } from "../window/window-tabs";
import { type CommandFacts, type TaskCardFacts } from "./surface";
import { taskCardFacts } from "./task-card-facts";
import { transcriptFeedOptions } from "./use-transcript-feed";

/** The chat whose records a transcript in the app reads. */
export const LiveChatContext = createContext<ChatId | undefined>(undefined);

/**
 * What a transcript reads beyond the messages it is handed, as records in the
 * shapes the app reads, for a page that has no chat under it (the debug page
 * plays a script). Where they are given, they are read in place of the chat's.
 */
export interface TranscriptRecords {
  /** The commands the chat and its tasks left going, and those that have since ended. */
  commands: readonly CommandFacts[];
  developerNotes: {
    bodies: Readonly<Record<string, DeveloperNoteBody>>;
    notes: readonly DeveloperNote[];
  };
  /** Where a path a call named is on this computer. */
  hostPathOf: (path: string) => null | string;
  /** Every part of the chat's messages, which an opened step is read whole from. */
  parts: readonly SessionMessagePart.Type[];
  /** Each task's messages, by its session. */
  taskMessages: ReadonlyMap<StoreId.Session, readonly TranscriptMessage[]>;
  /** The tasks the chat started. */
  tasks: readonly ChildTask[];
}

export const TranscriptRecordsContext = createContext<
  TranscriptRecords | undefined
>(undefined);

/** The chat to read live, when there is one and no records stand in for it. */
function useLiveChat(): ChatId | undefined {
  const records = use(TranscriptRecordsContext);
  const chat = use(LiveChatContext);
  return records ? undefined : chat;
}

const NO_MESSAGES: readonly TranscriptMessage[] = [];
const NO_NOTES: readonly DeveloperNote[] = [];

/** An opened step's call or thought, read whole; nothing is read while it is closed. */
export function useStepPart(
  step: StepPart,
  isOpen: boolean,
): SessionMessagePart.ReasoningPart | SessionMessagePart.ToolPart | undefined {
  const records = use(TranscriptRecordsContext);
  const chat = useLiveChat();
  const whole = useQuery({
    ...rpcClient.workspace.message.live.whole.experimental_liveOptions({
      input:
        chat === undefined
          ? skipToken
          : {
              id: chat,
              messageId: step.metadata.messageId,
              sessionId: step.metadata.sessionId,
            },
    }),
    enabled: chat !== undefined && isOpen,
  });
  const part = (records?.parts ?? whole.data?.parts)?.find(
    (each) => each.metadata.id === step.metadata.id,
  );
  return part && (isToolPart(part) || part.type === "reasoning")
    ? part
    : undefined;
}

/**
 * Where the paths a call or a message named are on this computer, once that
 * is known: in the transcript's chat, or in `chatId` outside one.
 */
export function useTranscriptHostPaths(
  paths: readonly string[],
  chatId?: ChatId,
): Record<string, null | string> {
  const records = use(TranscriptRecordsContext);
  const chat = use(LiveChatContext) ?? chatId;
  const found = useHostPaths(records ? undefined : chat, paths);
  return records
    ? Object.fromEntries(paths.map((path) => [path, records.hostPathOf(path)]))
    : found;
}

/** The commands the chat and its tasks left going, and those that have since ended. */
export function useTranscriptCommands(): readonly CommandFacts[] {
  const records = use(TranscriptRecordsContext);
  const live = useChatCommands(useLiveChat());
  return records ? records.commands : live;
}

/**
 * What a task's card says: the stretch of its log from `from`, the message a
 * send put there, or from its start without one. A task the chat's list does
 * not have is gone: a branch's copy of a card whose task stayed with the chat
 * it came from.
 */
export function useTaskFacts(
  id: StoreId.Session,
  from?: StoreId.Message,
): TaskCardFacts | undefined {
  const records = use(TranscriptRecordsContext);
  const live = useChatTasks(useLiveChat());
  const tasks = records ? records.tasks : live.data;
  const task = tasks?.find((each) => each.id === id);
  if (tasks && !task) {
    return {
      failed: false,
      gone: true,
      stoppable: false,
      title: "Task",
      working: false,
    };
  }
  return task && taskCardFacts(task, from);
}

/** A task's messages, read while it works. */
export function useTaskMessages(
  id: StoreId.Session,
  isWorking: boolean,
): readonly TranscriptMessage[] {
  const records = use(TranscriptRecordsContext);
  const chat = useLiveChat();
  const feed = useQuery({
    ...transcriptFeedOptions(
      chat === undefined ? undefined : { id: chat, sessionId: id },
    ),
    enabled: isWorking,
  });
  if (!isWorking) {
    return NO_MESSAGES;
  }
  return records
    ? (records.taskMessages.get(id) ?? NO_MESSAGES)
    : (feed.data?.messages ?? NO_MESSAGES);
}

type PageTab = Extract<WindowTab, { kind: "page" }>;

/**
 * The page a session's work is on: the chat's tab that session sent its
 * latest command, read live as it works, so a session that moves to another
 * tab is pictured there. Every session of a chat drives every tab of it, so
 * none is the session's until it acts in one. Nothing is read while
 * `sessionId` is absent, or without a live chat.
 */
export function useDrivenTab(
  sessionId: StoreId.Session | undefined,
): PageTab | undefined {
  const chat = useLiveChat();
  const { allTabs } = useWindowTabs();
  const pages =
    sessionId === undefined || chat === undefined
      ? []
      : allTabs.filter(
          (tab): tab is PageTab => tab.kind === "page" && tab.group === chat,
        );
  const driven = useQueries({
    combine: (results) => results.map((result) => result.data?.lastAt ?? 0),
    queries: pages.map((tab) =>
      rpcClient.workspace.browser.events.agentActivity.experimental_liveOptions(
        {
          input: {
            targetId: browserTargetOf(tab.id),
            ...(sessionId ? { sessionId } : {}),
          },
        },
      ),
    ),
  });
  let newest: PageTab | undefined;
  let newestAt = 0;
  for (const [index, tab] of pages.entries()) {
    const at = driven[index] ?? 0;
    if (at > newestAt) {
      newest = tab;
      newestAt = at;
    }
  }
  return newest;
}

/** What the page a session's work is on says it is, as its tab last heard. */
export function useDrivenPage(
  sessionId: StoreId.Session | undefined,
): { favicon?: string; title?: string; url?: string } | undefined {
  const tab = useDrivenTab(sessionId);
  const url = tab?.url ?? tab?.openedUrl;
  return (
    tab && {
      ...(tab.favicon && { favicon: tab.favicon }),
      ...(tab.title && { title: tab.title }),
      ...(url && { url }),
    }
  );
}

/** A session's developer notes. */
export function useDeveloperNotes({
  chatId,
  sessionId,
}: {
  chatId: ChatId;
  sessionId: StoreId.Session;
}): readonly DeveloperNote[] {
  const records = use(TranscriptRecordsContext);
  const live = useQuery(
    rpcClient.workspace.message.live.developerNotes.experimental_liveOptions({
      input: records ? skipToken : { id: chatId, sessionId },
    }),
  );
  return records ? records.developerNotes.notes : (live.data ?? NO_NOTES);
}

/** What a note's card shows; undefined until it has been read. */
export function useDeveloperNoteBody({
  chatId,
  note,
  sessionId,
}: {
  chatId: ChatId;
  note: string;
  sessionId: StoreId.Session;
}): DeveloperNoteBody | null | undefined {
  const records = use(TranscriptRecordsContext);
  const live = useQuery({
    ...rpcClient.workspace.message.developerNoteBody.queryOptions({
      input: records ? skipToken : { id: chatId, note, sessionId },
    }),
    gcTime: 0,
  });
  return records ? (records.developerNotes.bodies[note] ?? null) : live.data;
}
