import {
  type ChatSeparator,
  chatSeparators,
} from "@/client/lib/chat-separators";
import {
  type InstructionsChange,
  instructionsChanges,
} from "@/client/lib/instructions-changes";
import { isEqual } from "radashi";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import {
  type CardFileVersion,
  cardFileVersions,
  linkedTabsOf,
  type ChatId,
  type StoreId,
  type TranscriptMessage,
  repliesOf,
  type Turn,
  workCardTurnOf,
  turnsOf,
  type TurnsCache,
  waitsForStep,
} from "@instrument-org/workspace/client";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import {
  lazy,
  Suspense,
  use,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { MessageEditingContext } from "./message-editing";
import { type EditSource } from "../reply-blocks/message-edits";

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
import { CardFileVersionsContext } from "./card-file-versions-context";
import { LinkedTabsContext } from "./linked-tabs-context";
import {
  keptEditSources,
  MessageEditSourcesContext,
} from "./message-edit-sources";
import { KeptOpen, KeptOpenContext } from "./kept-open";
import { useIsCardAway } from "./transcript-data";
import { TurnView } from "./turn-view";

/** What only a developer reads, loaded only for a developer. */
const DeveloperNotesLayer = lazy(() => import("./developer-notes-layer"));

/**
 * A session's transcript. The one way a chat or a task is drawn: a chat's turns
 * and a task's differ only in the task's first turns being its chat's, folded
 * behind one line, and its opener being its assignment.
 *
 * Everything drawn reads `turnsOf`, so what belongs together and what folds is
 * decided in one place, with the same messages always giving the same turns.
 */
export function Transcript({
  chatId,
  hasOlder = false,
  isDeveloperMode = false,
  isLoadingOlder = false,
  isRunning,
  messages,
  olderTurns,
  onBranch,
  onChooseModel,
  onContinue,
  onLoadOlder,
  onModelChange,
  onRetry,
  onRunAgain,
  sessionId,
}: {
  chatId: ChatId;
  /** There are earlier turns than these, asked for as the reader nears them. */
  hasOlder?: boolean;
  /** Mounts the margin notes beside the rows, which never change for it. */
  isDeveloperMode?: boolean;
  isLoadingOlder?: boolean;
  /** The session is at work on its last turn, or about to be. */
  isRunning: boolean;
  messages: readonly TranscriptMessage[];
  /** How many turns are above these, room for which is left above them. */
  olderTurns?: number;
  /** Starts a new chat up to a reply; given only for a chat's own conversation. */
  onBranch?: (upTo: StoreId.Message) => Promise<void>;
  /** Opens the chat's model picker; failed replies offer no Change model without it. */
  onChooseModel?: () => void;
  onContinue?: () => void;
  onLoadOlder?: () => void;
  onModelChange?: (modelURI: AIGatewayModelURI.Type) => void;
  onRetry: (prompt: string) => void;
  onRunAgain?: RunAgain;
  sessionId: StoreId.Session;
}) {
  const [cache] = useState<TurnsCache>(() => new Map());
  const [keptOpen] = useState(() => new KeptOpen());
  const turns = turnsOf(messages, { isRunning, sessionId }, cache);
  // What each turn is drawn with keeps its object while it is equal, so a
  // token streaming into the last reply leaves every other turn's memo whole.
  const [kept] = useState<KeptPerTurn>(() => ({
    changes: new Map(),
    editSources: new Map(),
    separators: new Map(),
    versions: new Map(),
  }));
  const separators = useMemo(
    () => keepEqual(kept.separators, chatSeparators(messages)),
    [kept, messages],
  );
  const changes = useMemo(
    () => keepEqual(kept.changes, instructionsChanges(messages)),
    [kept, messages],
  );
  const fileVersions = useMemo(() => cardFileVersions(messages), [messages]);
  const versions = useMemo(
    () => keptTurnVersions(kept.versions, fileVersions, turns),
    [kept, fileVersions, turns],
  );
  const editSources = useMemo(
    () => keptEditSources(kept.editSources, turns),
    [kept, turns],
  );
  const actions = useStableActions({
    isRunning,
    onBranch,
    onChooseModel,
    onModelChange,
    onRetry,
    onRunAgain,
  });
  const earlier = turns.filter((turn) => turn.inherited);
  const own = turns.filter((turn) => !turn.inherited);
  const last = turns.at(-1);
  const cardTurn = workCardTurnOf(turns);
  const isCardAway = useIsCardAway(
    turns.find((turn) => turn.id === cardTurn),
    sessionId,
  );
  const replies = repliesOf(turns);
  const editing = use(MessageEditingContext)?.editing;
  const editedAt =
    editing === undefined
      ? -1
      : turns.findIndex((turn) => turn.opener?.message.id === editing);
  const pausedAtMaxSteps =
    !isRunning && last?.replies.at(-1)?.metadata.finishReason === "max-steps";
  const drawTurn = (turn: Turn) => (
    <CardFileVersionsContext key={turn.id} value={versions.get(turn.id)}>
      <MessageEditSourcesContext value={editSources.get(turn.id)}>
        <LinkedTabsContext value={turnLinkedTabs(turn)}>
          <TurnView
            chatId={chatId}
            changes={turn.opener && changes.get(turn.opener.message.id)}
            hasCard={turn.id === cardTurn}
            isCardAway={turn.id === cardTurn && isCardAway}
            isFaded={
              editedAt === -1 || turns.indexOf(turn) < editedAt
                ? undefined
                : turns[editedAt] === turn
                  ? "work"
                  : "all"
            }
            isLast={turn === last}

            carriesOn={replies.carriedOn.has(turn.id)}
            replyEnd={replies.ends.get(turn.id)}
            separator={turn.opener && separators.get(turn.opener.message.id)}
            sessionId={sessionId}
            turn={turn}
            waitsForStep={turn === last && waitsForStep(turns)}
          />
        </LinkedTabsContext>
      </MessageEditSourcesContext>
    </CardFileVersionsContext>
  );
  return (
    <KeptOpenContext value={keptOpen}>
      <TranscriptActionsContext value={actions}>
        {hasOlder && onLoadOlder && (
          <OlderTurns
            count={olderTurns}
            held={own.filter((turn) => turn.opener).length}
            isLoading={isLoadingOlder}
            onNear={onLoadOlder}
          />
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
        {isDeveloperMode && (
          <Suspense fallback={null}>
            <DeveloperNotesLayer
              chatId={chatId}
              sessionId={sessionId}
              turns={turns}
            />
          </Suspense>
        )}
      </TranscriptActionsContext>
    </KeptOpenContext>
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

/** The loader's own height, which the room above the turns held never goes under. */
const OLDER_TURNS_MIN_PX = 24;

/**
 * Stands above the first turn held for the turns not loaded yet: as tall as
 * their count times the average height of the turns held, so the scrollbar
 * is about the whole chat's length from the start. The height is taken again
 * only when the count changes (a page arrived, or the feed started over),
 * never as a turn streams or a message is sent.
 *
 * It asks for the page before as the reader nears it, and again after each
 * page that added turns while they are still near, so a reader who reached
 * it (a fling, the scrollbar's thumb taken to the top) is not left looking at
 * nothing; a page that failed or added nothing is asked for again only when
 * the reader comes near anew. The browser never anchors the reader's place
 * on it, so the turns on screen stay put as a page takes its share of it; at
 * a scroll position of 0, where the browser anchors nothing, the scroll owner
 * keeps the place.
 */
function OlderTurns({
  count,
  held,
  isLoading,
  onNear,
}: {
  /** How many turns are above the first one held; unknown leaves only the loader. */
  count: number | undefined;
  /** How many turns are held, by the messages that open one. */
  held: number;
  isLoading: boolean;
  onNear: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef({ held, onNear });
  useLayoutEffect(() => {
    latest.current = { held, onNear };
  });
  useLayoutEffect(() => {
    const element = ref.current;
    if (element) {
      element.style.height = `${roomFor(element, count, latest.current.held).toString()}px`;
    }
  }, [count]);
  // Pages load one after another, each quicker than a spinner waits to show,
  // so the spinner stays up from the first until 200 ms pass with none loading.
  const [isLoadingPages, setIsLoadingPages] = useState(isLoading);
  if (isLoading && !isLoadingPages) {
    setIsLoadingPages(true);
  }
  useEffect(() => {
    if (isLoading) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setIsLoadingPages(false);
    }, 200);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [isLoading]);
  // How many turns were held when it last asked.
  const askedAt = useRef<number | undefined>(undefined);
  useEffect(() => {
    const element = ref.current;
    if (!element || isLoading) {
      return;
    }
    // A new observer says at once whether it is near. That asks only when a
    // page added turns since the last ask; any later word is the reader
    // coming near.
    let isFirst = true;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const asks = !isFirst || askedAt.current !== held;
        isFirst = false;
        if (entry?.isIntersecting && asks) {
          askedAt.current = held;
          latest.current.onNear();
        }
      },
      {
        root: element.closest("[data-slot=message-scroller-viewport]"),
        rootMargin: "600px 0px 0px 0px",
      },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [held, isLoading]);
  return (
    <div
      className="flex min-h-6 flex-col justify-end [overflow-anchor:none]"
      data-older-turns=""
      ref={ref}
    >
      {isLoadingPages && (
        // Mid-view while the room covers it, at its foot otherwise.
        <div className="sticky bottom-1/2 flex h-6 items-center justify-center">
          <Spinner className="size-3.5 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

/**
 * How tall the room above the turns held is for `count` more turns: from its
 * foot to the last turn's, over the `held` turns there, times `count`. Layout
 * px, as the window's zoom leaves offsets.
 */
function roomFor(
  element: HTMLElement,
  count: number | undefined,
  held: number,
): number {
  const rows = element.parentElement?.children ?? [];
  const last = [...rows].findLast(
    (row): row is HTMLElement =>
      row instanceof HTMLElement && row.dataset.turnId !== undefined,
  );
  if (count === undefined || held === 0 || !last) {
    return OLDER_TURNS_MIN_PX;
  }
  const span =
    last.offsetTop +
    last.offsetHeight -
    (element.offsetTop + element.offsetHeight);
  return Math.max(OLDER_TURNS_MIN_PX, Math.round((count * span) / held));
}

/** The actions as one object that never changes, calling the latest render's. */
function useStableActions(actions: TranscriptActions): TranscriptActions {
  const latest = useRef(actions);
  useLayoutEffect(() => {
    latest.current = actions;
  });
  const [{ onBranch, onChooseModel, ...handlers }] = useState(() => ({
    onBranch: (upTo: StoreId.Message) =>
      latest.current.onBranch?.(upTo) ?? Promise.resolve(),
    onChooseModel: () => {
      latest.current.onChooseModel?.();
    },
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
  // Whether the transcript offers Branch at all, which a task's never does.
  const canBranch = actions.onBranch !== undefined;
  // Whether failed replies offer Change model, which needs a picker to open.
  const canChooseModel = actions.onChooseModel !== undefined;
  return useMemo(
    () => ({
      ...handlers,
      isRunning: actions.isRunning,
      ...(canBranch && { onBranch }),
      ...(canChooseModel && { onChooseModel }),
    }),
    [
      actions.isRunning,
      canBranch,
      canChooseModel,
      handlers,
      onBranch,
      onChooseModel,
    ],
  );
}

type TurnVersions = ReadonlyMap<string, CardFileVersion>;

/**
 * The last values handed to each turn, by message or turn id. Compared with
 * radashi's `isEqual`, which holds any two Maps or Sets equal: a separator
 * or change holds none, and a turn's file map is compared entry by entry.
 */
interface KeptPerTurn {
  changes: Map<StoreId.Message, InstructionsChange[]>;
  editSources: Map<StoreId.Message, readonly EditSource[]>;
  separators: Map<StoreId.Message, ChatSeparator>;
  versions: Map<StoreId.Message, TurnVersions>;
}

/**
 * `next`, with each value equal to the one `kept` has for its key swapped for
 * that one; `kept` becomes what is returned.
 */
function keepEqual<V>(
  kept: Map<StoreId.Message, V>,
  next: Map<StoreId.Message, V>,
): Map<StoreId.Message, V> {
  for (const [key, value] of next) {
    const was = kept.get(key);
    if (was !== undefined && isEqual(was, value)) {
      next.set(key, was);
    }
  }
  kept.clear();
  for (const [key, value] of next) {
    kept.set(key, value);
  }
  return next;
}

/**
 * The files each turn's replies draw other than as they are now, merged, by
 * turn; a turn whose files read as before keeps its map.
 */
function keptTurnVersions(
  kept: Map<StoreId.Message, TurnVersions>,
  versions: ReturnType<typeof cardFileVersions>,
  turns: readonly Turn[],
): Map<StoreId.Message, TurnVersions> {
  const byTurn = new Map<StoreId.Message, TurnVersions>();
  for (const turn of turns) {
    const found = turn.replies.flatMap((reply) => [
      ...(versions.get(reply.id) ?? []),
    ]);
    if (found.length === 0) {
      continue;
    }
    const next = new Map(found);
    const was = kept.get(turn.id);
    byTurn.set(
      turn.id,
      was !== undefined &&
        was.size === next.size &&
        [...next].every(([path, version]) => isEqual(was.get(path), version))
        ? was
        : next,
    );
  }
  kept.clear();
  for (const [key, value] of byTurn) {
    kept.set(key, value);
  }
  return byTurn;
}

const linkedTabsByReplies = new WeakMap<
  Turn["replies"],
  ReturnType<typeof linkedTabsOf>
>();

/** The pages of the tabs a turn's replies linked, the same object while they are. */
function turnLinkedTabs(turn: Turn): ReturnType<typeof linkedTabsOf> {
  if (!linkedTabsByReplies.has(turn.replies)) {
    linkedTabsByReplies.set(turn.replies, linkedTabsOf(turn.replies));
  }
  return linkedTabsByReplies.get(turn.replies);
}
