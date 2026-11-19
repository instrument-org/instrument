// A turn played frame by frame through the real transcript, so the holds that
// keep rows back behind a reply still coming out and a step still folding are
// read from what the browser drew. jsdom has no layout and no animation frames.
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

import { expect, it, vi } from "vitest";

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

const CHAT = ChatIdSchema.parse("turn-hold");

/** How long a row takes to open, with a frame to spare. */
const OPENS_MS = 300;

function lightMessages(frame: Frame): TranscriptMessage[] {
  return frame.messages.flatMap((message) => {
    const light = transcriptMessage(message);
    return light ? [light] : [];
  });
}

function framesOf(id: string): Frame[] {
  const scenario = scenarios.find((each) => each.id === id);
  if (!scenario) {
    throw new Error(`no scenario ${id}`);
  }
  return buildFrames(scenario.script, Date.now() - 60_000);
}

const noop = () => undefined;

/** A page's picture, as tall as a real one, so a work card takes its room. */
const SURFACE: TranscriptSurface = {
  onOpenFile: noop,
  onOpenTask: noop,
  onOpenUrl: noop,
  onStopCommand: noop,
  onStopTask: noop,
  PagePicture: () => <div style={{ height: 240 }} />,
};

/** The scenario at the frame "next" has moved it to. */
function Harness({ frames, stage }: { frames: Frame[]; stage: Stage }) {
  const [index, setIndex] = useState(0);
  const frame = frames[Math.min(index, frames.length - 1)];
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
        <TranscriptRecordsContext
          value={transcriptRecords({
            parts: frame?.messages.flatMap((message) => message.parts) ?? [],
          })}
        >
          <MessageScrollerProvider autoScroll>
            <MessageScroller style={{ height: 600, width: 640 }}>
              <MessageScrollerViewport>
                <MessageScrollerContent>
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

/** The words of every reply row on screen, in order. */
const replies = () =>
  [...document.querySelectorAll("[data-reply-row]")].map((row) =>
    (row.textContent ?? "").trim(),
  );

it("writes out a reply whose next step ends while it is still coming out", async () => {
  const frames = framesOf("narrated-browsing");
  // The clock moves only when the test moves it.
  const stage = new Stage();
  stage.setRate(0);
  const screen = await renderInBrowser(
    <Harness frames={frames} stage={stage} />,
  );
  const next = screen.getByRole("button", { name: "next" });
  const playTo = async (index: number) => {
    while (shown < index) {
      await next.click();
      shown += 1;
    }
  };
  let shown = 0;
  /** Moves the clock on by `ms`, a frame at a time, letting React draw each. */
  const run = async (ms: number) => {
    for (let left = ms; left > 0; left -= 50) {
      stage.step(Math.min(left, 50));
      await new Promise(requestAnimationFrame);
    }
  };
  const at = (text: string) =>
    frames.findIndex((frame) =>
      frame.messages.some((message) =>
        message.parts.some(
          (part) =>
            part.type === "text" &&
            part.text === text &&
            part.state !== "streaming",
        ),
      ),
    );

  // The first step ends with a reply under it, which waits for its line to
  // fold, then starts to come out.
  await playTo(at("Now the destination."));
  expect(replies()).toEqual([]);
  await run(340);
  await vi.waitFor(() => {
    expect(replies()).toHaveLength(1);
  });
  expect(replies()[0]).not.toBe("Now the destination.");

  // The next step starts and ends, with a reply of its own, while the first
  // is still on its way out.
  await playTo(at("And the date."));
  await run(3000);
  await vi.waitFor(() => {
    expect(replies()).toEqual(["Now the destination.", "And the date."]);
  });
});

it("shows a turn's answer when it folds while a reply above is still held", async () => {
  const frames = framesOf("narrated-browsing");
  // A window out of sight paints no frames, so its clock stands still while
  // the turn runs to its end and folds on its timer.
  const stage = new Stage();
  stage.setRate(0);
  const screen = await renderInBrowser(
    <Harness frames={frames} stage={stage} />,
  );
  const next = screen.getByRole("button", { name: "next" });
  for (let index = 1; index < frames.length; index += 1) {
    await next.click();
  }
  await expect
    .poll(() => document.querySelector("[data-transcript-row^=worked]"))
    .not.toBeNull();
  // Back in sight, the clock runs again.
  for (let left = 3000; left > 0; left -= 50) {
    stage.step(50);
    await new Promise(requestAnimationFrame);
  }
  await vi.waitFor(() => {
    expect(replies().at(-1)).toMatch(/^The cheapest is \$412 on TAP/);
  });
});

/**
 * The scenario with the agent read as stopped for one frame while a step
 * works, as a recorded chat reads between a message that ended and the next:
 * the step stops being live and starts again at the same row.
 */
function withBlip(frames: Frame[], before: string): Frame[] {
  const reply = frames.findIndex((frame) =>
    frame.messages.some((message) =>
      message.parts.some(
        (part) => part.type === "text" && part.text.startsWith(before),
      ),
    ),
  );
  const at = reply - 3;
  const blip = frames[at];
  if (!blip) {
    throw new Error(`no frame before ${before}`);
  }
  return [
    ...frames.slice(0, at + 1),
    { ...blip, isAgentRunning: false },
    ...frames.slice(at + 1),
  ];
}

it.each([
  { frames: () => framesOf("narrated-browsing"), name: "narrated-browsing" },
  {
    frames: () => framesOf("card-between-activities"),
    name: "card-between-activities",
  },
  { frames: () => framesOf("failures"), name: "failures" },
  { frames: () => framesOf("task"), name: "task" },
  {
    frames: () => withBlip(framesOf("narrated-browsing"), "And the date."),
    name: "narrated-browsing stopping for a frame mid-step",
  },
])(
  "never moves a row of $name once it has opened, while the turn is working",
  async ({ frames: framesOfCase }) => {
    const frames = framesOfCase();
    const stage = new Stage();
    stage.setRate(0);
    const screen = await renderInBrowser(
      <Harness frames={frames} stage={stage} />,
    );
    const next = screen.getByRole("button", { name: "next" });
    // Where each row came to rest, and when it first showed: a row other than
    // a reply slides a few pixels into place as the gap above it opens, which
    // is its own entrance, and from then on nothing may move it.
    const rests = new Map<string, { at: number; top: number }>();
    const moves: string[] = [];
    const look = () => {
      const content = document.querySelector(
        "[data-transcript-row]",
      )?.parentElement;
      const origin = content?.getBoundingClientRect().top ?? 0;
      for (const row of document.querySelectorAll("[data-transcript-row]")) {
        const key = row.getAttribute("data-transcript-row") ?? "";
        const top = Math.round(row.getBoundingClientRect().top - origin);
        const rest = rests.get(key);
        // Words open in place, so a reply has no entrance of its own.
        const opens = row.querySelector("[data-reply-row]") === null;
        if (!rest || (opens && stage.now() - rest.at < OPENS_MS)) {
          rests.set(key, { at: rest?.at ?? stage.now(), top });
        } else if (Math.abs(rest.top - top) > 1) {
          moves.push(`${key} ${rest.top.toString()} -> ${top.toString()}`);
          rest.top = top;
        }
      }
    };
    for (const index of frames.keys()) {
      if (index > 0) {
        await next.click();
      }
      // The turn's end folds it, which is the one move left to it.
      if (frames.slice(index).every((each) => !each.isAgentRunning)) {
        break;
      }
      for (let tick = 0; tick < 6; tick += 1) {
        stage.step(50);
        await new Promise(requestAnimationFrame);
        look();
      }
    }
    expect(moves).toEqual([]);
  },
);
