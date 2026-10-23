import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import {
  type ChatInfo,
  isToolPart,
  pathsNamedInMessage,
  type SessionMessage,
  type SessionMessageDataPart,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { isEqual } from "radashi";
import {
  createContext,
  memo,
  use,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { type ChatSeparator, chatSeparators } from "../lib/chat-separators";
import { cn } from "../lib/utils";
import { AssistantMessage, hasBubbleWords } from "./assistant-message";
import { AttachmentsCard } from "./attachments-card";
import { FollowedBubblesContext } from "./bubble-run-context";
import { ChatSeparatorRow } from "./chat-separator";
import { isDataPart, renderDataPart } from "./chat-stream-data-parts";
import { type RenderPartContext } from "./chat-stream-render-part";
import { TailFirst, TypingRow } from "./chat-stream";
import { MessageError } from "./message-error";
import { ToolCallBody } from "./message-part/tool-call";
import { SentReplyQuote } from "./reply-quote";
import { SentFoldersCard } from "./sent-folders-card";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { MessageScrollerItem } from "./ui/message-scroller";
import { UserMessage } from "./user-message";
import { SentChips } from "./window/context-chip";

/**
 * A chat's conversation as a text chat: the user's bubbles at the right,
 * the replies at the left, and what goes with them. What the agent did to
 * get there is the task card's (`chat-activity.tsx`), so no step, call or
 * thought is drawn here, in developer mode or out of it.
 *
 * Drawn from `message.live.bubbles`, which holds a reply back until it is
 * whole, so the only thing that moves while the agent writes is the dots.
 * Each run of one speaker's bubbles is a box, and a box keeps its object
 * for as long as what it draws is the same, so an update redraws only the
 * boxes it changed.
 */
export function ChatBubbles({
  awaitingReply = false,
  chatInfo,
  drafting,
  isAgentRunning,
  isDeveloperMode,
  messages,
  onContinue,
  onModelChange,
  onRetry,
  onRunAgain,
}: {
  /**
   * A reply to the user's last message is on its way though the agent is not
   * running yet: the message is still being sent, or its session is starting.
   */
  awaitingReply?: boolean;
  chatInfo: ChatInfo;
  /** The conversation is writing words the user will get; see `BubbleFeed`. */
  drafting: boolean;
  isAgentRunning: boolean;
  /** For an error's details; the bubbles themselves are the same either way. */
  isDeveloperMode: boolean;
  messages: SessionMessage.WithParts[];
  onContinue: () => void;
  onModelChange?: (modelURI: AIGatewayModelURI.Type) => void;
  onRetry: (prompt: string) => void;
  onRunAgain?: () => void;
}) {
  const actions = useStableActions({
    onContinue,
    onModelChange,
    onRetry,
    onRunAgain,
  });
  const lastingDrafting = useLastingDrafting(isAgentRunning && drafting);
  const derived = bubbleBoxes(messages, {
    awaitingReply: isAgentRunning || awaitingReply,
    chatInfo,
    drafting: lastingDrafting,
    isAgentRunning,
    isDeveloperMode,
  });
  const boxes = useStableBoxes(derived.boxes);
  // Everything on screen as the conversation opens counts as already here,
  // the older turns filled in above it included, so only what arrives while
  // it is being read comes in moving.
  const [arrivals] = useState(() => new Arrivals(derived.boxes));
  useEffect(() => {
    arrivals.goLive();
  }, [arrivals]);
  const followedKey = derived.followed.join(" ");
  const [followed, setFollowed] = useState(() => ({
    key: followedKey,
    set: new Set(derived.followed),
  }));
  if (followed.key !== followedKey) {
    setFollowed({ key: followedKey, set: new Set(derived.followed) });
  }

  const lastMessage = messages.at(-1);
  const pausedAtMaxSteps =
    !isAgentRunning &&
    lastMessage?.role === "assistant" &&
    lastMessage.metadata.finishReason === "max-steps";

  return (
    <BubbleActionsContext value={actions}>
      <ArrivalsContext value={arrivals}>
        <FollowedBubblesContext value={followed.set}>
          <TailFirst
            items={boxes.map((box) => (
              <BubbleBoxItem box={box} chatInfo={chatInfo} key={box.key} />
            ))}
          />
          {pausedAtMaxSteps && (
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
        </FollowedBubblesContext>
      </ArrivalsContext>
    </BubbleActionsContext>
  );
}

/**
 * How long a step has to go on writing before the dots stand for it. A reply
 * that arrives in one piece is written and lands within a few frames, and
 * dots drawn for that long only flash in and out ahead of it.
 */
const DRAFTING_DOTS_DELAY_MS = 400;

/** Whether the conversation has been writing words for longer than a flash. */
function useLastingDrafting(drafting: boolean): boolean {
  const [lasting, setLasting] = useState(false);
  useEffect(() => {
    if (!drafting) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setLasting(true);
    }, DRAFTING_DOTS_DELAY_MS);
    return () => {
      window.clearTimeout(timeout);
      setLasting(false);
    };
  }, [drafting]);
  return drafting && lasting;
}

/** One thing a box draws, in the order it draws them. */
type BubbleRow =
  | { kind: "card"; part: SessionMessagePart.ToolPart }
  | { kind: "chips"; chips: SessionMessageDataPart.SentChip[] }
  | {
      isAgentRunning: boolean;
      isDeveloperMode: boolean;
      isLastMessage: boolean;
      kind: "error";
      message: SessionMessage.AssistantWithParts;
    }
  | {
      files: NonNullable<
        SessionMessageDataPart.FileAttachmentsDataPart["files"]
      >;
      kind: "files";
    }
  | {
      folders: NonNullable<
        SessionMessageDataPart.FileAttachmentsDataPart["folders"]
      >;
      kind: "folders";
    }
  | {
      kind: "note";
      part: SessionMessagePart.DataPart;
      pathsAlreadyShown: ReadonlySet<string> | undefined;
    }
  | { kind: "reply"; reply: SessionMessageDataPart.ReplyDataPart }
  | { kind: "separator"; separator: ChatSeparator }
  | {
      kind: "text";
      part: SessionMessagePart.TextPart;
      role: "assistant" | "user";
    }
  | { kind: "typing" };

/** A run of one speaker's bubbles, or the dots, as one scroller item. */
export interface BubbleBox {
  /** Pulled up to the box above it, which is the same speaker's. */
  continuesRun: boolean;
  /** The message it opens with, which the scroller anchors by. */
  key: string;
  rows: BubbleRow[];
  speaker: "assistant" | "user";
}

/**
 * The boxes a conversation draws, and the bubbles another bubble of the same
 * speaker follows (the ones that do not wear the tail).
 */
function bubbleBoxes(
  messages: readonly SessionMessage.WithParts[],
  {
    awaitingReply,
    chatInfo,
    drafting,
    isAgentRunning,
    isDeveloperMode,
  }: {
    awaitingReply: boolean;
    chatInfo: ChatInfo;
    drafting: boolean;
    isAgentRunning: boolean;
    isDeveloperMode: boolean;
  },
): { boxes: BubbleBox[]; followed: string[] } {
  const regular = messages.filter(
    (message) => message.role !== "session-context",
  );
  const separators = chatSeparators(regular);
  const boxes: BubbleBox[] = [];
  const followed: string[] = [];
  let runBubbles: string[] = [];
  let lastSpeaker: BubbleBox["speaker"] | undefined;
  const endRun = () => {
    followed.push(...runBubbles.slice(0, -1));
    runBubbles = [];
  };
  const push = (
    box: Omit<BubbleBox, "continuesRun">,
    bubbles: string[],
    opensRun: boolean,
  ) => {
    // A box of notes alone (what the user answered to a card) sits under
    // whatever is above it, and opens no run of either speaker's bubbles.
    if (!opensRun && box.rows.every((row) => row.kind === "note")) {
      endRun();
      lastSpeaker = undefined;
      boxes.push({ ...box, continuesRun: boxes.length > 0 });
      return;
    }
    const continuesRun = lastSpeaker === box.speaker && !opensRun;
    if (!continuesRun) {
      endRun();
    }
    runBubbles.push(...bubbles);
    lastSpeaker = box.speaker;
    boxes.push({ ...box, continuesRun });
  };

  // The assistant's turn being gathered: one box for every message of a
  // turn, since a turn is one message per step.
  let turn: { bubbles: string[]; key: string; rows: BubbleRow[] } | undefined;
  // The words the turn last said. A model that retries a failed command says
  // its line again first, and the second copy is the same reply twice.
  let lastSaid: string | undefined;
  // The user's last message has nothing of the agent's under it yet.
  let unanswered = false;

  for (const [index, message] of regular.entries()) {
    const isLastMessage = index === regular.length - 1;
    if (message.role === "user") {
      lastSaid = undefined;
      unanswered = true;
      const { bubbles, rows } = userRows(
        message,
        separators.get(message.id),
        chatInfo,
      );
      if (rows.length > 0) {
        push(
          { key: message.id, rows, speaker: "user" },
          bubbles,
          separators.has(message.id),
        );
      }
      continue;
    }
    if (message.role !== "assistant") {
      continue;
    }

    turn ??= { bubbles: [], key: message.id, rows: [] };
    // A reply a newer one cut off is not an error to anyone, and is not shown.
    const superseded = message.metadata.error?.kind === "aborted";
    const paths = message.parts.some((part) => part.type === "data-fileChanges")
      ? pathsNamedInMessage(message)
      : undefined;
    for (const stored of message.parts) {
      if (stored.type === "text") {
        if (
          superseded ||
          (stored.state === "done" && stored.text.trim() === "")
        ) {
          continue;
        }
        let part = stored;
        const said = part.text.trim();
        if (said !== "") {
          if (lastSaid !== undefined && said.startsWith(lastSaid)) {
            const rest = said.slice(lastSaid.length).trim();
            if (rest === "") {
              continue;
            }
            part = { ...part, text: rest };
          }
          lastSaid = said;
        }
        turn.rows.push({ kind: "text", part, role: "assistant" });
        if (hasBubbleWords(part.text)) {
          turn.bubbles.push(part.metadata.id);
        }
      } else if (isToolPart(stored)) {
        // An image or search call is in the feed for the note over the
        // reply box, which says what it ran into; the bubbles draw no card
        // for it.
        if (
          stored.type !== "tool-generate_image" &&
          stored.type !== "tool-web_search"
        ) {
          turn.rows.push({ kind: "card", part: stored });
        }
      } else if (isDataPart(stored) && drawsInChat(stored, chatInfo, paths)) {
        turn.rows.push({
          kind: "note",
          part: stored,
          pathsAlreadyShown: paths,
        });
      }
    }
    // A run of the same refusal, one per retry, reads as one: only the latest.
    if (
      message.metadata.error &&
      !superseded &&
      !isSameRefusal(message, regular[index + 1])
    ) {
      turn.rows.push({
        isAgentRunning,
        isDeveloperMode,
        isLastMessage,
        kind: "error",
        message,
      });
    }

    if (
      turn.rows.some(
        (row) =>
          row.kind === "text" || row.kind === "card" || row.kind === "error",
      )
    ) {
      unanswered = false;
    }

    if (regular[index + 1]?.role !== "assistant") {
      if (turn.rows.length > 0) {
        push(
          { key: turn.key, rows: turn.rows, speaker: "assistant" },
          turn.bubbles,
          false,
        );
      }
      turn = undefined;
    }
  }

  // The dots stand where the words will land, as the last bubble of the run:
  // while the agent writes words, and from the moment the user's message is
  // sent until the agent has put anything of its own under it.
  if (drafting || (awaitingReply && unanswered)) {
    push(
      { key: "typing", rows: [{ kind: "typing" }], speaker: "assistant" },
      ["typing"],
      false,
    );
  }
  endRun();
  return { boxes, followed };
}

function userRows(
  message: SessionMessage.WithParts,
  separator: ChatSeparator | undefined,
  chatInfo: ChatInfo,
): { bubbles: string[]; rows: BubbleRow[] } {
  const rows: BubbleRow[] = [];
  const bubbles: string[] = [];
  let attachments: SessionMessageDataPart.FileAttachmentsDataPart | undefined;
  let chips: SessionMessageDataPart.SentChip[] = [];
  let reply: SessionMessageDataPart.ReplyDataPart | undefined;
  for (const part of message.parts) {
    if (part.type === "data-attachments") {
      attachments = part.data;
    } else if (part.type === "data-viewContext") {
      chips = part.data.attached ?? [];
    } else if (part.type === "data-reply") {
      reply = part.data;
    } else if (part.type === "text") {
      if (part.state === "done" && part.text.trim() === "") {
        continue;
      }
      rows.push({ kind: "text", part, role: "user" });
      bubbles.push(part.metadata.id);
    } else if (isDataPart(part) && drawsInChat(part, chatInfo, undefined)) {
      rows.push({ kind: "note", part, pathsAlreadyShown: undefined });
    }
  }
  // What the message carries goes over its words, files under folders under
  // chips, as the composer had them; what it answers over all of it.
  const head: BubbleRow[] = [];
  if (chips.length > 0) {
    head.push({ chips, kind: "chips" });
  }
  if (attachments?.folders?.length) {
    head.push({ folders: attachments.folders, kind: "folders" });
  }
  if (attachments?.files?.length) {
    head.push({ files: attachments.files, kind: "files" });
  }
  rows.unshift(...head);
  if (rows.length > 0 && reply) {
    rows.unshift({ kind: "reply", reply });
  }
  if (rows.length > 0 && separator) {
    rows.unshift({ kind: "separator", separator });
  }
  return { bubbles, rows };
}

/**
 * The context a note is drawn with in the chat, where the developer's notes
 * stay out of it.
 */
function chatNoteContext(
  chatInfo: ChatInfo,
  onRetry: (prompt: string) => void,
): RenderPartContext {
  return {
    chatInfo,
    isAgentRunning: false,
    isDeveloperMode: false,
    isToolStreaming: () => false,
    lastMessageId: undefined,
    onRetry,
    presentation: "chat",
  };
}

/**
 * Whether a note draws anything in the chat. One that draws nothing, such as
 * the news of a finished task the reply already tells, makes no row: a row
 * takes its gap whatever it draws, and a box of notes alone splits the reply
 * around it in two.
 */
function drawsInChat(
  part: SessionMessagePart.DataPart,
  chatInfo: ChatInfo,
  pathsAlreadyShown: ReadonlySet<string> | undefined,
): boolean {
  return (
    renderDataPart({
      ctx: chatNoteContext(chatInfo, () => {}),
      part,
      pathsAlreadyShown,
      stateNote: undefined,
    }) !== null
  );
}

function isSameRefusal(
  message: SessionMessage.WithParts,
  next: SessionMessage.WithParts | undefined,
): boolean {
  if (message.role !== "assistant" || next?.role !== "assistant") {
    return false;
  }
  const error = message.metadata.error;
  const nextError = next.metadata.error;
  if (!error || !nextError || error.kind !== nextError.kind) {
    return false;
  }
  const classification =
    "classification" in error ? error.classification : undefined;
  const nextClassification =
    "classification" in nextError ? nextError.classification : undefined;
  return classification !== undefined && classification === nextClassification;
}

/**
 * The boxes, each the same object as last render when everything it draws
 * is: what lets an unchanged box skip its render.
 */
function useStableBoxes(boxes: BubbleBox[]): BubbleBox[] {
  const [kept] = useState(() => new Map<string, BubbleBox>());
  const stable = boxes.map((box) => {
    const previous = kept.get(box.key);
    return previous && sameBox(previous, box) ? previous : box;
  });
  useLayoutEffect(() => {
    kept.clear();
    for (const box of stable) {
      kept.set(box.key, box);
    }
  });
  return stable;
}

function sameBox(a: BubbleBox, b: BubbleBox): boolean {
  return (
    a.continuesRun === b.continuesRun &&
    a.speaker === b.speaker &&
    a.rows.length === b.rows.length &&
    a.rows.every((row, index) => sameRow(row, b.rows[index]))
  );
}

function sameRow(a: BubbleRow, b: BubbleRow | undefined): boolean {
  if (b === undefined || a.kind !== b.kind) {
    return false;
  }
  switch (a.kind) {
    case "text": {
      // A line said again is drawn as a fresh part holding only what is new.
      return (
        b.kind === "text" &&
        a.part.metadata.id === b.part.metadata.id &&
        a.part.text === b.part.text &&
        a.part.state === b.part.state
      );
    }
    case "error": {
      return (
        b.kind === "error" &&
        a.message === b.message &&
        a.isAgentRunning === b.isAgentRunning &&
        a.isDeveloperMode === b.isDeveloperMode &&
        a.isLastMessage === b.isLastMessage
      );
    }
    case "typing": {
      return true;
    }
    case "card": {
      return b.kind === "card" && a.part === b.part;
    }
    case "chips": {
      return b.kind === "chips" && a.chips === b.chips;
    }
    case "files": {
      return b.kind === "files" && a.files === b.files;
    }
    case "folders": {
      return b.kind === "folders" && a.folders === b.folders;
    }
    case "note": {
      return (
        b.kind === "note" &&
        a.part === b.part &&
        a.pathsAlreadyShown === b.pathsAlreadyShown
      );
    }
    case "reply": {
      return b.kind === "reply" && a.reply === b.reply;
    }
    case "separator": {
      return b.kind === "separator" && isEqual(a.separator, b.separator);
    }
  }
}

type BubbleActions = {
  onContinue: () => void;
  onModelChange?: (modelURI: AIGatewayModelURI.Type) => void;
  onRetry: (prompt: string) => void;
  onRunAgain?: () => void;
};

const BubbleActionsContext = createContext<BubbleActions>({
  onContinue: () => {},
  onRetry: () => {},
});

/**
 * The handlers, as one object that never changes, calling whichever the
 * latest render passed: a box does not render again because its parent made
 * new functions.
 */
function useStableActions(actions: BubbleActions): BubbleActions {
  const latest = useRef(actions);
  useLayoutEffect(() => {
    latest.current = actions;
  });
  const [stable] = useState<BubbleActions>(() => ({
    onContinue: () => {
      latest.current.onContinue();
    },
    onModelChange: (modelURI) => {
      latest.current.onModelChange?.(modelURI);
    },
    onRetry: (prompt) => {
      latest.current.onRetry(prompt);
    },
    onRunAgain: () => {
      latest.current.onRunAgain?.();
    },
  }));
  return stable;
}

/** A box's rows are 4px apart, so a run of bubbles reads as one cluster. */
const BOX = "flex flex-col gap-1";

/**
 * Pulled up out of the column's 16px gap to the 4px of the run it continues:
 * a second message sent before the reply came, the dots under a reply.
 */
const CONTINUES_RUN = "-mt-3";

/**
 * A note's spacing is the box's, whatever margin the note brings: 4px under
 * the note above it, 8px under a bubble or a card.
 */
const NOTE = "*:mt-0";
const NOTE_UNDER_BUBBLE = "mt-1";

// Memoized by hand: the boxes arrive as a new array every render, so nothing
// the compiler can see says an item's props are the ones it had.
const BubbleBoxItem = memo(function BubbleBoxItem({
  box,
  chatInfo,
}: {
  box: BubbleBox;
  chatInfo: ChatInfo;
}) {
  return (
    <MessageScrollerItem
      className={cn(
        box.speaker === "assistant" && "group/assistant-turn",
        BOX,
        box.continuesRun && CONTINUES_RUN,
      )}
      messageId={box.key === "typing" ? undefined : box.key}
      // The conversation keeps to its end, the way a chat does.
      scrollAnchor={false}
    >
      {box.rows.map((row, index) => (
        <Arriving
          className={
            row.kind === "note"
              ? cn(
                  NOTE,
                  index > 0 &&
                    box.rows[index - 1]?.kind !== "note" &&
                    NOTE_UNDER_BUBBLE,
                )
              : undefined
          }
          key={rowKey(row, index)}
          side={box.speaker}
          signature={arrivalSignature(box, row, index)}
        >
          {
            // Only the cards and notes read the chat's record; the rest name
            // the chat, so a record that moved redraws no bubble.
            row.kind === "card" || row.kind === "note" ? (
              <RecordRowView chatInfo={chatInfo} row={row} />
            ) : (
              <BubbleRowView chatId={chatInfo.id} row={row} />
            )
          }
        </Arriving>
      ))}
    </MessageScrollerItem>
  );
});

/**
 * What a row is for telling whether it has been on screen before. A message
 * the user sent is drawn from the press and again once stored, under a new
 * id, so its rows go by its words: the stored copy is not a second arrival.
 */
function arrivalSignature(box: BubbleBox, row: BubbleRow, index: number) {
  if (box.speaker !== "user") {
    return rowKey(row, index);
  }
  const words = box.rows
    .map((each) => (each.kind === "text" ? each.part.text : ""))
    .join("\n");
  return `user:${words}:${row.kind}:${index}`;
}

/** The rows a conversation has drawn, and whether it has finished opening. */
class Arrivals {
  private live = false;
  private readonly seen: Set<string>;

  constructor(boxes: readonly BubbleBox[]) {
    this.seen = new Set(
      boxes.flatMap((box) =>
        box.rows.map((row, index) => arrivalSignature(box, row, index)),
      ),
    );
  }

  /** Whether a row mounting now is new to the reader. */
  isArriving(signature: string) {
    return this.live && !this.seen.has(signature);
  }

  goLive() {
    this.live = true;
  }

  see(signature: string) {
    this.seen.add(signature);
  }
}

const ArrivalsContext = createContext(new Arrivals([]));

/**
 * The way a text chat brings in a message: a short fade and rise, grown
 * from the corner of the bubble's own side. Only for a row that arrives
 * while the conversation is being read.
 */
const ARRIVE =
  "animate-in fill-mode-both fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-200 ease-out motion-reduce:animate-none";

function Arriving({
  children,
  className,
  side,
  signature,
}: {
  children: React.ReactNode;
  className?: string;
  side: BubbleBox["speaker"];
  signature: string;
}) {
  const arrivals = use(ArrivalsContext);
  // Decided once, as the row mounts: a row redrawn later is not arriving.
  const [isArriving] = useState(() => arrivals.isArriving(signature));
  useEffect(() => {
    arrivals.see(signature);
  }, [arrivals, signature]);
  return (
    <div
      className={cn(
        className,
        isArriving && ARRIVE,
        isArriving &&
          (side === "user" ? "origin-bottom-right" : "origin-bottom-left"),
      )}
    >
      {children}
    </div>
  );
}

function rowKey(row: BubbleRow, index: number): string {
  switch (row.kind) {
    case "card":
    case "note":
    case "text": {
      return row.part.metadata.id;
    }
    case "error": {
      return `error-${row.message.id}`;
    }
    default: {
      return `${row.kind}-${index}`;
    }
  }
}

/** A card that asks the user something, or a note everyone sees. */
const RecordRowView = memo(function RecordRowView({
  chatInfo,
  row,
}: {
  chatInfo: ChatInfo;
  row: Extract<BubbleRow, { kind: "card" | "note" }>;
}) {
  const actions = use(BubbleActionsContext);
  if (row.kind === "card") {
    return (
      <ToolCallBody
        chatInfo={chatInfo}
        onRetry={actions.onRetry}
        part={row.part}
      />
    );
  }
  return renderDataPart({
    ctx: chatNoteContext(chatInfo, actions.onRetry),
    part: row.part,
    pathsAlreadyShown: row.pathsAlreadyShown,
    stateNote: undefined,
  });
});

const BubbleRowView = memo(function BubbleRowView({
  chatId,
  row,
}: {
  chatId: ChatInfo["id"];
  row: Exclude<BubbleRow, { kind: "card" | "note" }>;
}) {
  const actions = use(BubbleActionsContext);
  switch (row.kind) {
    case "chips": {
      return <SentChips chips={row.chips} />;
    }
    case "error": {
      return (
        <MessageError
          isAgentRunning={row.isAgentRunning}
          isDeveloperMode={row.isDeveloperMode}
          isLastMessage={row.isLastMessage}
          message={row.message}
          onModelChange={actions.onModelChange}
          onRunAgain={actions.onRunAgain}
        />
      );
    }
    case "files": {
      return <AttachmentsCard chatId={chatId} files={row.files} />;
    }
    case "folders": {
      return <SentFoldersCard folders={row.folders} />;
    }
    case "reply": {
      return <SentReplyQuote reply={row.reply} />;
    }
    case "separator": {
      return <ChatSeparatorRow separator={row.separator} />;
    }
    case "text": {
      return row.role === "user" ? (
        <UserMessage compact part={row.part} />
      ) : (
        <AssistantMessage bubble chatId={chatId} part={row.part} />
      );
    }
    case "typing": {
      return <TypingRow />;
    }
  }
});
