// What the margin notes do beside the real scroller over a send. Anchors ignore
// a transform and the slide reads one as distance, so only a browser can say
// that the notes keep out of it and it keeps working with them there.
import { renderInBrowser } from "@/tests/render-browser";
import {
  type ChatId,
  type DeveloperNote,
  type StoreId,
  type Turn,
} from "@instrument-org/workspace/client";
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

it("keeps a fold's total off the page on either side of its Worked row, without growing the scroller", async () => {
  const turn = turnId(0);
  const row = "prt_in_the_fold";
  const note: DeveloperNote = {
    foldedIn: turn,
    id: "note-in-the-fold",
    kind: "note",
    label: "A note",
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
