// What the margin notes do beside the real scroller over a send. Anchors ignore
// a transform and the slide reads one as distance, so only a browser can say
// that the notes keep out of it and it keeps working with them there.
import { chatNotesAtom } from "@/client/atoms/chat-notes";
import { renderInBrowser } from "@/tests/render-browser";
import {
  type ChatId,
  type DeveloperNote,
  type StoreId,
  type Turn,
} from "@instrument-org/workspace/client";
import { NoteIcon } from "@phosphor-icons/react/Note";
import { createStore, Provider } from "jotai";
import { noop } from "radashi";
import { Fragment, type RefObject, useRef, useState } from "react";
import { expect, it, vi } from "vitest";

import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "../ui/message-scroller";
import DeveloperNotesLayer from "./developer-notes-layer";
import { DeveloperNotesSourceContext } from "./developer-notes-source";
import { useSlideToSent } from "./use-slide-to-sent";

const PEEK = 80;

let send: () => void = noop;

const turnId = (at: number) => `msg_${at.toString()}` as StoreId.Message;

const noteOn = (at: number): DeveloperNote => ({
  id: `note-${at.toString()}`,
  kind: "note",
  label: "A note",
  mark: "note",
  row: `message:${turnId(at)}`,
  rowKind: "bubble",
  rowLabel: "A message",
  side: "right",
  turn: turnId(at),
});

function Slide({
  armRef,
  contentRef,
}: {
  armRef: RefObject<() => void>;
  contentRef: RefObject<HTMLElement | null>;
}) {
  const { releaseAutoScroll } = useMessageScroller();
  useSlideToSent({ armRef, contentRef, release: releaseAutoScroll });
  return null;
}

function Harness({ hasLayer }: { hasLayer: boolean }) {
  const armRef = useRef<() => void>(noop);
  const contentRef = useRef<HTMLDivElement>(null);
  const [sent, setSent] = useState(2);
  send = () => {
    armRef.current();
    setSent((count) => count + 1);
  };
  const indexes = Array.from({ length: sent }, (_, index) => index);
  const source = {
    useBody: () => null,
    useNotes: () => indexes.map(noteOn),
  };
  return (
    <MessageScrollerProvider
      autoScroll
      defaultScrollPosition="end"
      scrollPreviousItemPeek={PEEK}
    >
      <MessageScroller>
        <MessageScrollerViewport
          className="@container/transcript"
          style={{ height: 400 }}
        >
          <MessageScrollerContent
            data-content
            ref={contentRef}
            style={{ display: "flex", flexDirection: "column", padding: 16 }}
          >
            {indexes.map((index) => (
              <Fragment key={index}>
                <MessageScrollerItem
                  data-sent
                  data-transcript-row={`message:${turnId(index)}`}
                  scrollAnchor
                  style={{ height: 40 }}
                />
                <MessageScrollerItem
                  style={{ height: index === sent - 1 ? 40 : 600 }}
                />
              </Fragment>
            ))}
            {hasLayer && (
              <DeveloperNotesSourceContext value={source}>
                <DeveloperNotesLayer
                  chatId={"chat" as ChatId}
                  sessionId={"ses" as StoreId.Session}
                  turns={indexes.map(
                    (index) => ({ id: turnId(index) }) as Turn,
                  )}
                />
              </DeveloperNotesSourceContext>
            )}
          </MessageScrollerContent>
          <Slide armRef={armRef} contentRef={contentRef} />
        </MessageScrollerViewport>
      </MessageScroller>
    </MessageScrollerProvider>
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

function sentTop() {
  const sent = document.querySelectorAll("[data-sent]");
  return (
    (sent[sent.length - 1]?.getBoundingClientRect().top ?? 0) -
    viewport().getBoundingClientRect().top
  );
}

const isSliding = () =>
  (document.querySelector("[data-content]")?.getAnimations().length ?? 0) > 0;

const nextFrame = () =>
  new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });

/** Where every row is and how far it scrolls, right now. */
function measure() {
  const element = viewport();
  return JSON.stringify({
    height: element.scrollHeight,
    rects: [...element.querySelectorAll("[data-content] *")].map((row) => {
      const { top, width } = row.getBoundingClientRect();
      return [top, width];
    }),
    top: element.scrollTop,
    width: element.scrollWidth,
  });
}

/** The same frame with the layer in the document and out of it. */
function layerMoves(): boolean {
  const layer = document.querySelector("[data-developer-notes]");
  if (!layer?.parentNode) {
    return false;
  }
  const withLayer = measure();
  const { nextSibling, parentNode } = layer;
  layer.remove();
  const without = measure();
  parentNode.insertBefore(layer, nextSibling);
  return withLayer !== without;
}

async function restingPlace(hasLayer: boolean) {
  const { unmount } = await renderInBrowser(<Harness hasLayer={hasLayer} />);
  await vi.waitFor(() => {
    expect(viewport().scrollTop).toBeGreaterThan(0);
  });
  if (hasLayer) {
    await vi.waitFor(() => {
      expect(document.querySelector("[data-dn=stack]")).not.toBeNull();
    });
  }
  send();
  await vi.waitFor(() => {
    expect(isSliding()).toBe(true);
  });
  let moved = 0;
  const hidden: string[] = [];
  while (isSliding()) {
    if (hasLayer) {
      moved += layerMoves() ? 1 : 0;
      const stack = document.querySelector("[data-dn=stack]");
      if (stack) {
        hidden.push(getComputedStyle(stack).visibility);
      }
    }
    await nextFrame();
  }
  await nextFrame();
  const place = { scrollTop: viewport().scrollTop, top: sentTop() };
  const after =
    hasLayer &&
    getComputedStyle(document.querySelector("[data-dn=stack]") as Element)
      .visibility;
  await unmount();
  return { after, hidden, moved, place };
}

it("keeps a send's slide as it is with the layer mounted, and stays out of its way", async () => {
  const without = await restingPlace(false);
  const withLayer = await restingPlace(true);
  // It rests in the same place, and at no frame on the way did the layer move a row.
  expect(withLayer.place).toEqual(without.place);
  expect(withLayer.moved).toBe(0);
  // Anchors ignore the slide's transform, so the notes wait for it to land.
  expect(withLayer.hidden.length).toBeGreaterThan(0);
  expect(new Set(withLayer.hidden)).toEqual(new Set(["hidden"]));
  expect(withLayer.after).toBe("visible");
});

it("scrolls a long card inside itself, with Copy in reach, and leaves the scroller out of it", async () => {
  const onWheel = vi.fn();
  const turn = turnId(0);
  const body = {
    text: Array.from({ length: 200 }, (_, at) => at.toString()).join("\n"),
    wasSent: true,
  };
  const source = {
    useBody: () => body,
    useNotes: () => [noteOn(0)],
  };
  const { unmount } = await renderInBrowser(
    <MessageScrollerProvider defaultScrollPosition="start">
      <MessageScroller>
        <MessageScrollerViewport
          className="@container/transcript"
          onWheel={onWheel}
          style={{ height: 400 }}
        >
          <MessageScrollerContent data-content>
            <MessageScrollerItem
              data-transcript-row={`message:${turn}`}
              style={{ height: 40 }}
            />
            <DeveloperNotesSourceContext value={source}>
              <DeveloperNotesLayer
                chatId={"chat" as ChatId}
                sessionId={"ses" as StoreId.Session}
                turns={[{ id: turn } as Turn]}
              />
            </DeveloperNotesSourceContext>
          </MessageScrollerContent>
        </MessageScrollerViewport>
      </MessageScroller>
    </MessageScrollerProvider>,
  );
  await vi.waitFor(() => {
    expect(document.querySelector("[data-note]")).not.toBeNull();
  });
  document
    .querySelector("[data-note]")
    ?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  await vi.waitFor(() => {
    expect(document.querySelector("[data-dn=card-words]")).not.toBeNull();
  });
  const card = document.querySelector<HTMLElement>("[data-dn=card]");
  if (!card) {
    throw new Error("no card");
  }
  expect(card.scrollHeight).toBeGreaterThan(card.clientHeight);
  card.scrollTop = 1000;
  await nextFrame();
  const copy = card.querySelector("button")?.getBoundingClientRect();
  const { top } = card.getBoundingClientRect();
  expect(copy?.top).toBeGreaterThanOrEqual(top);
  expect(copy?.bottom).toBeLessThan(top + 40);

  card.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
  expect(onWheel).not.toHaveBeenCalled();
  viewport().dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
  expect(onWheel).toHaveBeenCalledOnce();
  await unmount();
});

/** What the layer's lines draw. */
async function linesOf(
  notes: DeveloperNote[],
  { within = "[data-dn=line]" } = {},
) {
  const source = { useBody: () => null, useNotes: () => notes };
  const { unmount } = await renderInBrowser(
    <MessageScrollerProvider defaultScrollPosition="start">
      <MessageScroller>
        <MessageScrollerViewport
          className="@container/transcript"
          style={{ height: 400 }}
        >
          <MessageScrollerContent data-content>
            <MessageScrollerItem
              data-transcript-row={`message:${turnId(0)}`}
              style={{ height: 400 }}
            />
            <MessageScrollerItem
              data-transcript-row={`message:${turnId(1)}`}
              style={{ height: 400 }}
            />
            <MessageScrollerItem
              data-transcript-row={`worked:${turnId(0)}`}
              style={{ height: 400 }}
            />
            <DeveloperNotesSourceContext value={source}>
              <DeveloperNotesLayer
                chatId={"chat" as ChatId}
                sessionId={"ses" as StoreId.Session}
                turns={[{ id: turnId(0) } as Turn]}
              />
            </DeveloperNotesSourceContext>
          </MessageScrollerContent>
        </MessageScrollerViewport>
      </MessageScroller>
    </MessageScrollerProvider>,
  );
  await vi.waitFor(() => {
    expect(document.querySelector("[data-dn=stack]")).not.toBeNull();
  });
  await nextFrame();
  const lines = [...document.querySelectorAll<HTMLElement>(within)]
    .filter((line) => getComputedStyle(line).display !== "none")
    .map((line) =>
      line.dataset.error !== undefined
        ? "triangle"
        : (line.querySelector("[data-dn=count]")?.textContent ?? "mark"),
    );
  const path = document.querySelector("[data-dn=mark] path")?.getAttribute("d");
  await unmount();
  return { lines, path };
}

/** What shows of a stack with room for one line, by what each line says it needs. */
async function oneLineHolds(notes: DeveloperNote[]) {
  const source = { useBody: () => null, useNotes: () => notes };
  const { unmount } = await renderInBrowser(
    <MessageScrollerProvider defaultScrollPosition="start">
      <MessageScroller>
        <MessageScrollerViewport className="@container/transcript">
          <MessageScrollerContent data-content>
            <MessageScrollerItem data-transcript-row={`message:${turnId(0)}`} />
            <DeveloperNotesSourceContext value={source}>
              <DeveloperNotesLayer
                chatId={"chat" as ChatId}
                sessionId={"ses" as StoreId.Session}
                turns={[{ id: turnId(0) } as Turn]}
              />
            </DeveloperNotesSourceContext>
          </MessageScrollerContent>
        </MessageScrollerViewport>
      </MessageScroller>
    </MessageScrollerProvider>,
  );
  await vi.waitFor(() => {
    expect(document.querySelector("[data-dn=stack]")).not.toBeNull();
  });
  const shown = [
    ...document.querySelectorAll<HTMLElement>(
      '[data-dn=line][data-fits="1"], [data-dn=line][data-count-at="1"]',
    ),
  ].map((line) => (line.dataset.error === undefined ? "count" : "error"));
  await unmount();
  return shown;
}

const errorOn = (at: number): DeveloperNote => ({
  ...noteOn(at),
  id: `error-${at.toString()}`,
  kind: "error",
  mark: "error",
});
const manyNotes = Array.from({ length: 8 }, (_, at) => ({
  ...noteOn(0),
  id: `note-${at.toString()}`,
}));

it("shows three marks and a count past four notes, with an error first whenever it came", async () => {
  const { lines } = await linesOf([...manyNotes, errorOn(0)]);
  expect(lines).toEqual(["triangle", "mark", "mark", "+6"]);
});

it("keeps an error showing where the room fits one line, in place of the count", async () => {
  expect(await oneLineHolds(manyNotes)).toEqual(["count"]);
  expect(await oneLineHolds([...manyNotes, errorOn(0)])).toEqual(["error"]);
});

it("draws nothing with chat notes off", async () => {
  const store = createStore();
  store.set(chatNotesAtom, false);
  const source = { useBody: () => null, useNotes: () => [noteOn(0)] };
  const { unmount } = await renderInBrowser(
    <Provider store={store}>
      <MessageScrollerProvider defaultScrollPosition="start">
        <MessageScroller>
          <MessageScrollerViewport className="@container/transcript">
            <MessageScrollerContent data-content>
              <MessageScrollerItem
                data-transcript-row={`message:${turnId(0)}`}
              />
              <DeveloperNotesSourceContext value={source}>
                <DeveloperNotesLayer
                  chatId={"chat" as ChatId}
                  sessionId={"ses" as StoreId.Session}
                  turns={[{ id: turnId(0) } as Turn]}
                />
              </DeveloperNotesSourceContext>
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>
    </Provider>,
  );
  await nextFrame();
  await nextFrame();
  expect(document.querySelector("[data-developer-notes]")).toBeNull();
  expect(document.querySelector("[data-dn]")).toBeNull();
  await unmount();
});

it("draws a mark in the thin weight", async () => {
  const { path } = await linesOf([noteOn(0)]);
  const { unmount } = await renderInBrowser(<NoteIcon data-regular="" />);
  const regular = document
    .querySelector("[data-regular] path")
    ?.getAttribute("d");
  await unmount();
  expect(path).toBeTruthy();
  expect(path).not.toBe(regular);
});

it.each([
  ["one note, as its mark", [noteOn(0)], ["mark"]],
  ["one error, as its triangle", [errorOn(0)], ["triangle"]],
  ["several, as their total", manyNotes.slice(0, 3), ["3"]],
  [
    "several with an error, as a triangle beside the total",
    [...manyNotes.slice(0, 3), errorOn(0)],
    ["triangle", "4"],
  ],
])("closes a fold of %s", async (_name, notes, expected) => {
  const { lines } = await linesOf(
    notes.map((note) => ({ ...note, foldedIn: turnId(0) })),
    { within: "[data-fold] [data-dn=line]" },
  );
  expect(lines).toEqual(expected);
});

it("keeps a fold's total off the page on either side of its Worked row, without growing the scroller", async () => {
  const turn = turnId(0);
  const row = "prt_in_the_fold";
  const note: DeveloperNote = {
    foldedIn: turn,
    id: "note-in-the-fold",
    kind: "note",
    label: "A note",
    mark: "note",
    row,
    rowKind: "activity",
    rowLabel: "A step",
    side: "right",
    turn,
  };
  const source = { useBody: () => null, useNotes: () => [note] };
  const { unmount } = await renderInBrowser(
    <MessageScrollerProvider defaultScrollPosition="start">
      <MessageScroller>
        <MessageScrollerViewport
          className="@container/transcript"
          style={{ height: 400 }}
        >
          <MessageScrollerContent
            data-content
            style={{ display: "flex", flexDirection: "column", padding: 16 }}
          >
            <MessageScrollerItem
              data-transcript-row={row}
              style={{ height: 40 }}
            />
            <MessageScrollerItem
              data-transcript-row={`worked:${turn}`}
              style={{ height: 40 }}
            />
            <DeveloperNotesSourceContext value={source}>
              <DeveloperNotesLayer
                chatId={"chat" as ChatId}
                sessionId={"ses" as StoreId.Session}
                turns={[{ id: turn } as Turn]}
              />
            </DeveloperNotesSourceContext>
          </MessageScrollerContent>
        </MessageScrollerViewport>
      </MessageScroller>
    </MessageScrollerProvider>,
  );
  await vi.waitFor(() => {
    expect(document.querySelector("[data-fold]")).not.toBeNull();
  });
  await nextFrame();
  expect(layerMoves()).toBe(false);
  expect(
    document.querySelector("[data-fold]")?.getBoundingClientRect().top,
  ).toBeLessThan(0);
  await unmount();
});
