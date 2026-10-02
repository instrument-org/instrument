import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/client/components/ui/message-scroller";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { TranscriptEdgeOverlay } from "./transcript-edge";
import { useTranscriptEdge } from "./use-transcript-edge";

/**
 * The one thing on the playback page that reads the rendered result rather than
 * the rules that produced it, so jsdom can say nothing about whether it works:
 * with no layout engine every box is zero tall and every measurement agrees
 * with every other. A real browser is the only place the numbers are numbers.
 */
function Harness({
  anchored = false,
  rowsPerFrame,
}: {
  /** Draw the rows as turns the scroller can anchor, the way the app does. */
  anchored?: boolean;
  rowsPerFrame: number[];
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const edge = useTranscriptEdge({ frameRef: frame, index });
  const rows = rowsPerFrame[index] ?? 0;

  return (
    <div className="flex h-64 w-96 flex-col">
      <button
        onClick={() => {
          setIndex((current) => current + 1);
        }}
        type="button"
      >
        step
      </button>
      <div className="relative min-h-0 flex-1" ref={frame}>
        {edge && <TranscriptEdgeOverlay edge={edge} />}
        <MessageScrollerProvider autoScroll defaultScrollPosition="end">
          <MessageScroller className="min-h-0 flex-1">
            <MessageScrollerViewport>
              <MessageScrollerContent className="gap-2 p-4 pb-8">
                {Array.from({ length: rows }, (_, row) =>
                  anchored ? (
                    <MessageScrollerItem
                      className="h-10"
                      key={row}
                      messageId={`row-${row.toString()}`}
                      scrollAnchor
                    >
                      row {row}
                    </MessageScrollerItem>
                  ) : (
                    <div className="h-10" key={row}>
                      row {row}
                    </div>
                  ),
                )}
              </MessageScrollerContent>
            </MessageScrollerViewport>
          </MessageScroller>
        </MessageScrollerProvider>
      </div>
      <output data-testid="edge">
        {edge
          ? `${edge.contentHeight.toString()}|${edge.delta ?? "-"}`
          : "none"}
      </output>
    </div>
  );
}

const readEdge = (screen: Awaited<ReturnType<typeof render>>) => {
  const [height, delta] = screen
    .getByTestId("edge")
    .element()
    .textContent.split("|");
  return { delta, height: Number(height) };
};

describe("the transcript's bottom edge", () => {
  // Three 40px rows and two 8px gaps between them: the padding under them is
  // the frame's, so it is not part of what the transcript drew.
  it("measures what the transcript drew, and not the frame's padding", async () => {
    const screen = await render(<Harness rowsPerFrame={[3]} />);

    await expect.poll(() => readEdge(screen).height).toBe(40 * 3 + 8 * 2);
  });

  it("reports nothing for the first frame, having nothing to compare it to", async () => {
    const screen = await render(<Harness rowsPerFrame={[3, 4]} />);

    await expect.poll(() => readEdge(screen).delta).toBe("-");
  });

  // The reason it exists: a frame that draws less than the one before it is
  // what pulls the whole column down while the transcript holds its end in
  // place, and that is invisible while it happens.
  it("reports a frame that drew less than the one before it", async () => {
    const screen = await render(<Harness rowsPerFrame={[4, 3]} />);
    await expect.poll(() => readEdge(screen).height).toBe(40 * 4 + 8 * 3);

    await screen.getByRole("button", { name: "step" }).click();

    await expect.poll(() => readEdge(screen).delta).toBe("-48");
  });

  // Anchoring a turn to the top of the reading line means reserving the room
  // below it to get there, and the scroller reserves that room inside the
  // content box. It is the scroller's, not the transcript's, and counting it
  // would put the end of the transcript below the last row it drew.
  it("ignores the room the scroller reserves under an anchored turn", async () => {
    const screen = await render(<Harness anchored rowsPerFrame={[2, 3]} />);
    await expect.poll(() => readEdge(screen).height).toBe(40 * 2 + 8);

    await screen.getByRole("button", { name: "step" }).click();

    await expect.poll(() => readEdge(screen).height).toBe(40 * 3 + 8 * 2);
    expect(readEdge(screen).delta).toBe("48");
  });
});
