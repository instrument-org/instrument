import { renderInBrowser } from "@/tests/render-browser";
import { StoreId, type TaskId } from "@instrument-org/workspace/client";
import { describe, expect, it, vi } from "vitest";

// The claim here is that the card does not change height as the picture in it
// arrives or fails to, which is a measurement: jsdom has no layout and would
// report every one of these boxes as zero.
import { ToolGenerateImage } from "./tool-generate-image";

const TASK_ID = "quarterly-numbers" as TaskId;

/**
 * What the card takes, which the two fixtures below are written against.
 *
 * They go through `unknown` for the reason [frames.ts](../../routes/_app/debug/-transcript/frames.ts)
 * gives: a tool part is a union of per-tool shapes assembled from several
 * intersections, and narrowing a literal back into one of them takes more
 * scaffolding than the fixture is worth. What the fields have to be is settled
 * by the tool that writes them, and by this file failing if they are wrong.
 */
type Part = Parameters<typeof ToolGenerateImage>[0]["part"];

// Nothing serves assets in a test, so every image here fails to load and the
// card falls back -- which is the state under test, and the state the debug
// transcript is permanently in.
const INPUT = {
  explanation: "Drawing the cover",
  filePath: "./output/cover",
  prompt: "Four quarterly bars in muted ink on paper",
};

/** The tool has finished and written an image the card cannot draw. */
function drawn(): Part {
  return {
    input: INPUT,
    metadata: { ...partMetadata(), endedAt: new Date(2) },
    output: {
      images: [
        {
          filePath: "output/cover.png",
          height: 1024,
          modifiedAt: 0,
          sizeBytes: 1024,
          width: 1024,
        },
      ],
      modelId: "openai/gpt-image-1",
      provider: { displayName: "OpenAI", id: "openai", type: "openai" },
      renamedToAvoidOverwrite: false,
      sourceImages: [],
      state: "success",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    },
    state: "output-available",
    toolCallId: StoreId.ToolCallSchema.parse("call_1"),
    type: "tool-generate_image",
  } as unknown as Part;
}

/** The tool is still drawing. */
function generating(): Part {
  return {
    input: INPUT,
    metadata: partMetadata(),
    state: "input-available",
    toolCallId: StoreId.ToolCallSchema.parse("call_1"),
    type: "tool-generate_image",
  } as unknown as Part;
}

function partMetadata() {
  return {
    createdAt: new Date(0),
    id: StoreId.newPartId(),
    messageId: StoreId.newMessageId(),
    sessionId: StoreId.newSessionId(),
    startedAt: new Date(1),
  };
}

/**
 * The box between one card's header and its details, whatever is in it.
 *
 * Read by position rather than by what it is made of, since the whole question
 * is whether the different things drawn there come out the same size.
 */
function pictureBox(card: Element) {
  // Header, picture, details. Checked rather than assumed, so a card that stops
  // drawing one of them says so instead of quietly measuring another.
  const parts = [...card.children];
  const box = parts[1];
  if (parts.length !== 3 || !box) {
    throw new Error(`a card drew ${parts.length.toString()} rows, not 3`);
  }
  return box;
}

/**
 * Both states at once, at one width.
 *
 * Side by side rather than one render after another, because the comparison is
 * the point: two renders would have to agree about the column they were
 * measured in as well as about the box.
 */
async function renderCards() {
  const rendered = await renderInBrowser(
    <div style={{ width: 420 }}>
      {[generating(), drawn()].map((part, index) => (
        <div data-testid={index === 0 ? "drawing" : "finished"} key={index}>
          <ToolGenerateImage
            assetBaseUrl="http://assets.invalid"
            id={TASK_ID}
            onRetry={vi.fn()}
            part={part}
          />
        </div>
      ))}
    </div>,
  );

  // The fallback only replaces the image once the browser has given up on
  // loading it, so nothing is worth measuring until it has.
  await expect
    .element(rendered.getByText("Image not available"))
    .toBeInTheDocument();

  const at = (testId: string) => {
    const card = rendered.container.querySelector(
      `[data-testid="${testId}"] > *`,
    );
    if (!card) {
      throw new Error(`no card at ${testId}`);
    }
    return card;
  };

  return { drawing: at("drawing"), finished: at("finished") };
}

// Names are kept short on purpose: a failing browser test writes a trace named
// after its own title, and the path it lands at is long enough already that a
// sentence here pushes it past what the filesystem will take -- which fails the
// whole file at the first failure and takes the cases after it down unrun.
describe("the generated image card", () => {
  // The card is on screen for the whole of a generation that runs the better
  // part of a minute, so a resize when it ends lands under a reader looking
  // straight at it, and takes the rest of the transcript down with it.
  it("holds one box from drawing to failing", async () => {
    const { drawing, finished } = await renderCards();

    const whileDrawing = pictureBox(drawing).clientHeight;
    expect(whileDrawing).toBeGreaterThan(0);
    expect(pictureBox(finished).clientHeight).toBe(whileDrawing);
  });

  // The card header already draws the line under the filename, and a fallback
  // carrying a rule of its own doubled it.
  it("draws no rule under the header", async () => {
    const { finished } = await renderCards();
    const box = pictureBox(finished);

    for (const element of [box, ...box.querySelectorAll("*")]) {
      expect(getComputedStyle(element).borderTopWidth).toBe("0px");
    }
  });

  // A file that will not draw is not one the panel can open either, so the
  // frame stops being a control rather than offering a zoom that goes nowhere.
  it("offers no zoom on a missing picture", async () => {
    const { finished } = await renderCards();
    const box = pictureBox(finished);

    expect([
      ...box.querySelectorAll("button"),
      ...(box.matches("button") ? [box] : []),
    ]).toEqual([]);
  });
});
