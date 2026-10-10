import { FileDropRegion } from "@/client/components/file-drop-region";
import { FileOpenContext } from "@/client/components/file-open-context";
import { PageOpenContext } from "@/client/components/page-open-context";
import { TaskChat } from "@/client/components/task/chat";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { TaskSessionProvider } from "@/client/hooks/use-task-session";
import { createMessageOptions } from "@/client/lib/message-sends";
import { rpcClient } from "@/client/rpc/client";
import {
  type ChatId,
  type SessionMessageDataPart,
  type StoreId,
} from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useContext, useEffect, useState } from "react";

import { AskPills } from "./ask-pills";
import { chatListOptions } from "./chat-list-query";
import { type OpenOptions, useWindow, WindowContext } from "./context";
import { asksPart, useComposerAsks, useStagedAskActions } from "./staged-asks";
import { useReadOnView } from "./use-read-on-view";

/**
 * How long a chat with no session is waited for before it is called gone: a
 * chat is only believed missing once it has stayed missing, re-asked each
 * interval, with nothing on its way to make it.
 */
const MISSING_GRACE_MS = 5000;
const MISSING_RECHECK_MS = 1000;

interface ChatScreenProps {
  chatId: ChatId;
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
  /** What the chat holds, as a row of tiles over its composer. */
  tiles?: ReactNode;
}

/**
 * One chat's conversation: its transcript, opening at the end, and a
 * composer that replies in it. Nothing above the transcript: the row over
 * it names the chat, and the top of the scroll is the ask itself. The chat's
 * transcript is in its session, which is asked for by the chat's id first.
 */
export function ChatScreen(props: ChatScreenProps) {
  const chat = useQuery(
    rpcClient.workspace.chats.session.queryOptions({
      input: { id: props.chatId },
      // A chat keeps its session for as long as it exists; a chat with none
      // is asked again, since the record that holds it may be on its way.
      refetchInterval: (query) =>
        query.state.data?.sessionId === null ? MISSING_RECHECK_MS : false,
      staleTime: (query) =>
        query.state.data?.sessionId ? Number.POSITIVE_INFINITY : 0,
    }),
  );
  const sessionId = chat.data?.sessionId;
  const isGone = useStaysMissing(
    chat.data !== undefined && !sessionId && props.sentPrompt === undefined,
  );
  if (!sessionId) {
    return isGone ? (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>This chat no longer exists.</p>
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
  return <ChatScreenOfRecord {...props} sessionId={sessionId} />;
}

function ChatScreenOfRecord({
  chatId,
  composerLead,
  isUp,
  sendContext,
  sentPrompt,
  sessionId,
  tiles,
}: ChatScreenProps & { sessionId: StoreId.Session }) {
  const appWindow = useWindow();
  const info = useQuery(
    rpcClient.workspace.chats.live.info.experimental_liveOptions({
      input: { id: chatId },
    }),
  );
  const folders = useQuery(
    rpcClient.workspace.chats.folders.get.queryOptions({
      input: { id: chatId },
    }),
  );
  // The chat as the list beside the tabs knows it, for the newest reply
  // that has landed, which is what marks it read below.
  const chats = useQuery(chatListOptions());
  const chat = chats.data?.find((entry) => entry.id === chatId);
  const [defaultModelURI] = useDefaultModelURI();
  const openFile = useContext(FileOpenContext);
  const createMessage = useMutation(createMessageOptions());
  // What was marked in files and moved into this chat's composer goes
  // with its next message, as pills there.
  const groupAsks = useComposerAsks({ chatId, kind: "chat" });
  const { remove: removeAsks } = useStagedAskActions();

  // Looking at the chat is what takes its unread mark off. The pane beside
  // the tabs does not clear it on its own.
  useReadOnView({ chat, chatId, isUp });

  const loadError = info.error ?? folders.error;
  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Alert className="max-w-md" variant="warning">
          <AlertDescription className="flex flex-col gap-4">
            <div className="font-semibold">This chat couldn’t open</div>
            <div className="text-sm">
              {loadError.message || "Something went wrong reading it."}
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  void info.refetch();
                  void folders.refetch();
                }}
              >
                Try again
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  if (!info.data || !folders.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }
  const modelURI = info.data.modelURI ?? defaultModelURI;
  const reach = folders.data;
  // Into this chat's own group, shown: an open from a chat's transcript is the
  // chat's whatever the window has up at that moment, and never a silent
  // nothing because the group on screen was another's.
  // A new-tab gesture over any of it asks for a tab of the window's own.
  const into = { group: chatId, ownTab: true, show: true };
  const intoOr = (options?: OpenOptions) =>
    options?.newTab ? { behind: options.behind, newTab: true } : into;
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
                id: chatId,
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
            chatId,
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
              <TaskSessionProvider sessionId={sessionId} chatId={chatId}>
                <TaskChat
                  asks={
                    groupAsks.length === 0
                      ? undefined
                      : {
                          pills: <AskPills asks={groupAsks} />,
                          take: () => {
                            const part = asksPart(groupAsks, reach);
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
                  // What the chat holds, over the composer.
                  beforeComposer={tiles}
                  composerLead={composerLead}
                  composerPlaceholder="Talk to Instrument"
                  // Kept past this screen's unmount, so the row in the inbox
                  // can say the chat holds a draft while it does.
                  draftKey={{ chatId, scope: "chat" }}
                  selectedModelURI={modelURI}
                  selectedSessionId={sessionId}
                  sendContext={sendContext}
                  sentPrompt={sentPrompt}
                  chatInfo={info.data}
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
