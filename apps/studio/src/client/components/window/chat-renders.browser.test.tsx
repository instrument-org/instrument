// First: React reads the counter's hook as it loads.
import {
  grown,
  type Renders,
  rendersOf,
  settled,
} from "@/tests/render-count";
import { renderAppWindow } from "@/tests/app-window";
import {
  applyFeedEvent,
  type ChatId,
  ChatIdSchema,
  type TranscriptFeed,
  transcriptMessage,
} from "@instrument-org/workspace/client";
import { expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import { transcriptFeedOptions } from "@/client/components/transcript/use-transcript-feed";
import { WORDS_SETTLE_MS } from "@/client/drafts/settle-words";
import { sharedQueryClient } from "@/client/lib/tab-router";
import {
  buildFrames,
  type Frame,
} from "@/client/routes/debug/-transcript/frames";
import {
  activity,
  prose,
  stop,
  user,
} from "@/client/routes/debug/-transcript/script";
import { rpcClient } from "@/client/rpc/client";

import { chatListOptions } from "./chat-list-query";
import { type Chat } from "./chats";
import { runWindowCommand } from "./use-window-commands";

// What a reply streaming in and a key typed into the reply box render, in a
// short chat and a long one, counted as the studio-drive probe counts
// (`perf-chat-turns.mjs`). The turns already in a chat stay as they were
// for both, so neither may cost more in the long chat than in the short one.
//
// A failure names what rendered. To see why, run the probe on the running app
// with those components in its `watch`, which says which prop, state or
// context changed. A limit raised on purpose says why in its commit.

const FILE = "src/client/components/window/chat-renders.browser.test.tsx";

const HOUR_MS = 3_600_000;
const START = Date.UTC(2026, 0, 5, 9);

const SHORT = 5;
const LONG = 40;

/**
 * What one more turn above may add to a streamed update or a keystroke, in
 * components rendered, run by run: nothing today. A turn drawn again is at
 * least its own row and the parts in it, several components, so half of one
 * is slack for a clock in the window ticking over mid-count, never a turn.
 */
const PER_TURN = 0.5;

/**
 * A chat's turns so far, then a reply coming out over a dozen updates. Each
 * turn is sent two hours after the one before, so each opens under a line
 * with its time, as in a chat kept over days.
 */
function framesOf(turns: number): Frame[] {
  const frames = buildFrames(
    [
      ...Array.from({ length: turns }, (_, index) => [
        user(`Message ${index + 1}: what changed on the page this time?`),
        activity(`Looking at the page, pass ${index + 1}`),
        prose(
          `Pass ${index + 1}: the title is the same, and the second section moved up.\n\nNothing else changed since the last time you asked.`,
        ),
        stop(),
      ]).flat(),
      user("And now?"),
      prose(
        "Pass again: the title is the same, and the second section moved up. Nothing else changed since the last time you asked, and the footer still links to the same three pages it did before.",
        12,
      ),
    ],
    Date.now() - 600_000,
  );
  const last = frames.at(-1)?.messages ?? [];
  const sentAt = new Map(
    last.map((message, index) => {
      const turn = last
        .slice(0, index + 1)
        .filter((each) => each.role === "user").length;
      return [message.id, START + turn * 2 * HOUR_MS + index * 1000] as const;
    }),
  );
  for (const message of frames.flatMap((frame) => frame.messages)) {
    message.metadata.createdAt = new Date(
      sentAt.get(message.id) ?? message.metadata.createdAt.getTime(),
    );
  }
  return frames;
}

/** Puts a chat where the window reads it, and hands back its reply's updates, each sent to the window when called. */
function seedChat(id: ChatId, turns: number) {
  const frames = framesOf(turns);
  const sessionId = frames.at(-1)?.messages[0]?.metadata.sessionId;
  if (!sessionId) {
    throw new Error("the chat's frames have no session");
  }
  const now = new Date();
  const chat: Chat = {
    archived: false,
    holds: { apps: [], files: [], sites: [] },
    id,
    firstAsk: "Message 1",
    lastUserMessageAt: now.getTime(),
    latest: { at: now.getTime(), kind: "reply", text: "Pass" },
    sessionId,
    starred: false,
    status: "working",
    title: `Passes over ${turns.toString()} turns`,
    titleByApp: true,
    unread: false,
    unreadByUser: false,
    working: true,
  };
  sharedQueryClient.setQueryData(
    chatListOptions().queryKey,
    (chats: Chat[] | undefined) => [...(chats ?? []), chat],
  );
  sharedQueryClient.setQueryData(
    rpcClient.workspace.chats.live.info.experimental_liveOptions({
      input: { id },
    }).queryKey,
    { createdAt: now, id, title: chat.title, updatedAt: now },
  );
  sharedQueryClient.setQueryData(
    rpcClient.workspace.chats.live.folders.experimental_liveOptions({
      input: { id },
    }).queryKey,
    {},
  );
  const feedKey = transcriptFeedOptions({ id, sessionId }).queryKey;
  const show = (frame: Frame) => {
    const messages = frame.messages.flatMap((message) => {
      const light = transcriptMessage(message);
      return light ? [light] : [];
    });
    sharedQueryClient.setQueryData(
      feedKey,
      (current: TranscriptFeed | undefined) =>
        applyFeedEvent(current, { hasOlder: false, kind: "reset", messages }),
    );
  };
  // From the frame the reply first shows in.
  const asked = frames.findLastIndex((frame) => frame.mark.kind === "user");
  const reply = frames.slice(asked + 1);
  const [first, ...updates] = reply;
  if (!first || updates.length < 6) {
    throw new Error("the reply comes out over too few frames");
  }
  show(first);
  return updates.slice(0, 6).map((frame) => () => {
    show(frame);
  });
}

/** Fails unless the tab up shows the chat seeded with `turns`. */
function expectShown(id: ChatId, turns: number) {
  const shownTurns = document.querySelectorAll(
    "[data-app-tab-active] [data-reply-row]",
  ).length;
  expect(
    shownTurns,
    `${id} shows ${shownTurns.toString()} replies, not its ${(turns + 1).toString()}: the chat did not open, so nothing after this measures it.`,
  ).toBe(turns + 1);
}

/** Opens a chat seeded with `seedChat` in the group up. */
async function open(id: ChatId, turns: number) {
  window.__studioDrive?.goto(`/chats/${id}`);
  await settled();
  expectShown(id, turns);
}

/** The chat up, its reply's updates and keys typed into its box, each run apart. */
async function measure(updates: (() => void)[]) {
  const streamed: Renders[] = [];
  for (const update of updates) {
    streamed.push(await rendersOf(update));
  }
  const box = document.querySelector<HTMLElement>(
    "[data-app-tab-active] [contenteditable=true]",
  );
  if (!box) {
    throw new Error("the chat has no reply box");
  }
  box.focus();
  // The first key into the empty box, then keys before the words settle.
  const typed: Renders[] = [];
  for (const key of "abc") {
    typed.push(await rendersOf(() => userEvent.keyboard(key)));
  }
  // Each key alone, until its words settle into the chat's draft, after
  // the last one's words have settled.
  const quiet = WORDS_SETTLE_MS + 150;
  const settledKeys: Renders[] = [];
  for (const key of "de") {
    settledKeys.push(
      await rendersOf(() => userEvent.keyboard(key), {
        quietBeforeMs: quiet,
        quietMs: quiet,
      }),
    );
  }
  return { settledKey: settledKeys, streamed, typed };
}

it("costs a streamed update and a keystroke the same however many turns are above", async () => {
  await renderAppWindow();
  const shortId = ChatIdSchema.parse("short-chat");
  const longId = ChatIdSchema.parse("long-chat");
  // Both chats in the list and open in a group each before either is
  // measured, so the window around them is the same for both.
  const shortUpdates = seedChat(shortId, SHORT);
  const longUpdates = seedChat(longId, LONG);
  await open(shortId, SHORT);
  runWindowCommand("newChat");
  await settled();
  await open(longId, LONG);
  runWindowCommand("nextChat");
  await settled();
  expectShown(shortId, SHORT);
  const short = await measure(shortUpdates);
  runWindowCommand("previousChat");
  await settled();
  expectShown(longId, LONG);
  const long = await measure(longUpdates);

  const failures = (["streamed", "typed", "settledKey"] as const).flatMap(
    (action) => {
      const runs = short[action].map((before, index) => {
        const after = long[action][index] ?? before;
        return {
          after,
          before,
          each: (after.fibers - before.fibers) / (LONG - SHORT),
          index,
        };
      });
      const worst = runs.reduce((most, run) =>
        run.each > most.each ? run : most,
      );
      return worst.each <= PER_TURN
        ? []
        : [
            `${action}, run ${(worst.index + 1).toString()} of ${runs.length.toString()}: ${worst.before.fibers.toString()} components rendered in a chat of ${SHORT.toString()} turns, ${worst.after.fibers.toString()} in one of ${LONG.toString()}: ${worst.each.toFixed(1)} more for each turn above, past the ${PER_TURN.toString()} allowed. What rendered more in the long chat: ${grown(worst.before, worst.after)}.`,
          ];
    },
  );
  expect(
    failures,
    `Turns already in a chat render again (${FILE}). Find the prop or context a turn reads that changes on each update and keep it steady; see the notes atop the file.`,
  ).toEqual([]);
}, 60_000);
