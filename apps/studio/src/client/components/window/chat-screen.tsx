import { FileDropRegion } from "@/client/components/file-drop-region";
import { FileOpenContext } from "@/client/components/file-open-context";
import { PageOpenContext } from "@/client/components/page-open-context";
import { TaskChat } from "@/client/components/task/chat";
import { Button } from "@/client/components/ui/button";
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
import { type ReactNode, useContext, useEffect, useState } from "react";

import { AskPills } from "./ask-pills";
import { chatListOptions } from "./chat-list-query";
import { ChatWork } from "./chat-work";
import { useWindow, WindowContext } from "./context";
import { asksPart, useComposerAsks, useStagedAskActions } from "./staged-asks";
import { WorkingRow } from "./working-row";

/**
 * How long a chat with no record is waited for before it is called gone: a
 * new chat's session is on screen before its first send makes the record, so
 * a missing one is only believed once it has stayed missing, re-asked each
 * interval, with nothing on its way to make it.
 */
const MISSING_GRACE_MS = 5000;
const MISSING_RECHECK_MS = 1000;

interface ChatScreenProps {
  /** Drawn at the head of the composer: what goes with a message besides its words. */
  composerLead?: ReactNode;
  /** Whether this is the chat on screen: only that one marks itself read or takes the caret. */
  isUp: boolean;
  /** Puts away a chat no record holds any more, the way deleting one does. */
  onGone: () => void;
  sendContext: () => Promise<
    SessionMessageDataPart.ViewContextDataPart | undefined
  >;
  /** The words that open the chat, while the message they make is on its way. */
  sentPrompt?: string;
  sessionId: StoreId.Session;
}

/**
 * One chat's conversation: its transcript, opening at the end, and a
 * composer that replies in it. Nothing above the transcript: the row over
 * it names the chat, and the top of the scroll is the ask itself. A
 * chat keeps its transcript in a record of its own, named for what it is
 * about, so its record is asked for by the chat's session first.
 */
export function ChatScreen(props: ChatScreenProps) {
  const chat = useQuery(
    rpcClient.workspace.chats.of.queryOptions({
      input: { sessionId: props.sessionId },
      // A chat keeps its record for as long as it exists; a chat with none
      // yet is asked again, since its first send may still be making it.
      refetchInterval: (query) =>
        query.state.data?.taskId === null ? MISSING_RECHECK_MS : false,
      staleTime: (query) =>
        query.state.data?.taskId ? Number.POSITIVE_INFINITY : 0,
    }),
  );
  const taskId = chat.data?.taskId;
  const isGone = useStaysMissing(
    chat.data !== undefined && !taskId && props.sentPrompt === undefined,
  );
  if (!taskId) {
    return isGone ? (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>This chat is not here any more.</p>
        <Button onClick={props.onGone} size="sm" variant="outline">
          Close it
        </Button>
      </div>
    ) : (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Spinner className="size-5" />
      </div>
    );
  }
  return <ChatScreenOfRecord {...props} taskId={taskId} />;
}

function ChatScreenOfRecord({
  composerLead,
  isUp,
  sendContext,
  sentPrompt,
  sessionId,
  taskId,
}: ChatScreenProps & { taskId: TaskId }) {
  const appWindow = useWindow();
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
  // The chat as the list beside the tabs knows it, for the newest reply
  // that has landed, which is what marks it read below.
  const chats = useQuery(chatListOptions());
  const chat = chats.data?.find((entry) => entry.id === sessionId);
  // While the chat's own agent composes, the transcript shows the typing
  // dots; the chat is otherwise at work when a task filed from it is, and
  // that is said at the transcript's tail too. Read from the tasks filed
  // from it rather than from the chat's state, which folds its own agent
  // in: the state is the list's, a re-read behind the actor the dots follow,
  // so at a turn's end it still says working for a moment after the dots
  // have gone, and the tail would say so in their place.
  const { isAgentRunning } = useAgentSessionStatus({ id: taskId, sessionId });
  const isWorkingElsewhere =
    chat?.runningTasks.some((running) => !running.waiting) === true &&
    !isAgentRunning;
  const [defaultModelURI] = useDefaultModelURI();
  const openFile = useContext(FileOpenContext);
  const createMessage = useMutation(
    rpcClient.workspace.message.create.mutationOptions(),
  );
  // What was marked in files and moved into this chat's composer goes
  // with its next message, as pills there.
  const groupAsks = useComposerAsks({ kind: "chat", sessionId });
  const { remove: removeAsks } = useStagedAskActions();

  // Reading the chat is what clears its count, so it is marked read on
  // arrival and again as each reply finishes while it is on screen. The pane
  // beside the tabs does not clear it on its own.
  const markSeen = useMutation(
    rpcClient.workspace.chats.seen.mutationOptions(),
  );
  const newestSettledMessageId = chat?.newestSettledMessageId;
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
  // Into this chat's own group, shown: an open from a chat's transcript is the
  // chat's whatever the window has up at that moment, and never a silent
  // nothing because the group on screen was another's.
  // A new-tab gesture over any of it asks for a tab of the window's own.
  const into = { group: sessionId, ownTab: true, show: true };
  const intoOr = (options?: { newTab?: boolean }) =>
    options?.newTab ? { newTab: true } : into;
  return (
    // The chat is the drop region, so a file let go anywhere over it lands
    // in the reply, and the pane beside it stays outside.
    <FileDropRegion className="flex h-full min-h-0 flex-col">
      {/* The chat stands over its tabs, so what a reply hands over opens
          as a tab under it rather than in place of one: the openers all say
          so, and a line a card asks the conversation lands in this chat. */}
      <div className="min-h-0 flex-1">
        <WindowContext
          value={{
            ...appWindow,
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
              appWindow.openPage(url, intoOr(options));
            },
            openScreen: (href, options) => {
              appWindow.openScreen(href, intoOr(options));
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
                appWindow.openPage(url, intoOr(options));
              }}
            >
              <TaskSessionProvider sessionId={sessionId} taskId={taskId}>
                <TaskChat
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
                  // What the chat is working on, over the composer: a
                  // task pressed opens beside the chat, in the pane.
                  beforeComposer={
                    <ChatWork
                      onOpen={(id) => {
                        appWindow.openScreen(`/tasks/${id}`, into);
                      }}
                      tasks={chat?.runningTasks ?? []}
                    />
                  }
                  composerLead={composerLead}
                  composerPlaceholder="Talk to Instrument"
                  // A key of the chat's own: the task's stored draft is the
                  // top-level field's, and a reply typed here is not that.
                  // Kept past this screen's unmount, so the row in the inbox
                  // can say the chat holds a draft while it does.
                  draftKey={{ scope: "chat", sessionId }}
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
        </WindowContext>
      </div>
    </FileDropRegion>
  );
}

/**
 * Whether a chat has had no record for the whole grace, with nothing on its
 * way to make one. A chat whose record was there and then went is gone at
 * once: the grace is for one still being made.
 */
function useStaysMissing(missing: boolean): boolean {
  const [isGone, setIsGone] = useState(false);
  useEffect(() => {
    if (!missing) {
      return;
    }
    const timer = setTimeout(() => {
      setIsGone(true);
    }, MISSING_GRACE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [missing]);
  return missing && isGone;
}
