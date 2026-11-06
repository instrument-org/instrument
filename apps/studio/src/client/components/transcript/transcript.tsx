import { chatSeparators } from "@/client/lib/chat-separators";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import {
  type ChatInfo,
  type StoreId,
  type TranscriptMessage,
  type Turn,
  turnsOf,
  type TurnsCache,
  waitsForStep,
} from "@instrument-org/workspace/client";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/client/lib/utils";
import { type RunAgain } from "../message-error";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { MessageScrollerItem } from "../ui/message-scroller";
import { Spinner } from "../ui/spinner";
import {
  type TranscriptActions,
  TranscriptActionsContext,
} from "./transcript-actions";
import { TurnView } from "./turn-view";

/**
 * A session's transcript. The one way a chat or a task is drawn: a chat's turns
 * and a task's differ only in the task's first turns being its chat's, folded
 * behind one line, and its opener being its assignment.
 *
 * Everything drawn reads `turnsOf`, so what belongs together and what folds is
 * decided in one place, with the same messages always giving the same turns.
 */
export function Transcript({
  chatInfo,
  hasOlder = false,
  isLoadingOlder = false,
  isRunning,
  messages,
  onContinue,
  onLoadOlder,
  onModelChange,
  onRetry,
  onRunAgain,
  sessionId,
}: {
  chatInfo: ChatInfo;
  /** There are earlier turns than these, asked for as the reader nears them. */
  hasOlder?: boolean;
  isLoadingOlder?: boolean;
  /** The session is at work on its last turn, or about to be. */
  isRunning: boolean;
  messages: readonly TranscriptMessage[];
  onContinue?: () => void;
  onLoadOlder?: () => void;
  onModelChange?: (modelURI: AIGatewayModelURI.Type) => void;
  onRetry: (prompt: string) => void;
  onRunAgain?: RunAgain;
  sessionId: StoreId.Session;
}) {
  const [cache] = useState<TurnsCache>(() => new Map());
  const turns = turnsOf(messages, { isRunning, sessionId }, cache);
  const separators = useMemo(() => chatSeparators(messages), [messages]);
  const actions = useStableActions({
    isRunning,
    onModelChange,
    onRetry,
    onRunAgain,
  });
  const earlier = turns.filter((turn) => turn.inherited);
  const own = turns.filter((turn) => !turn.inherited);
  const last = turns.at(-1);
  const pausedAtMaxSteps =
    !isRunning && last?.replies.at(-1)?.metadata.finishReason === "max-steps";
  const drawTurn = (turn: Turn) => (
    <TurnView
      chatInfo={chatInfo}
      isLast={turn === last}
      key={turn.id}
      separator={turn.opener && separators.get(turn.opener.message.id)}
      sessionId={sessionId}
      turn={turn}
      waitsForStep={turn === last && waitsForStep(turns)}
    />
  );
  return (
    <TranscriptActionsContext value={actions}>
      {hasOlder && onLoadOlder && (
        <OlderTurns isLoading={isLoadingOlder} onNear={onLoadOlder} />
      )}
      {earlier.length > 0 && (
        <EarlierInTheChat count={messagesIn(earlier)}>
          {earlier.map(drawTurn)}
        </EarlierInTheChat>
      )}
      {own.map(drawTurn)}
      {pausedAtMaxSteps && onContinue && (
        <MessageScrollerItem key="continue">
          <Alert className="mt-4" variant="warning">
            <WarningIcon />
            <AlertDescription className="flex flex-col gap-3">
              <div className="text-xs">
                Instrument paused after working on its own for a while.
              </div>
              <Button onClick={onContinue} size="sm" variant="secondary">
                Keep going
              </Button>
            </AlertDescription>
          </Alert>
        </MessageScrollerItem>
      )}
    </TranscriptActionsContext>
  );
}

function messagesIn(turns: readonly Turn[]): number {
  return turns.reduce(
    (sum, turn) => sum + turn.replies.length + (turn.opener ? 1 : 0),
    0,
  );
}

/** A task's history, which its chat's messages are: folded, a click away. */
function EarlierInTheChat({
  children,
  count,
}: {
  children: React.ReactNode;
  count: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <MessageScrollerItem>
        <button
          className="flex w-full items-center gap-3 text-xs text-muted-foreground outline-none hover:text-foreground"
          onClick={() => {
            setIsOpen((open) => !open);
          }}
          type="button"
        >
          <span className="h-px flex-1 bg-border" />
          Earlier in the chat · {count} {count === 1 ? "message" : "messages"}
          <CaretDownIcon
            className={cn(
              "-ml-2 size-3 transition duration-150",
              isOpen && "rotate-180",
            )}
          />
          <span className="h-px flex-1 bg-border" />
        </button>
      </MessageScrollerItem>
      {isOpen && children}
    </>
  );
}

/**
 * Stands above the first turn held and asks for the page before it as the
 * reader nears the top. The scroller keeps what is on screen in place as turns
 * arrive above it.
 */
function OlderTurns({
  isLoading,
  onNear,
}: {
  isLoading: boolean;
  onNear: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(onNear);
  useLayoutEffect(() => {
    latest.current = onNear;
  });
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          latest.current();
        }
      },
      { rootMargin: "600px 0px 0px 0px" },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return (
    <div className="flex h-6 items-center justify-center" ref={ref}>
      {isLoading && <Spinner className="size-3.5 text-muted-foreground" />}
    </div>
  );
}

/** The actions as one object that never changes, calling the latest render's. */
function useStableActions(actions: TranscriptActions): TranscriptActions {
  const latest = useRef(actions);
  useLayoutEffect(() => {
    latest.current = actions;
  });
  const [handlers] = useState(() => ({
    onModelChange: (modelURI: AIGatewayModelURI.Type) => {
      latest.current.onModelChange?.(modelURI);
    },
    onRetry: (prompt: string) => {
      latest.current.onRetry(prompt);
    },
    onRunAgain: (options?: { ifIdle: boolean }) => {
      latest.current.onRunAgain?.(options);
    },
  }));
  return useMemo(
    () => ({
      ...handlers,
      isRunning: actions.isRunning,
    }),
    [actions.isRunning, handlers],
  );
}
