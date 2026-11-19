// A turn played to its end through the real transcript and scroller, so the
// answer's place on screen while the turn folds into its Worked row is read
// from what the browser drew. jsdom has no layout and no scrolling.
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
import { useState } from "react";

import { expect, it } from "vitest";

import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "../ui/message-scroller";
import { Stage } from "./stage/stage";
import { StageContext } from "./stage/stage-context";
import { type TranscriptSurface, TranscriptSurfaceContext } from "./surface";
import { Transcript } from "./transcript";
import { TranscriptRecordsContext } from "./transcript-data";

const CHAT = ChatIdSchema.parse("turn-fold-pin");

const noop = () => undefined;

const SURFACE: TranscriptSurface = {
  onOpenFile: noop,
  onOpenTask: noop,
  onOpenUrl: noop,
  onStopCommand: noop,
  onStopTask: noop,
  PagePicture: () => <div style={{ height: 240 }} />,
};

function framesOf(id: string): Frame[] {
  const scenario = scenarios.find((each) => each.id === id);
  if (!scenario) {
    throw new Error(`no scenario ${id}`);
  }
  // Ended long enough ago that the turn folds as soon as it ends.
  return buildFrames(scenario.script, Date.now() - 60_000);
}

function lightMessages(frame: Frame): TranscriptMessage[] {
  return frame.messages.flatMap((message) => {
    const light = transcriptMessage(message);
    return light ? [light] : [];
  });
}

/**
 * The chat so far above the scenario, so its message arrives as a send and
 * the scroller anchors it, with room above to scroll the fold away into.
 */
function Harness({
  frames,
  height,
  stage,
}: {
  frames: Frame[];
  height: number;
  stage: Stage;
}) {
  const [index, setIndex] = useState(-1);
  const frame =
    index < 0 ? undefined : frames[Math.min(index, frames.length - 1)];
  const sessionId = frame?.messages[0]?.metadata.sessionId;
  return (
    <StageContext value={stage}>
      <TranscriptSurfaceContext value={SURFACE}>
        <button
          onClick={() => {
            setIndex((current) => current + 1);
          }}
          type="button"
        >
          next
        </button>
        <button
          onClick={() => {
            setIndex(frames.length - 1);
          }}
          type="button"
        >
          end
        </button>
        <TranscriptRecordsContext
          value={transcriptRecords({
            parts: frame?.messages.flatMap((message) => message.parts) ?? [],
          })}
        >
          <MessageScrollerProvider autoScroll>
            <MessageScroller style={{ height, width: 640 }}>
              <MessageScrollerViewport>
                <MessageScrollerContent>
                  <div data-earlier style={{ height: 2000 }} />
                  {frame && sessionId && (
                    <Transcript
                      chatId={CHAT}
                      isRunning={frame.isAgentRunning}
                      messages={lightMessages(frame)}
                      onRetry={noop}
                      sessionId={sessionId}
                    />
                  )}
                </MessageScrollerContent>
              </MessageScrollerViewport>
            </MessageScroller>
          </MessageScrollerProvider>
        </TranscriptRecordsContext>
      </TranscriptSurfaceContext>
    </StageContext>
  );
}

it.each([
  {
    answer: /^The cheapest is \$412 on TAP/,
    id: "narrated-browsing",
    isWhole: false,
  },
  { answer: /^It's saved/, id: "card-between-activities", isWhole: false },
  // The answer and the turn's end in one render, as a replay at speed has them.
  { answer: /^It's saved/, id: "card-between-activities", isWhole: true },
])(
  "keeps the answer of $id where it is on screen as the turn folds (whole: $isWhole)",
  async ({ answer, id, isWhole }) => {
    const frames = framesOf(id);
    const stage = new Stage();
    stage.setRate(0);
    const screen = await renderInBrowser(
      <Harness frames={frames} height={1100} stage={stage} />,
    );
    const next = screen.getByRole("button", { name: "next" });
    const viewport = () =>
      document.querySelector<HTMLElement>("[aria-label=Messages]");
    /** The answer's top below the viewport's top, as drawn. */
    const answerTop = () => {
      const row = [...document.querySelectorAll("[data-reply-row]")]
        .find((each) => answer.test((each.textContent ?? "").trim()))
        ?.closest("[data-transcript-row]");
      const top = viewport()?.getBoundingClientRect().top;
      return row && top !== undefined
        ? row.getBoundingClientRect().top - top
        : undefined;
    };
    const frame = async () => {
      stage.step(50);
      await new Promise(requestAnimationFrame);
    };

    // The earlier chat opens the transcript, and the scenario's message
    // comes as a send.
    await frame();
    const hasAnswer = (each: Frame) =>
      each.messages.some((message) =>
        message.parts.some(
          (part) => part.type === "text" && answer.test(part.text.trim()),
        ),
      );
    const lastWorking = isWhole
      ? frames.findIndex(hasAnswer) - 1
      : frames.findLastIndex((each) => each.isAgentRunning);
    for (let index = 0; index <= lastWorking; index += 1) {
      await next.click();
      for (let tick = 0; tick < 6; tick += 1) {
        await frame();
      }
    }
    // Every word of the answer out, while the turn still works.
    for (let tick = 0; tick < 60; tick += 1) {
      await frame();
    }
    let before = answerTop();
    expect(before !== undefined).toBe(!isWhole);
    expect(viewport()?.dataset.scrollMode).toBe("anchor");

    // The turn ends and folds; the answer stays put in every frame drawn,
    // read once the frame is painted.
    const tops: number[] = [];
    if (isWhole) {
      await screen.getByRole("button", { name: "end" }).click();
    }
    for (
      let index = lastWorking + 1;
      !isWhole && index < frames.length;
      index += 1
    ) {
      await next.click();
    }
    for (let tick = 0; tick < 40; tick += 1) {
      stage.step(50);
      await new Promise((resolve) => {
        requestAnimationFrame(() => setTimeout(resolve));
      });
      const top = answerTop();
      if (top !== undefined) {
        // An answer that came with the end is held from where it was first drawn.
        before ??= top;
        tops.push(Math.round(top));
      }
    }
    expect(document.querySelector("[data-transcript-row^=worked]")).not.toBe(
      null,
    );
    expect(tops.length).toBeGreaterThan(0);
    const moved = tops.filter((top) => Math.abs(top - (before ?? 0)) > 1);
    expect(moved).toEqual([]);
  },
);
