import { FileDropRegion } from "@/client/components/file-drop-region";
import { FileOpenContext } from "@/client/components/file-open-context";
import { PageOpenContext } from "@/client/components/page-open-context";
import { TaskChat } from "@/client/components/task/chat";
import { Spinner } from "@/client/components/ui/spinner";
import { useAgentSessionStatus } from "@/client/hooks/use-agent-session-status";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { TaskSessionProvider } from "@/client/hooks/use-task-session";
import { rpcClient } from "@/client/rpc/client";
import {
  type SessionMessageDataPart,
  type StoreId,
  type TaskId,
} from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useContext, useEffect } from "react";

import { AskPills } from "./ask-pills";
import { OrchestratorContext, useOrchestrator } from "./context";
import { asksPart, useComposerAsks, useStagedAskActions } from "./staged-asks";
import { threadListOptions } from "./thread-list-query";
import { ThreadWork } from "./thread-work";
import { WorkingRow } from "./working-row";

interface ThreadScreenProps {
  /** Drawn at the head of the composer: what goes with a message besides its words. */
  composerLead?: ReactNode;
  /** Whether this is the thread on screen: only that one marks itself read or takes the caret. */
  isUp: boolean;
  sendContext: () => Promise<
    SessionMessageDataPart.ViewContextDataPart | undefined
  >;
  /** The words that open the thread, while the message they make is on its way. */
  sentPrompt?: string;
  sessionId: StoreId.Session;
}

/**
 * One thread's conversation: its transcript, opening at the end, and a
 * composer that replies in it. Nothing above the transcript: the row over
 * it names the thread, and the top of the scroll is the ask itself. A
 * thread is a chat with a record of its own, named for what it is about,
 * so its record is asked for by the thread's session first.
 */
export function ThreadScreen(props: ThreadScreenProps) {
  const chat = useQuery(
    rpcClient.workspace.orchestrator.chats.of.queryOptions({
      input: { sessionId: props.sessionId },
      // A chat keeps its record for as long as it exists; a thread with none
      // yet is asked again, since its first send may still be making it.
      staleTime: (query) =>
        query.state.data?.taskId ? Number.POSITIVE_INFINITY : 0,
    }),
  );
  const taskId = chat.data?.taskId;
  if (!taskId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Spinner className="size-5" />
      </div>
    );
  }
  return <ChatScreen {...props} taskId={taskId} />;
}

function ChatScreen({
  composerLead,
  isUp,
  sendContext,
  sentPrompt,
  sessionId,
  taskId,
}: ThreadScreenProps & { taskId: TaskId }) {
  const orchestrator = useOrchestrator();
  const task = useQuery(
    rpcClient.workspace.task.live.byId.experimental_liveOptions({
      input: { id: taskId },
    }),
  );
  const state = useQuery(
    rpcClient.workspace.task.state.get.queryOptions({
      input: { id: taskId },
    }),
  );
  // The thread as the list beside the tabs knows it, for the newest reply
  // that has landed, which is what marks it read below.
  const threads = useQuery(threadListOptions());
  const thread = threads.data?.find((entry) => entry.id === sessionId);
  // While the thread's own agent composes, the transcript shows the typing
  // dots; the thread is otherwise at work when a task filed from it is, and
  // that is said at the transcript's tail too. Read from the tasks filed
  // from it rather than from the thread's state, which folds its own agent
  // in: the state is the list's, a re-read behind the actor the dots follow,
  // so at a turn's end it still says working for a moment after the dots
  // have gone, and the tail would say so in their place.
  const { isAgentRunning } = useAgentSessionStatus({ id: taskId, sessionId });
  const isWorkingElsewhere =
    thread?.runningTasks.some((running) => !running.waiting) === true &&
    !isAgentRunning;
  const [defaultModelURI] = useDefaultModelURI();
  const openFile = useContext(FileOpenContext);
  const createMessage = useMutation(
    rpcClient.workspace.message.create.mutationOptions(),
  );
  // What was marked in files and moved into this thread's composer goes
  // with its next message, as pills there.
  const groupAsks = useComposerAsks({ kind: "thread", sessionId });
  const { remove: removeAsks } = useStagedAskActions();

  // Reading the thread is what clears its count, so it is marked read on
  // arrival and again as each reply finishes while it is on screen. The pane
  // beside the tabs does not clear it on its own.
  const markSeen = useMutation(
    rpcClient.workspace.orchestrator.threads.seen.mutationOptions(),
  );
  const newestSettledMessageId = thread?.newestSettledMessageId;
  useEffect(() => {
    if (!isUp) {
      return;
    }
    markSeen.mutate({ sessionId });
    // The mutation is stable; re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [isUp, sessionId, newestSettledMessageId]);

  if (!task.data || !state.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }
  const modelURI = state.data.selectedModelURI ?? defaultModelURI;
  const attachedFolders = state.data.attachedFolders ?? {};
  // Into this thread's own group, shown: an open from a thread's chat is the
  // thread's whatever the window has up at that moment, and never a silent
  // nothing because the group on screen was another's.
  // A new-tab gesture over any of it asks for a tab of the window's own.
  const into = { group: sessionId, ownTab: true, show: true };
  const intoOr = (options?: { newTab?: boolean }) =>
    options?.newTab ? { newTab: true } : into;
  return (
    // The thread is the drop region, so a file let go anywhere over it lands
    // in the reply, and the pane beside it stays outside.
    <FileDropRegion className="flex h-full min-h-0 flex-col">
      {/* The thread stands over its tabs, so what a reply hands over opens
          as a tab under it rather than in place of one: the openers all say
          so, and a line a card asks the conversation lands in this thread. */}
      <div className="min-h-0 flex-1">
        <OrchestratorContext
          value={{
            ...orchestrator,
            ask: (prompt) => {
              if (!modelURI) {
                return;
              }
              createMessage.mutate({
                id: taskId,
                modelURI,
                prompt,
                sessionId,
              });
            },
            openPage: (url, options) => {
              orchestrator.openPage(url, intoOr(options));
            },
            openScreen: (href, options) => {
              orchestrator.openScreen(href, intoOr(options));
            },
            sessionId,
          }}
        >
          <FileOpenContext
            value={(path, options) => {
              openFile?.(path, intoOr(options));
            }}
          >
            <PageOpenContext
              value={(url, options) => {
                orchestrator.openPage(url, intoOr(options));
              }}
            >
              <TaskSessionProvider sessionId={sessionId} taskId={taskId}>
                <TaskChat
                  alwaysSubmittable
                  asks={
                    groupAsks.length === 0
                      ? undefined
                      : {
                          pills: <AskPills asks={groupAsks} />,
                          take: () => {
                            const part = asksPart(groupAsks, attachedFolders);
                            const ids = groupAsks.map((ask) => ask.id);
                            return part
                              ? {
                                  done: () => {
                                    removeAsks(ids);
                                  },
                                  part,
                                }
                              : undefined;
                          },
                        }
                  }
                  // What the thread is working on, over the composer: a
                  // task pressed opens beside the thread, in the pane.
                  beforeComposer={
                    <ThreadWork
                      onOpen={(id) => {
                        orchestrator.openScreen(
                          `/orchestrator/tasks/${id}`,
                          into,
                        );
                      }}
                      tasks={thread?.runningTasks ?? []}
                    />
                  }
                  composerLead={composerLead}
                  composerPlaceholder="Talk to Instrument"
                  // A key of the thread's own: the task's stored draft is the
                  // top-level field's, and a reply typed here is not that.
                  // Kept past this screen's unmount, so the row in the inbox
                  // can say the thread holds a draft while it does.
                  draftKey={{ scope: "thread", sessionId }}
                  navigateOnSend={false}
                  presentation="orchestrator"
                  promptDraft={state.data.promptDraft ?? ""}
                  selectedModelURI={modelURI}
                  selectedSessionId={sessionId}
                  sendContext={sendContext}
                  sentPrompt={sentPrompt}
                  task={task.data}
                  transcriptTrailing={
                    isWorkingElsewhere ? <WorkingRow /> : null
                  }
                />
              </TaskSessionProvider>
            </PageOpenContext>
          </FileOpenContext>
        </OrchestratorContext>
      </div>
    </FileDropRegion>
  );
}
