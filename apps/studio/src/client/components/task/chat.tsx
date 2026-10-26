import {
  type PromptDraftKey,
  promptDraftRefAtom,
} from "@/client/atoms/prompt-value";
import {
  beginReplySendAtom,
  chatBoxesAtom,
  makeReplyAtom,
  replyInBox,
  settleReplySendAtom,
  swapInReplyAtom,
  takeUpBoxAtom,
} from "@/client/drafts/chat-box";
import { draftsAtom, updateDraftAtom } from "@/client/drafts/store";
import { APPS_HREF, BROWSER_HREF } from "@/client/atoms/window";
import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { useAgentSessionStatus } from "@/client/hooks/use-agent-session-status";
import { useContinueSession } from "@/client/hooks/use-continue-session";
import { useTabDeveloperMode } from "@/client/hooks/use-developer-mode";
import { useTurnSettleWindow } from "@/client/hooks/use-turn-settle-window";
import {
  itemsOf,
  useDraftStaging,
  useFolderItems,
} from "@/client/components/draft-staging";
import { createMessageOptions } from "@/client/lib/message-sends";
import { cn, osConventions } from "@/client/lib/utils";
import { PermissionAsksFoot } from "@/client/components/permission-asks";
import { rpcClient } from "@/client/rpc/client";
import { outputFolderHref, useOutputFolder } from "@/client/lib/output-folder";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import { APP_NAME } from "@instrument-org/shared";
import {
  modelChangeSincePreviousTurn,
  type SessionMessageDataPart,
  type SessionMessagePart,
  StoreId,
  type ChatInfo,
} from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtomValue, useSetAtom } from "jotai";
import {
  type ComponentProps,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "@/client/lib/toast";

import { useChatNote } from "../billing/chat-note";
import { ChatBubbles } from "../chat-bubbles";
import { TypingRow } from "../chat-stream";
import { ComposerDraftContext } from "../composer-draft-context";
import { ModelChangeNote } from "../model-change-note";
import { PromptInput, type PromptInputRef } from "../prompt-input";
import { RepliesWaiting } from "../replies-waiting";
import { ReplyContext } from "../reply-context";
import { ComposerReplyQuote } from "../reply-quote";
import {
  TRANSCRIPT_PREVIOUS_TURN_PEEK,
  TranscriptScrollContext,
} from "../transcript-scroll-context";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
  useMessageScrollerScrollable,
} from "../ui/message-scroller";
import { Spinner } from "../ui/spinner";
import { UserMessage } from "../user-message";
import { chatListOptions } from "../window/chat-list-query";
import { WindowContext } from "../window/context";
import {
  type PendingPrompt,
  pendingPrompt,
  unsettledPrompts,
} from "./pending-prompts";
import { bubbleFeedOptions } from "./bubble-feed-query";
import { ScrollToEndBridge } from "./scroll-to-end-bridge";

// How long a submitted prompt follows the transcript on its own before the
// session has to justify it. Long enough to cover starting a turn, short enough
// that a submit that never becomes one hands the idle transcript back.
const SUBMIT_FOLLOW_TIMEOUT_MS = 5000;

/**
 * A chat's conversation: its transcript and its composer.
 *
 * Every prompt is sent the moment it is submitted, whether or not a turn is
 * running: the conversation never takes turns with the user, since its
 * session queues what arrives mid-turn and runs it the moment the turn ends.
 * For the same reason the composer has no stop: the chat's is on the line
 * under its title.
 */
export function ChatConversation({
  asks,
  beforeComposer,
  composerLead,
  draftKey,
  selectedModelURI: initialSelectedModelURI,
  selectedSessionId,
  sendContext,
  sentPrompt,
  chatInfo,
}: {
  /**
   * Places marked in files that go with the next message: drawn as pills in
   * the composer's attachments row, enough to send with no words, and taken
   * at the moment of sending. `take` hands over what goes and a way to let
   * those asks go once the message is written.
   */
  asks?: {
    pills: ReactNode;
    take: () =>
      | undefined
      | { done: () => void; part: SessionMessageDataPart.AsksDataPart };
  };
  /** Drawn between the transcript and the composer, outside the scroll: a standing row the transcript's end does not move for. */
  beforeComposer?: ReactNode;
  /** A chip at the head of the composer's box: what goes with the prompt besides its words. */
  composerLead?: ReactNode;
  /** Which draft the composer edits, and the one "Add to chat" in the transcript writes to. */
  draftKey: PromptDraftKey;
  selectedModelURI?: AIGatewayModelURI.Type;
  selectedSessionId: StoreId.Session;
  /**
   * What the surface around this chat has on screen when a prompt is sent, so
   * "this folder" means the folder in view. Read at send time, since what is on
   * screen when the prompt is typed is what the words refer to.
   */
  sendContext: () => Promise<
    SessionMessageDataPart.ViewContextDataPart | undefined
  >;
  /**
   * The words that open this session, sent a moment ago and not yet stored:
   * drawn as its first message, with the conversation at work under it,
   * until the stored one arrives, so a session shown from the press never
   * reads as empty on the way.
   */
  sentPrompt?: string;
  chatInfo: ChatInfo;
}) {
  const appWindow = useContext(WindowContext);
  const id = chatInfo.id;

  const promptInputRef = useRef<PromptInputRef>(null);
  const [composerDictating, setComposerDictating] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrollToEndSignal, setScrollToEndSignal] = useState(0);
  const [isFollowingSubmit, setIsFollowingSubmit] = useState(false);

  const createMessage = useMutation(
    createMessageOptions({
      onError: (error) => {
        toast.error("Couldn't send your message", { cause: error });
      },
    }),
  );
  const runTurn = useMutation(
    rpcClient.workspace.session.run.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't try again", { cause: error });
      },
    }),
  );

  const [selectedModelURI, setSelectedModelURI] = useState<
    AIGatewayModelURI.Type | undefined
  >(initialSelectedModelURI);
  const [lastInitialSelectedModelURI, setLastInitialSelectedModelURI] =
    useState(initialSelectedModelURI);

  if (initialSelectedModelURI !== lastInitialSelectedModelURI) {
    setLastInitialSelectedModelURI(initialSelectedModelURI);
    setSelectedModelURI(initialSelectedModelURI);
  }

  // The message the next send answers. A reply belongs to the conversation it
  // was started in, so another one coming on screen lets it go.
  const [replyTo, setReplyTo] = useState<
    SessionMessageDataPart.ReplyDataPart | undefined
  >();
  const [replySessionId, setReplySessionId] = useState(selectedSessionId);
  if (selectedSessionId !== replySessionId) {
    setReplySessionId(selectedSessionId);
    setReplyTo(undefined);
  }

  const messagesQuery = useQuery(
    bubbleFeedOptions({ id, sessionId: selectedSessionId }),
  );

  const messages = messagesQuery.data?.messages ?? [];
  // What was sent and is not stored yet, drawn after what is: see PendingPrompt.
  const [pending, setPending] = useState<PendingPrompt[]>([]);
  const unsettled = unsettledPrompts(pending, messages);
  if (unsettled.length !== pending.length) {
    setPending(unsettled);
  }
  // A model picked and not sent yet, said now the way the send will say it,
  // so the choice shows in the transcript at once: from the plus menu it is
  // otherwise gone the moment the menu closes. The send stores the choice,
  // the two agree again and this gives way to the note the turn records.
  const { data: modelsData } = useQuery(
    rpcClient.gateway.models.live.list.experimental_liveOptions(),
  );
  const pickedModel =
    selectedModelURI !== initialSelectedModelURI
      ? modelsData?.models.find((model) => model.uri === selectedModelURI)
      : undefined;
  const pendingModelChange = pickedModel
    ? modelChangeSincePreviousTurn({ messages, model: pickedModel })
    : undefined;
  const shownMessages = [
    ...messages,
    ...unsettled
      .filter((entry) => entry.message.metadata.sessionId === selectedSessionId)
      .map((entry) => entry.message),
  ];
  /** Draws the prompt at once, and hands back how to take it away again should the send fail. */
  const showPending = (
    prompt: string,
    reply?: SessionMessageDataPart.ReplyDataPart,
  ) => {
    const entry = pendingPrompt({
      messages,
      prompt,
      reply,
      sessionId: selectedSessionId,
    });
    if (entry) {
      setPending((current) => [...current, entry]);
    }
    return () => {
      setPending((current) => current.filter((other) => other !== entry));
    };
  };
  const messageError = messagesQuery.error;
  const isLoadingMessages = messagesQuery.isLoading;
  const refetch = messagesQuery.refetch;

  const isDeveloperMode = useTabDeveloperMode();

  const { isAgentAlive, isAgentRunning } = useAgentSessionStatus({
    id,
    sessionId: selectedSessionId,
  });

  // The live session takes over following the transcript as soon as it reports
  // itself alive, so the submit's own reason to follow ends there.
  if (isFollowingSubmit && isAgentAlive) {
    setIsFollowingSubmit(false);
  }

  const isSettlingTurn = useTurnSettleWindow(isAgentAlive);

  // A question the chat is stopped on, which a reader scrolled back from the
  // end is told about by the scroll button rather than taken down to.
  const { data: isWaiting = false } = useQuery({
    ...chatListOptions(),
    select: (chats) =>
      chats.find((chat) => chat.id === id)?.state === "waiting",
  });

  // A submit that never becomes a turn would otherwise leave an idle transcript
  // following forever.
  useEffect(() => {
    if (!isFollowingSubmit) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setIsFollowingSubmit(false);
    }, SUBMIT_FOLLOW_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [isFollowingSubmit]);

  const { handleContinue } = useContinueSession({
    id,
    modelURI: selectedModelURI,
    sessionId: selectedSessionId,
  });

  const handleRetry = (prompt: string) => {
    if (!selectedModelURI) {
      toast.error("Couldn't try again", {
        description: "Choose a model first.",
      });
      return;
    }
    createMessage.mutate({
      id,
      modelURI: selectedModelURI,
      prompt,
      sessionId: selectedSessionId,
    });
  };

  // The failed turn again, with nothing said on the user's behalf: the agent
  // runs over the session as it stands and answers the request already in it.
  const handleRunAgain = (modelURI = selectedModelURI) => {
    if (!modelURI) {
      toast.error("Couldn't try again", {
        description: "Choose a model first.",
      });
      return;
    }
    runTurn.mutate({
      id,
      modelURI,
      sessionId: selectedSessionId,
    });
  };

  const note = useChatNote({
    chatId: id,
    isAgentRunning,
    messages,
    modelURI: selectedModelURI,
    onContinue: handleRunAgain,
  });

  const isActiveTab = useIsActiveTab();
  const outputFolder = useOutputFolder();
  const promptEditor = useAtomValue(promptDraftRefAtom(draftKey));
  // The reply the box is writing into, where it is writing into a chat's:
  // the message says which draft it came from, and the draft goes once that
  // message is written.
  const drafts = useAtomValue(draftsAtom);
  const boxes = useAtomValue(chatBoxesAtom);
  const makeReply = useSetAtom(makeReplyAtom);
  const updateDraft = useSetAtom(updateDraftAtom);
  const beginReplySend = useSetAtom(beginReplySendAtom);
  const settleReplySend = useSetAtom(settleReplySendAtom);
  const swapInReplyDraft = useSetAtom(swapInReplyAtom);
  const takeUpBox = useSetAtom(takeUpBoxAtom);
  const boxChat = draftKey.scope === "chat" ? draftKey.chatId : undefined;
  // The box writes into the reply it first shows, whatever arrives after.
  useLayoutEffect(() => {
    if (boxChat !== undefined) {
      takeUpBox(boxChat);
    }
  }, [boxChat, takeUpBox]);
  const replyDraft =
    draftKey.scope === "chat"
      ? replyInBox(drafts, boxes, draftKey.chatId)
      : undefined;
  // What was pasted into a reply goes into that draft's own folder, so it
  // outlasts a relaunch and is the one copy the chat is sent.
  const staging = useDraftStaging({
    draftFor: (make) => {
      if (draftKey.scope !== "chat") {
        return undefined;
      }
      if (replyDraft) {
        return replyDraft.id;
      }
      // A paste can arrive before any words have settled into a reply, and
      // it is on disk the moment it arrives, so the reply is made for it.
      return make ? makeReply({ chatId: draftKey.chatId }) : undefined;
    },
    onChange: (draftId, update) => {
      updateDraft({ id: draftId, update });
    },
  });
  useFolderItems({
    draft: replyDraft,
    input: promptInputRef,
    staging,
  });
  /**
   * Puts one of the chat's other waiting replies in the box: the box writes
   * into it from here, and is given its words and what was attached to it.
   * Not while the box is dictating, whose words belong to the reply in it.
   */
  const swapInReply = (draftId: string) => {
    if (draftKey.scope !== "chat" || composerDictating) {
      return;
    }
    const picked = swapInReplyDraft({
      chatId: draftKey.chatId,
      draftId,
      words: promptInputRef.current?.snapshot().prompt ?? "",
    });
    if (!picked) {
      return;
    }
    promptInputRef.current?.swapIn({
      items: itemsOf(picked),
      prompt: picked.words,
    });
    promptEditor?.focus();
    promptEditor?.moveCaretToEnd();
  };
  // What the chat's reply draft holds besides its words is drawn back into
  // the box as the chat opens: its words come from the draft on their own,
  // and what was pasted into it would otherwise be in the draft's folder
  // with nothing on screen saying so.
  const drawnFor = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (draftKey.scope !== "chat" || drawnFor.current === draftKey.chatId) {
      return;
    }
    drawnFor.current = draftKey.chatId;
    const items = itemsOf(replyDraft);
    if (items.length > 0) {
      promptInputRef.current?.restoreItems(items);
    }
    // Every render until the box is there to draw into, and once per chat.
  });
  // A chat coming on screen is a place to reply from, so the caret lands
  // in the field as it opens.
  useLayoutEffect(() => {
    if (!isActiveTab) {
      return;
    }
    promptEditor?.focus();
    promptEditor?.moveCaretToEnd();
  }, [isActiveTab, selectedSessionId, promptEditor]);

  // A chat's plus opens things beside the chat: the web's starting view and
  // the computer each as a tab of their own, and Apps where one is connected.
  const places = appWindow
    ? {
        computerName: osConventions().computer,
        onOpenApps: () => {
          appWindow.openScreen(APPS_HREF, { ownTab: true });
        },
        onOpenComputer: () => {
          appWindow.openScreen(outputFolderHref(outputFolder), {
            ownTab: true,
          });
        },
        onOpenWeb: () => {
          appWindow.openScreen(BROWSER_HREF, { ownTab: true });
        },
      }
    : undefined;

  const startReply = (reply: SessionMessageDataPart.ReplyDataPart) => {
    setReplyTo(reply);
    promptEditor?.focus();
  };

  const promptInput = (
    <PromptInput
      // Beside the work, the row stays open: a tab switch moves the caret, and
      // a row that folded and unfolded with it would animate on every switch.
      alwaysOpen
      attachmentsLead={asks?.pills}
      autoFocus
      className="relative z-10"
      draftKey={draftKey}
      hasAttachmentsLead={asks?.pills != null}
      id={id}
      isLoading={createMessage.isPending}
      lead={composerLead}
      modelURI={selectedModelURI}
      note={note}
      onDictatingChange={setComposerDictating}
      onItemRemoved={draftKey.scope === "chat" ? staging.removeItem : undefined}
      onItemsChange={draftKey.scope === "chat" ? staging.keepItems : undefined}
      onModelChange={setSelectedModelURI}
      onSubmit={(sending) => {
        const { files, folders, modelURI, prompt } = staging.asStaged(sending);
        // The composer empties on submit rather than on the reply, so a send the
        // workspace rejects has to hand the prompt and its attachments back --
        // nothing else holds them, and a toast the user cannot act on is worse
        // than no send at all.
        const draft = promptInputRef.current?.snapshot();
        // The reply in the box is claimed for the send: from here it is the
        // message on its way rather than a reply waiting, and what is typed
        // while it is in flight starts a reply of its own.
        const outgoing =
          draftKey.scope === "chat"
            ? beginReplySend({ chatId: draftKey.chatId, words: prompt })
            : undefined;
        const settle = (ok: boolean) => {
          if (outgoing && draftKey.scope === "chat") {
            settleReplySend({
              chatId: draftKey.chatId,
              draftId: outgoing.draftId,
              ok,
            });
          }
        };
        promptInputRef.current?.clear();
        // Submitting is a request to watch what happens next, so a reader who
        // had scrolled back returns to the live edge and follows it again. Both
        // halves are needed: the scroller arms follow-bottom from autoScroll at
        // the moment it is asked to scroll, so a scroll that runs while the
        // session is still starting up would only land at the end.
        setIsFollowingSubmit(true);
        setScrollToEndSignal((signal) => signal + 1);
        const taken = asks?.take();
        const reply = replyTo;
        setReplyTo(undefined);
        // Drawn before what goes with it is read: reading a page can take a
        // moment, and the send is only stored once that is in.
        const dropPending = showPending(prompt, reply);
        // The message names the draft it came from, so the draft names the
        // chat on disk before the message is written: a launch after a crash
        // finds the message by the chat its draft names.
        void Promise.all([sendContext(), outgoing?.claimed]).then(
          ([viewing]) => {
            createMessage.mutate(
              {
                ...(taken ? { asks: taken.part } : {}),
                ...(reply ? { replyTo: reply } : {}),
                files,
                folders,
                ...(outgoing ? { fromDraft: outgoing.draftId } : {}),
                id,
                modelURI,
                prompt,
                sessionId: selectedSessionId,
                viewing,
              },
              {
                onError: () => {
                  dropPending();
                  settle(false);
                  if (draft) {
                    promptInputRef.current?.restore(draft);
                  }
                  setReplyTo(reply);
                },
                onSuccess: () => {
                  taken?.done();
                  settle(true);
                },
              },
            );
          },
          (error: unknown) => {
            dropPending();
            settle(false);
            if (draft) {
              promptInputRef.current?.restore(draft);
            }
            setReplyTo(reply);
            toast.error("Couldn't send your message", { cause: error });
          },
        );
      }}
      placeholder={`Talk to ${APP_NAME}`}
      places={places}
      ref={promptInputRef}
      selectedSessionId={selectedSessionId}
      variant="pill"
    />
  );

  // The composer is a plain flex sibling below the scroller: normal flow
  // reserves its height (no measuring), and the scroll viewport holds only the
  // transcript, so the scroller's "at the bottom" math stays exact. A soft
  // gradient overlay at the scroll frame's bottom edge eases the transcript into
  // the composer; pb-8 keeps the last turn's text clear of the fade band.
  //
  // autoScroll while the session is alive, while a just-submitted prompt is
  // waiting for one, and through the moment a turn takes to settle: past that,
  // on a transcript nothing is arriving into, follow-bottom has only the
  // reader's own clicks left to read as output. What it would misread there is
  // narrowed by `TranscriptScrollContext`, which the controls that open
  // something call first -- so the window can stay open long enough for the end
  // of a turn to land. Alive rather than running, so a turn paused for approval
  // still follows.
  return (
    <ComposerDraftContext value={draftKey}>
      <ReplyContext value={startReply}>
        <MessageScrollerProvider
          autoScroll={isAgentAlive || isFollowingSubmit || isSettlingTurn}
          defaultScrollPosition="end"
          key={selectedSessionId}
          scrollPreviousItemPeek={TRANSCRIPT_PREVIOUS_TURN_PEEK}
        >
          {/* The session is part of the signal: arriving in a conversation puts
        you at its live edge the way opening one does, and switching chats
        is arriving. Without it the transcript kept whatever offset the
        previous chat happened to leave behind. The messages landing is the
        other part: they are read after the conversation mounts, and the end
        of a spinner is not the end of the chat. */}
          <ScrollToEndBridge
            contentRef={contentRef}
            signal={`${selectedSessionId}:${isLoadingMessages ? "loading" : "loaded"}:${scrollToEndSignal}`}
          />
          <div className="flex h-full min-h-0 flex-col">
            <MessageScroller className="min-h-0 flex-1">
              {/* Named so a block inside a message can measure the pane rather
              than the column it sits in, and `--transcript-room` declared one
              level in, where `100cqi` resolves against that container. A wide
              Markdown table is the only reader today. */}
              <MessageScrollerViewport
                className="@container/transcript"
                data-transcript
              >
                <MessageScrollerContent
                  className="mx-auto w-full max-w-3xl gap-4 p-4 pb-8 [--transcript-room:100cqi]"
                  ref={contentRef}
                >
                  {sentPrompt !== undefined && messages.length === 0 ? (
                    <SentPrompt
                      sessionId={selectedSessionId}
                      text={sentPrompt}
                    />
                  ) : isLoadingMessages ? (
                    <div className="flex animate-in justify-center py-4 opacity-0 duration-150 fade-in-0 [animation-delay:500ms] [animation-fill-mode:forwards]">
                      <Spinner
                        className="size-4 text-muted-foreground"
                        delay={0}
                      />
                    </div>
                  ) : messageError ? (
                    <Alert className="mt-4" variant="warning">
                      <AlertDescription className="flex flex-col gap-4">
                        <div className="font-semibold">
                          Failed to load messages
                        </div>
                        <div className="text-sm">
                          {messageError.message || "Unknown error occurred"}
                        </div>
                        <div className="flex gap-2">
                          <Button onClick={() => refetch()}>Retry</Button>
                        </div>
                      </AlertDescription>
                    </Alert>
                  ) : !isAgentRunning && shownMessages.length === 0 ? (
                    <NoMessages />
                  ) : (
                    <TranscriptStream
                      awaitingReply={
                        isAgentAlive || shownMessages.length > messages.length
                      }
                      chatInfo={chatInfo}
                      drafting={messagesQuery.data?.drafting ?? false}
                      isAgentRunning={isAgentRunning || runTurn.isPending}
                      isDeveloperMode={isDeveloperMode}
                      messages={shownMessages}
                      onContinue={handleContinue}
                      onModelChange={(modelURI) => {
                        setSelectedModelURI(modelURI);
                        handleRunAgain(modelURI);
                      }}
                      onRetry={handleRetry}
                      onRunAgain={() => handleRunAgain()}
                    />
                  )}
                  {pendingModelChange && (
                    <ModelChangeNote data={pendingModelChange} />
                  )}
                </MessageScrollerContent>
              </MessageScrollerViewport>

              <TranscriptTopFade />

              {/* Fade the transcript into the composer with a background gradient
              rather than a viewport mask, so the scrollbar stays crisp. The
              right inset clears the scrollbar; the content column is centered
              and padded, so its text stays fully within the fade. */}
              <div className="pointer-events-none absolute right-3 bottom-0 left-0 h-6 bg-linear-to-t from-background to-transparent" />

              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-4">
                <MessageScrollerButton
                  busy={isAgentRunning}
                  className="pointer-events-auto"
                  waiting={isWaiting}
                />
              </div>
            </MessageScroller>

            {/* isolate: keep the prompt input's z-10 contained to the composer. */}
            <div className="isolate mx-auto w-full max-w-3xl px-3 pb-3">
              {/* Inside the column rather than above it, so it is exactly as wide
              as the composer it belongs to. */}
              {beforeComposer}
              <PermissionAsksFoot chatId={id} />
              {draftKey.scope === "chat" && (
                <RepliesWaiting
                  chatId={draftKey.chatId}
                  disabled={composerDictating}
                  onSwapIn={swapInReply}
                />
              )}
              {replyTo && (
                <ComposerReplyQuote
                  onDismiss={() => {
                    setReplyTo(undefined);
                  }}
                  reply={replyTo}
                />
              )}
              {promptInput}
            </div>
          </div>
        </MessageScrollerProvider>
      </ReplyContext>
    </ComposerDraftContext>
  );
}

function NoMessages() {
  return (
    <div className="mt-8 text-center text-muted-foreground/50">
      No messages yet
    </div>
  );
}

/**
 * The words just sent, as the transcript will draw them once they are
 * stored, with the conversation's dots under them.
 */
function SentPrompt({
  sessionId,
  text,
}: {
  sessionId: StoreId.Session;
  text: string;
}) {
  const [part] = useState(
    (): SessionMessagePart.TextPart => ({
      metadata: {
        createdAt: new Date(),
        id: StoreId.newPartId(),
        messageId: StoreId.newMessageId(),
        sessionId,
      },
      state: "done",
      text,
      type: "text",
    }),
  );
  return (
    <div className="flex flex-col gap-4">
      <UserMessage compact part={part} />
      <TypingRow />
    </div>
  );
}

// The conversation, wired to the scroller it is drawn in: what a bubble opens
// (a long table, a code block) hands following the end back through it.
function TranscriptStream(props: ComponentProps<typeof ChatBubbles>) {
  const { releaseAutoScroll } = useMessageScroller();

  return (
    <TranscriptScrollContext value={releaseAutoScroll}>
      <ChatBubbles {...props} />
    </TranscriptScrollContext>
  );
}

// The bottom fade's counterpart at the scroll frame's top edge, softening the
// transcript into the toolbar. Unlike the bottom, it only shows when there is
// content scrolled above: at rest the first turn should read at full strength.
function TranscriptTopFade() {
  const scrollable = useMessageScrollerScrollable();

  return (
    <div
      className={cn(
        "pointer-events-none absolute top-0 right-3 left-0 h-6 bg-linear-to-b from-background to-transparent transition-opacity duration-150",
        scrollable.start ? "opacity-100" : "opacity-0",
      )}
    />
  );
}
