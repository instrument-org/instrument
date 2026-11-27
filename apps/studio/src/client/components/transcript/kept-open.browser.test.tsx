// A long chat through the real transcript: a Worked row the reader opened
// stays open after its turn has been far from view, drawn as a box, and drawn
// again. Measured, since jsdom has no layout or observers.
import {
  buildFrames,
  type Frame,
} from "@/client/routes/debug/-transcript/frames";
import { scenarios } from "@/client/routes/debug/-transcript/scenarios";
import { renderInBrowser } from "@/tests/render-browser";
import { transcriptRecords } from "@/tests/transcript-records";
import {
  ChatIdSchema,
  type TranscriptMessage,
  transcriptMessage,
} from "@instrument-org/workspace/client";
import { expect, it } from "vitest";

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

function lastFrame(): Frame {
  const scenario = scenarios.find((each) => each.id === "long-chat");
  const frame = scenario
    ? buildFrames(scenario.script, Date.now() - 60_000).at(-1)
    : undefined;
  if (!frame) {
    throw new Error("no long-chat frame");
  }
  return frame;
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

const firstWorked = () =>
  document.querySelector<HTMLElement>('[data-transcript-row^="worked:"]');

it("keeps a Worked row open through its turn being drawn as a box", async () => {
  const frame = lastFrame();
  const messages = frame.messages.flatMap((message): TranscriptMessage[] => {
    const light = transcriptMessage(message);
    return light ? [light] : [];
  });
  const sessionId = frame.messages[0]?.metadata.sessionId;
  if (!sessionId) {
    throw new Error("no session");
  }
  await renderInBrowser(
    <TranscriptSurfaceContext value={SURFACE}>
      <TranscriptRecordsContext
        value={transcriptRecords({
          parts: frame.messages.flatMap((message) => message.parts),
        })}
      >
        <MessageScrollerProvider autoScroll>
          <MessageScroller style={{ height: 600, width: 640 }}>
            <MessageScrollerViewport>
              <MessageScrollerContent>
                <Transcript
                  chatId={ChatIdSchema.parse("kept-open")}
                  isRunning={false}
                  messages={messages}
                  onRetry={noop}
                  sessionId={sessionId}
                />
              </MessageScrollerContent>
            </MessageScrollerViewport>
          </MessageScroller>
        </MessageScrollerProvider>
      </TranscriptRecordsContext>
    </TranscriptSurfaceContext>,
  );
  const isBox = (turn: string) =>
    document
      .querySelector(`[data-turn-id="${turn}"]`)
      ?.hasAttribute("data-placeholder");
  // Opened at its end, with the first turn far up.
  await expect
    .poll(() => document.querySelector("[data-placeholder]"))
    .not.toBeNull();

  scrollTo(0);
  await expect.poll(firstWorked).not.toBeNull();
  const turn =
    firstWorked()?.closest<HTMLElement>("[data-turn-id]")?.dataset.turnId;
  if (!turn) {
    throw new Error("no first turn");
  }
  firstWorked()?.querySelector("button")?.click();
  await expect
    .poll(() => firstWorked()?.querySelector("button")?.ariaExpanded)
    .toBe("true");

  scrollTo(viewport().scrollHeight);
  await expect.poll(() => isBox(turn)).toBe(true);
  expect(firstWorked()?.closest(`[data-turn-id="${turn}"]`)).toBeFalsy();

  scrollTo(0);
  await expect.poll(() => isBox(turn)).toBe(false);
  expect(
    document.querySelector(
      `[data-turn-id="${turn}"] [data-transcript-row^="worked:"] button`,
    )?.ariaExpanded,
  ).toBe("true");
});
