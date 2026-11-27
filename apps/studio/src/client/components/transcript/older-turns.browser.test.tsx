// A long chat opened on its last turns, through the real transcript and the
// pages the server gives: the room left above them for the turns not loaded
// yet, the reader's place as pages fill that room, and the very top.
// Measured, since jsdom has no layout or observers.
import { buildFrames } from "@/client/routes/debug/-transcript/frames";
import { scenarios } from "@/client/routes/debug/-transcript/scenarios";
import {
  type Act,
  prose,
  stop,
  user,
} from "@/client/routes/debug/-transcript/script";
import { renderInBrowser } from "@/tests/render-browser";
import { transcriptRecords } from "@/tests/transcript-records";
import {
  applyOlder,
  ChatIdSchema,
  lastTurnsOf,
  type SessionMessage,
  type TranscriptFeed,
} from "@instrument-org/workspace/client";
import { useState } from "react";
import { expect, it } from "vitest";

import "../../styles/globals.css";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "../ui/message-scroller";
import { type TranscriptSurface, TranscriptSurfaceContext } from "./surface";
import { Transcript } from "./transcript";
import { TranscriptRecordsContext } from "./transcript-data";

const noop = () => undefined;

const SURFACE: TranscriptSurface = {
  onOpenFile: noop,
  onOpenTask: noop,
  onOpenUrl: noop,
  onStopCommand: noop,
  onStopTask: noop,
  PagePicture: () => <div style={{ height: 240 }} />,
};

const PAGE = 10;
const VIEW = 600;

/**
 * The `long-chat` scenario's 80 turns, as the records hold them: from a day
 * ago, so every turn's work has long folded and none holds its answer still
 * as it folds. Its turns are alike, so the room's estimate is near exact.
 */
function longChat(): SessionMessage.WithParts[] {
  const scenario = scenarios.find((each) => each.id === "long-chat");
  return messagesOf(scenario?.script ?? []);
}

/**
 * Turns (80 unless told) whose replies run from one paragraph to a dozen, the older half
 * longer than the newer, so the room's estimate is well off what each page
 * brings and only the place-keeping keeps the reader's place. Sent hours
 * apart, so every turn has its date line, and the first turn held keeps its
 * own as a page lands above it.
 */
function unevenChat(turns = 80): SessionMessage.WithParts[] {
  const messages = messagesOf(
    Array.from({ length: turns }, (_, index) => {
      const paragraphs = 1 + ((index * 7) % 9) + (index < 40 ? 3 : 0);
      return [
        user(`Message ${index.toString()}`),
        prose(
          Array.from({ length: paragraphs }, () =>
            "The harbor wall and its berths, counted again. ".repeat(4),
          ).join("\n\n"),
          1,
        ),
        stop(),
      ];
    }).flat(),
  );
  let turn = -1;
  for (const message of messages) {
    turn += message.role === "user" ? 1 : 0;
    message.metadata.createdAt = new Date(
      message.metadata.createdAt.getTime() - (turns - 1 - turn) * 7_200_000,
    );
  }
  return messages;
}

function messagesOf(script: Act[]): SessionMessage.WithParts[] {
  const frame = buildFrames(script, Date.now() - 86_400_000).at(-1);
  if (!frame) {
    throw new Error("no frame");
  }
  return frame.messages;
}

/** Pages asked for and not yet given; each call gives the oldest. */
const asked: (() => void)[] = [];
/** Gives pages as they are asked for, a moment later, or only on `arrive`. */
let givesPages = true;
/** A page asked for fails, as a read the server could not make. */
let failsPages = false;
/** Every time the transcript asked for a page. */
let asks = 0;
/** Adds the turn after those held, as a message sent and answered. */
let sendTurn = noop;

function arrive() {
  asked.shift()?.();
}

/** Pages given as asked for, none failing, none asked for yet. */
function resetPages({ gives = true }: { gives?: boolean } = {}) {
  givesPages = gives;
  failsPages = false;
  asks = 0;
  asked.length = 0;
}

/**
 * A chat's transcript fed as the app feeds it: its last page of turns, and
 * the page before what it holds each time the transcript asks, from the
 * server's own paging.
 */
function Paged({
  height = VIEW,
  messages,
  sent = 0,
  zoom = 1,
}: {
  /** The view's height. */
  height?: number;
  messages: readonly SessionMessage.WithParts[];
  /** How many of the last turns are not held yet, for `sendTurn` to add. */
  sent?: number;
  zoom?: number;
}) {
  const turnStarts = messages.flatMap((message, at) =>
    message.role === "user" ? [at] : [],
  );
  const [shown, setShown] = useState(turnStarts.length - sent);
  const upTo = turnStarts[shown] ?? messages.length;
  const [feed, setFeed] = useState<TranscriptFeed>(() =>
    lastTurnsOf(messages.slice(0, upTo), { turns: PAGE }),
  );
  sendTurn = () => {
    const next = turnStarts[shown + 1] ?? messages.length;
    const turn = lastTurnsOf(messages.slice(0, next), { turns: 1 });
    setFeed((current) => ({
      ...current,
      messages: [...current.messages, ...turn.messages],
    }));
    setShown(shown + 1);
  };
  const [isLoading, setIsLoading] = useState(false);
  const sessionId = messages[0]?.metadata.sessionId;
  if (!sessionId) {
    throw new Error("no session");
  }
  const loadOlder = () => {
    const before = feed.messages[0]?.id;
    if (isLoading || !feed.hasOlder || before === undefined) {
      return;
    }
    asks += 1;
    setIsLoading(true);
    const give = () => {
      if (!failsPages) {
        setFeed((current) =>
          applyOlder(current, lastTurnsOf(messages, { before, turns: PAGE })),
        );
      }
      setIsLoading(false);
    };
    asked.push(give);
    if (givesPages) {
      window.setTimeout(arrive, 30);
    }
  };
  return (
    <div style={{ zoom }}>
      <TranscriptSurfaceContext value={SURFACE}>
        <TranscriptRecordsContext
          value={transcriptRecords({
            parts: messages.flatMap((message) => message.parts),
          })}
        >
          <MessageScrollerProvider>
            <MessageScroller style={{ height, width: 640 }}>
              <MessageScrollerViewport>
                <MessageScrollerContent>
                  <Transcript
                    chatId={ChatIdSchema.parse("older-turns")}
                    hasOlder={feed.hasOlder}
                    isLoadingOlder={isLoading}
                    isRunning={false}
                    messages={feed.messages}
                    olderTurns={feed.olderTurns}
                    onLoadOlder={loadOlder}
                    onRetry={noop}
                    sessionId={sessionId}
                  />
                </MessageScrollerContent>
              </MessageScrollerViewport>
            </MessageScroller>
          </MessageScrollerProvider>
        </TranscriptRecordsContext>
      </TranscriptSurfaceContext>
    </div>
  );
}

function viewport() {
  const element = document.querySelector<HTMLElement>(
    "[data-slot=message-scroller-viewport]",
  );
  if (!element) {
    throw new Error("no viewport");
  }
  return element;
}

const room = () => document.querySelector<HTMLElement>("[data-older-turns]");

/** The rows of the turns held, in order. */
const turnRows = () => [
  ...viewport().querySelectorAll<HTMLElement>(
    "[data-slot=message-scroller-content] > [data-turn-id]",
  ),
];

/** How many turns the rows held are, by their messages that open one. */
const heldTurns = () =>
  new Set(
    turnRows()
      .filter((row) => row.dataset.scrollAnchor === "true")
      .map((row) => row.dataset.turnId),
  ).size;

/** From the room's foot to the last turn's: the turns held, with the gaps between. */
function heldSpan() {
  const above = room();
  const last = turnRows().at(-1);
  if (!above || !last) {
    throw new Error("nothing held");
  }
  return (
    last.offsetTop + last.offsetHeight - (above.offsetTop + above.offsetHeight)
  );
}

/** The column from its first turn's top to its last turn's foot. */
function wholeSpan() {
  const rows = turnRows();
  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last) {
    throw new Error("nothing held");
  }
  return last.offsetTop + last.offsetHeight - first.offsetTop;
}

const frames = (count: number) =>
  new Promise<void>((resolve) => {
    const next = (left: number) => {
      if (left === 0) {
        resolve();
      } else {
        requestAnimationFrame(() => {
          next(left - 1);
        });
      }
    };
    next(count);
  });

/** As a reader's wheel, so the scroller leaves the place to them. */
function scrollTo(top: number) {
  viewport().dispatchEvent(
    new WheelEvent("wheel", {
      bubbles: true,
      deltaY: top < viewport().scrollTop ? -100 : 100,
    }),
  );
  viewport().scrollTop = top;
}

/**
 * Each turn row on screen, and its foot on screen. Its foot, since the first
 * turn held draws its date above its message only while it is the first, and
 * a page arriving above takes the date away from over what was being read.
 */
function rowsOnScreen() {
  const view = viewport().getBoundingClientRect();
  return new Map(
    turnRows().flatMap((row) => {
      const box = row.getBoundingClientRect();
      return box.bottom > view.top && box.top < view.bottom
        ? [[row, box.bottom] as const]
        : [];
    }),
  );
}

/** How far each row in `seen` is from where it was, past `by`, where more than a pixel. */
function movesFrom(seen: ReadonlyMap<HTMLElement, number>, by = 0) {
  return [...seen].flatMap(([row, foot]) => {
    const off = row.getBoundingClientRect().bottom - (foot - by);
    return row.isConnected && Math.abs(off) > 1 ? [Math.round(off)] : [];
  });
}

it("leaves room above the turns held for each turn not loaded, as tall as a turn held on average", async () => {
  resetPages({ gives: false });
  const messages = longChat();
  await renderInBrowser(<Paged messages={messages} />);
  await expect.poll(() => room()?.offsetHeight ?? 0).toBeGreaterThan(VIEW);
  // 80 turns, the last 10 held.
  expect(heldTurns()).toBe(PAGE);
  expect(room()?.offsetHeight).toBeCloseTo((70 * heldSpan()) / PAGE, -1);
  const opened = viewport().scrollHeight;

  // Each page takes its turns' share of the room.
  scrollTo(room()?.offsetHeight ?? 0);
  await expect.poll(() => asked.length).toBe(1);
  arrive();
  await expect.poll(heldTurns).toBe(2 * PAGE);
  await frames(2);
  expect(room()?.offsetHeight).toBeCloseTo((60 * heldSpan()) / (2 * PAGE), -1);

  // The scrollbar was about as long at the opening as with every turn in.
  givesPages = true;
  arrive();
  scrollTo(0);
  await expect.poll(room, { timeout: 10_000 }).toBeNull();
  await frames(2);
  const whole = viewport().scrollHeight;
  expect(Math.abs(opened - whole) / whole).toBeLessThan(0.1);
});

it.each([1, 1.5])(
  "keeps the turns on screen still as pages fill the room above them, at %fx zoom",
  { timeout: 60_000 },
  async (zoom) => {
    resetPages({ gives: false });
    await renderInBrowser(<Paged messages={unevenChat()} zoom={zoom} />);
    await expect.poll(() => room()?.offsetHeight ?? 0).toBeGreaterThan(VIEW);
    const rooms: number[] = [];
    const moved: number[] = [];

    // A page landing with the room's foot a third of the way down the view
    // and the first turns held under it.
    const above = room();
    scrollTo(
      (above?.offsetTop ?? 0) +
        (above?.offsetHeight ?? 0) -
        viewport().clientHeight / 3,
    );
    await expect.poll(() => asked.length).toBe(1);
    const before = rowsOnScreen();
    expect(before.size).toBeGreaterThan(1);
    rooms.push(room()?.offsetHeight ?? 0);
    arrive();
    for (let frame = 0; frame < 10; frame++) {
      await frames(1);
      moved.push(...movesFrom(before));
    }

    // Then up through the rest, with each page landing as it is asked for.
    for (let step = 0; step < 400; step++) {
      if (room() === null && viewport().scrollTop < 1) {
        break;
      }
      if (asked.length > 0) {
        const seen = rowsOnScreen();
        rooms.push(room()?.offsetHeight ?? 0);
        arrive();
        await frames(3);
        moved.push(...movesFrom(seen));
        continue;
      }
      const from = viewport().scrollTop;
      const seen = rowsOnScreen();
      scrollTo(from - 0.9 * viewport().clientHeight);
      const by = (viewport().scrollTop - from) * zoom;
      await frames(3);
      moved.push(...movesFrom(seen, by));
    }
    expect(moved).toEqual([]);
    // Every page took its share of the room, the last all that was left.
    expect(rooms).toHaveLength(7);
    expect(rooms).toEqual(rooms.toSorted((a, b) => b - a));
    expect(room()).toBeNull();
    expect(viewport().scrollTop).toBe(0);
    expect(heldTurns()).toBe(80);
  },
);

it("ends a drag to the very top on the first turn, with nothing on screen moving", async () => {
  resetPages();
  const messages = unevenChat();
  await renderInBrowser(<Paged messages={messages} />);
  await expect.poll(() => room()?.offsetHeight ?? 0).toBeGreaterThan(VIEW);

  // A press on the scrollbar, and the thumb taken to the top.
  viewport().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  viewport().scrollTop = 0;
  const tops: number[] = [];
  const moved: number[] = [];
  let seen = rowsOnScreen();
  for (let frame = 0; frame < 600 && room() !== null; frame++) {
    await frames(1);
    tops.push(viewport().scrollTop);
    moved.push(...movesFrom(seen));
    seen = rowsOnScreen();
  }
  await frames(5);
  expect(room()).toBeNull();
  expect(new Set(tops)).toEqual(new Set([0]));
  expect(moved).toEqual([]);
  // The first turn, at the top.
  expect(heldTurns()).toBe(80);
  const first = turnRows()[0];
  expect(first?.dataset.messageId).toBe(messages[0]?.id);
  expect(
    (first?.getBoundingClientRect().top ?? 0) -
      viewport().getBoundingClientRect().top,
  ).toBeCloseTo(0, 0);
  expect(wholeSpan()).toBeGreaterThan(viewport().clientHeight);
});

it("leaves no room above a chat with nothing older to load", async () => {
  resetPages();
  const messages = longChat();
  // Its first four turns, the whole of a short chat.
  const fifth = lastTurnsOf(messages, { turns: 76 }).messages[0]?.id;
  const short = messages.slice(
    0,
    messages.findIndex((message) => message.id === fifth),
  );
  expect(lastTurnsOf(short, { turns: PAGE })).toMatchObject({
    hasOlder: false,
    olderTurns: 0,
  });
  await renderInBrowser(<Paged messages={short} />);
  await expect.poll(heldTurns).toBe(4);
  expect(room()).toBeNull();
  const content = viewport().querySelector(
    "[data-slot=message-scroller-content]",
  );
  expect(content?.firstElementChild).toBe(turnRows()[0]);
  expect(content?.scrollHeight).toBe(wholeSpan());
});

it("asks once for a page that failed, until the reader comes near again", async () => {
  resetPages();
  failsPages = true;
  await renderInBrowser(<Paged messages={unevenChat()} />);
  await expect.poll(() => room()?.offsetHeight ?? 0).toBeGreaterThan(VIEW);
  scrollTo(0);
  await expect.poll(() => asks).toBe(1);
  await frames(30);
  expect(asks).toBe(1);
  // Coming near anew asks again.
  scrollTo(viewport().scrollHeight);
  await frames(5);
  scrollTo(0);
  await expect.poll(() => asks).toBe(2);
});

it("keeps the room as it is while a message is sent and answered under it", async () => {
  resetPages({ gives: false });
  await renderInBrowser(<Paged messages={unevenChat()} sent={1} />);
  await expect.poll(() => room()?.offsetHeight ?? 0).toBeGreaterThan(VIEW);
  const before = room()?.offsetHeight;
  sendTurn();
  await expect.poll(heldTurns).toBe(PAGE + 1);
  await frames(5);
  expect(room()?.offsetHeight).toBe(before);
});

it("ends a drag to the top of a chat whose last page is one turn with every turn in and the first in view", async () => {
  resetPages();
  const messages = unevenChat(81);
  await renderInBrowser(<Paged height={1000} messages={messages} />);
  await expect.poll(() => room()?.offsetHeight ?? 0).toBeGreaterThan(1000);
  viewport().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  viewport().scrollTop = 0;
  let lastRoom = Number.POSITIVE_INFINITY;
  for (let frame = 0; frame < 600 && room() !== null; frame++) {
    lastRoom = room()?.offsetHeight ?? lastRoom;
    await frames(1);
  }
  await frames(5);
  // The room for the one turn left was shorter than the view, so turns
  // showed under it at the very top.
  expect(lastRoom).toBeLessThan(1000);
  expect(heldTurns()).toBe(81);
  // The row on screen as that turn came in stays where it was, so the view
  // ends that turn's misestimate from the very top.
  const [first] = turnRows();
  expect(first?.dataset.messageId).toBe(messages[0]?.id);
  expect(
    first &&
      first.getBoundingClientRect().bottom >
        viewport().getBoundingClientRect().top,
  ).toBe(true);
});
