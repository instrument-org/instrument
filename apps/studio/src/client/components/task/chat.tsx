import { featuresAtom } from "@/client/atoms/features";
import {
  promptDraftRefAtom,
  promptFocusSignalAtom,
  setPromptDraftAtom,
  useHydrateTaskDraft,
} from "@/client/atoms/prompt-value";
import { useIsActiveTab, useTabId } from "@/client/hooks/use-active-tab";
import { useAgentSessionStatus } from "@/client/hooks/use-agent-session-status";
import { useContinueSession } from "@/client/hooks/use-continue-session";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { usePromptQueue } from "@/client/hooks/use-prompt-queue";
import { useTurnSettleWindow } from "@/client/hooks/use-turn-settle-window";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import { APP_NAME } from "@instrument-org/shared";
import {
  type SessionMessage,
  type StoreId,
  type Task,
} from "@instrument-org/workspace/client";
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import {
  type ComponentProps,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { ChatStream } from "../chat-stream";
import { PromptInput, type PromptInputRef } from "../prompt-input";
import { TranscriptScrollContext } from "../transcript-scroll-context";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { type UserMessageEditSubmit } from "../user-message";
import { ChatZeroState } from "./chat-zero-state";
import { QueuedPrompts } from "./queued-prompts";
import { TutorialPromptCard } from "./tutorial-prompt-card";

// How long a submitted prompt follows the transcript on its own before the
// session has to justify it. Long enough to cover starting a turn, short enough
// that a submit that never becomes one hands the idle transcript back.
const SUBMIT_FOLLOW_TIMEOUT_MS = 5000;

// Where an anchored turn comes to rest, measured from the top of the viewport.
// Less than the primitive's default, because the transcript fades its own top
// 24px: the previous turn showing through the fade is the whole point of the
// band, and past that it is just a gap above the turn being read.
const TRANSCRIPT_PREVIOUS_TURN_PEEK = 40;

export function TaskChat({
  isReplayActive = false,
  onCancelReplay,
  promptDraft,
  selectedModelURI: initialSelectedModelURI,
  selectedSessionId,
  showTutorial,
  task,
}: {
  isReplayActive?: boolean;
  onCancelReplay?: () => void;
  promptDraft: string;
  selectedModelURI?: AIGatewayModelURI.Type;
  selectedSessionId?: StoreId.Session;
  showTutorial?: boolean;
  task: Task;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const id = task.id;

  // The route does not render until the task's state has loaded, so the stored
  // draft is in hand on the composer's very first render rather than arriving
  // after it.
  useHydrateTaskDraft(id, promptDraft);

  const promptInputRef = useRef<PromptInputRef>(null);
  const [scrollToEndSignal, setScrollToEndSignal] = useState(0);
  const [isFollowingSubmit, setIsFollowingSubmit] = useState(false);

  const createMessage = useMutation(
    rpcClient.workspace.message.create.mutationOptions({
      onError: (error) => {
        toast.error("Failed to create message", { description: error.message });
      },
    }),
  );
  const restartFromMessage = useMutation(
    rpcClient.workspace.message.restartFrom.mutationOptions({
      onError: (error) => {
        toast.error("Failed to restart from edit", {
          description: error.message,
        });
      },
    }),
  );
  const stopSessions = useMutation(
    rpcClient.workspace.session.stop.mutationOptions(),
  );
  const dismissTutorial = useMutation(
    rpcClient.workspace.task.state.set.mutationOptions({
      onError: (error) => {
        toast.error("Failed to dismiss tutorial prompt", {
          description: error.message,
        });
      },
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: rpcClient.workspace.task.state.get.queryOptions({
            input: { id },
          }).queryKey,
        });
      },
    }),
  );

  const [selectedModelURI, setSelectedModelURI] = useState<
    AIGatewayModelURI.Type | undefined
  >(initialSelectedModelURI);
  const [lastInitialSelectedModelURI, setLastInitialSelectedModelURI] =
    useState(initialSelectedModelURI);
  const [editingMessageId, setEditingMessageId] = useState<
    StoreId.Message | undefined
  >();
  const setPromptDraft = useSetAtom(setPromptDraftAtom);

  if (initialSelectedModelURI !== lastInitialSelectedModelURI) {
    setLastInitialSelectedModelURI(initialSelectedModelURI);
    setSelectedModelURI(initialSelectedModelURI);
  }

  const messagesQuery = useQuery(
    rpcClient.workspace.message.live.list.experimental_liveOptions({
      input: selectedSessionId
        ? {
            id,
            sessionId: selectedSessionId,
          }
        : skipToken,
      retry: 1,
    }),
  );

  const messages = messagesQuery.data ?? [];
  const messageError = messagesQuery.error;
  const isLoadingMessages = messagesQuery.isLoading;
  const refetch = messagesQuery.refetch;

  const isDeveloperMode = useDeveloperMode();

  const { isAgentAlive, isAgentRunning } = useAgentSessionStatus({
    id,
    isReplayActive,
    sessionId: selectedSessionId,
  });

  // The live session takes over following the transcript as soon as it reports
  // itself alive, so the submit's own reason to follow ends there.
  if (isFollowingSubmit && isAgentAlive) {
    setIsFollowingSubmit(false);
  }

  const isSettlingTurn = useTurnSettleWindow(isAgentAlive);

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
    if (!selectedSessionId) {
      // No retry UI is shown when no session is selected
      return;
    }
    if (!selectedModelURI) {
      toast.error("Failed to retry", { description: "No model selected" });
      return;
    }
    createMessage.mutate({
      id,
      modelURI: selectedModelURI,
      prompt,
      sessionId: selectedSessionId,
    });
  };

  const handleStartEdit = (message: SessionMessage.UserWithParts) => {
    const textPart = message.parts.find((part) => part.type === "text");
    setPromptDraft({
      key: { id: `edit:${message.id}`, scope: "transient" },
      update: textPart?.type === "text" ? textPart.text : "",
    });
    setEditingMessageId(message.id);
  };

  const handleCancelEdit = () => {
    setEditingMessageId(undefined);
  };

  const handleStartNewTask = () => {
    if (task.projectId) {
      void navigate({
        params: { id: task.projectId },
        to: "/projects/$id",
      });
    } else {
      void navigate({ to: "/new-tab" });
    }
  };

  const features = useAtomValue(featuresAtom);
  const isQueueEnabled = features.prompt_queue;
  const { clear, enqueue, queue, remove } = usePromptQueue({
    isAgentAlive,
    onDispatch: (queued) => {
      if (!selectedSessionId) {
        return;
      }
      createMessage.mutate({
        files: queued.files,
        folders: queued.folders,
        id,
        modelURI: queued.modelURI,
        prompt: queued.prompt,
        sessionId: selectedSessionId,
      });
    },
  });

  const handleSubmitEdit = (
    message: SessionMessage.UserWithParts,
    value: UserMessageEditSubmit,
  ) => {
    if (!selectedSessionId) {
      return;
    }
    // A restart replaces everything from this message forward, so a queued
    // follow-up would land on a transcript that no longer matches it.
    clear();
    restartFromMessage.mutate(
      {
        files: value.files,
        folders: value.folders,
        id,
        keepFilePaths: value.keepFilePaths,
        messageId: message.id,
        modelURI: value.modelURI,
        prompt: value.prompt,
        sessionId: selectedSessionId,
      },
      {
        onSuccess: () => {
          setEditingMessageId(undefined);
          setSelectedModelURI(value.modelURI);
          setIsFollowingSubmit(true);
          setScrollToEndSignal((signal) => signal + 1);
        },
      },
    );
  };

  const isActiveTab = useIsActiveTab();
  const focusSignal = useAtomValue(promptFocusSignalAtom(useTabId()));
  const draftKey = { scope: "task", taskId: id } as const;
  const promptEditor = useAtomValue(promptDraftRefAtom(draftKey));
  useLayoutEffect(() => {
    if (!isActiveTab || editingMessageId) {
      return;
    }
    promptEditor?.focus();
    promptEditor?.moveCaretToEnd();
  }, [
    isActiveTab,
    focusSignal,
    selectedSessionId,
    promptEditor,
    editingMessageId,
  ]);

  const [isTutorialDismissed, setIsTutorialDismissed] = useState(false);
  const [composerFolderCount, setComposerFolderCount] = useState(0);
  const isTutorialActive = showTutorial === true && !isTutorialDismissed;
  // The composer grows its own wrapper once a folder is attached, and two
  // nested ones read as a box in a box. The tutorial gives way for as long as
  // the folder is there and comes back if it is removed: nothing is written
  // away, so this is a fold rather than a dismissal.
  const isTutorialVisible = isTutorialActive && composerFolderCount === 0;

  const handleDismissTutorial = () => {
    setIsTutorialDismissed(true);
    dismissTutorial.mutate({
      id,
      state: {
        showTutorial: false,
      },
    });
  };

  const promptInput = (
    <PromptInput
      autoFocus={!editingMessageId}
      className="relative z-10"
      draftKey={draftKey}
      folderTrayPlacement="above"
      id={id}
      isLoading={createMessage.isPending}
      isStoppable={isAgentAlive}
      isSubmittable={isQueueEnabled ? true : !isAgentAlive}
      modelURI={selectedModelURI}
      onFocus={() => {
        // Focusing the follow-up composer is choosing it over an in-progress
        // edit, so leave edit mode rather than keep two composers live.
        if (editingMessageId) {
          handleCancelEdit();
        }
      }}
      onFolderCountChange={setComposerFolderCount}
      onModelChange={setSelectedModelURI}
      onStop={() => {
        if (isReplayActive && onCancelReplay) {
          onCancelReplay();
        } else {
          // Stop is a hard halt: drop pending follow-ups so the queue does not
          // auto-advance the moment the interrupted turn ends.
          clear();
          stopSessions.mutate({ id });
        }
      }}
      onSubmit={({ files, folders, modelURI, prompt }) => {
        // The composer empties on submit rather than on the reply, so a send the
        // workspace rejects has to hand the prompt and its attachments back --
        // nothing else holds them, and a toast the user cannot act on is worse
        // than no send at all.
        const draft = promptInputRef.current?.snapshot();
        promptInputRef.current?.clear();
        // Submitting is a request to watch what happens next, so a reader who
        // had scrolled back returns to the live edge and follows it again. Both
        // halves are needed: the scroller arms follow-bottom from autoScroll at
        // the moment it is asked to scroll, so a scroll that runs while the
        // session is still starting up would only land at the end.
        setIsFollowingSubmit(true);
        setScrollToEndSignal((signal) => signal + 1);
        if (isTutorialActive) {
          handleDismissTutorial();
        }
        // While a turn is running, buffer the prompt; the queue delivers it
        // when the agent goes idle. A brand-new session (no id yet) always
        // starts immediately.
        if (isQueueEnabled && isAgentAlive && selectedSessionId) {
          enqueue({ files, folders, modelURI, prompt });
          return;
        }
        createMessage.mutate(
          {
            files,
            folders,
            id,
            modelURI,
            prompt,
            sessionId: selectedSessionId,
          },
          {
            onError: () => {
              if (draft) {
                promptInputRef.current?.restore(draft);
              }
            },
            onSuccess: ({ sessionId }) => {
              void navigate({
                params: { id },
                replace: true,
                search: (prev) => ({
                  ...prev,
                  selectedSessionId: sessionId,
                }),
                to: "/tasks/$id",
              });
            },
          },
        );
      }}
      placeholder={
        isQueueEnabled && isAgentAlive
          ? "Queue a follow-up…"
          : `Talk to ${APP_NAME}`
      }
      ref={promptInputRef}
      selectedSessionId={selectedSessionId}
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
    <MessageScrollerProvider
      autoScroll={isAgentAlive || isFollowingSubmit || isSettlingTurn}
      defaultScrollPosition="end"
      key={selectedSessionId}
      scrollPreviousItemPeek={TRANSCRIPT_PREVIOUS_TURN_PEEK}
    >
      <ScrollToEndBridge signal={scrollToEndSignal} />
      <div className="flex h-full min-h-0 flex-col">
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-2 p-4 pb-8">
              {selectedSessionId ? (
                isLoadingMessages ? (
                  <div className="flex animate-in justify-center py-4 opacity-0 duration-150 fade-in-0 [animation-delay:500ms] [animation-fill-mode:forwards]">
                    <Spinner className="size-4 text-muted-foreground" />
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
                        <Tooltip delayDuration={0}>
                          <TooltipTrigger asChild>
                            <Button
                              onClick={handleStartNewTask}
                              variant="secondary"
                            >
                              Start new task
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Starts a new task</p>
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip delayDuration={0}>
                          <TooltipTrigger asChild>
                            <Button onClick={() => refetch()}>Retry</Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Retry loading messages</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </AlertDescription>
                  </Alert>
                ) : !isAgentRunning && messages.length === 0 ? (
                  <ChatZeroState
                    id={id}
                    selectedSessionId={selectedSessionId}
                  />
                ) : (
                  <TranscriptStream
                    editingMessageId={editingMessageId}
                    isAgentRunning={isAgentRunning}
                    isDeveloperMode={isDeveloperMode}
                    isEditPending={restartFromMessage.isPending}
                    messages={messages}
                    modelURI={selectedModelURI}
                    onCancelEdit={handleCancelEdit}
                    onContinue={handleContinue}
                    onModelChange={setSelectedModelURI}
                    onRetry={handleRetry}
                    onStartEdit={handleStartEdit}
                    onStartNewTask={handleStartNewTask}
                    onSubmitEdit={handleSubmitEdit}
                    selectedSessionId={selectedSessionId}
                    task={task}
                  />
                )
              ) : (
                <ChatZeroState id={id} selectedSessionId={selectedSessionId} />
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
            />
          </div>
        </MessageScroller>

        {/* isolate: keep the tutorial card's -z-10 background and the prompt
            input's z-10 contained to the composer. */}
        <div className="isolate mx-auto w-full max-w-3xl px-3 pb-3">
          <QueuedPrompts onRemove={remove} prompts={queue} />
          {showTutorial === undefined ? (
            promptInput
          ) : (
            <TutorialPromptCard
              isDismissPending={dismissTutorial.isPending}
              isVisible={isTutorialVisible}
              onDismiss={handleDismissTutorial}
            >
              {promptInput}
            </TutorialPromptCard>
          )}
        </div>
      </div>
    </MessageScrollerProvider>
  );
}

// The scroll commands come from the provider's context, so they are only
// reachable below it. This renders nothing and exists to run scrollToEnd for
// the submit handler, which sits above the provider. A counter rather than a
// direct call, so the scroll runs from the render that turned autoScroll on and
// the scroller arms follow-bottom with it.
function ScrollToEndBridge({ signal }: { signal: number }) {
  const { scrollToEnd } = useMessageScroller();

  useLayoutEffect(() => {
    if (signal === 0) {
      return;
    }

    scrollToEnd();
  }, [scrollToEnd, signal]);

  return null;
}

// The transcript, wired to the scroller it is drawn in. ChatStream also renders
// outside one (nested tool-agent streams) where useMessageScroller throws, so
// reading the scroll commands is this wrapper's job rather than its own.
function TranscriptStream(
  props: Omit<ComponentProps<typeof ChatStream>, "renderAsItems">,
) {
  const { releaseAutoScroll } = useMessageScroller();

  return (
    <TranscriptScrollContext value={releaseAutoScroll}>
      <ChatStream {...props} renderAsItems />
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
