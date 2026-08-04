import "@/client/styles/globals.css";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { ModelContextDebugCard } from "./model-context-debug-card";
import { TooltipProvider } from "./ui/tooltip";

// A clamped note fades its last visible line and turns the card into a
// click-to-expand target, and it should do that exactly when it is cutting text
// off. Deciding that means comparing the note's height against the clamp, which
// is a measurement: jsdom reports every height as 0, so a test there passes
// whichever number the component measures against.
//
// So none of this asserts a pixel height. Each case asks the rendered note
// whether it is clipping anything and requires the affordance to agree, which
// keeps holding if the clamp is ever retuned.

// One line of copy per line of text, so a case's height follows its line count
// instead of where the words happen to wrap.
const lines = (count: number) =>
  Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");

async function renderCard(text: string) {
  await render(
    // Radix throws without one, and a test rendering a single component is the
    // app root it is asking for.
    <TooltipProvider>
      {/* The card fills its parent, so the parent needs a width before any of
          it can be measured. */}
      <div style={{ width: 600 }}>
        <ModelContextDebugCard text={text} />
      </div>
    </TooltipProvider>,
  );

  const note = document.querySelector<HTMLElement>(
    '[data-slot="model-context-debug-card-note"]',
  );
  if (!note) {
    throw new Error("the card rendered without its note element");
  }
  const expandTarget = () =>
    document.querySelector<HTMLElement>(
      '[data-slot="model-context-debug-card-expand"]',
    );
  return {
    expand: () => expandTarget()?.click(),
    hasExpandTarget: () => expandTarget() !== null,
    isClipped: () => note.scrollHeight > note.clientHeight,
  };
}

describe("ModelContextDebugCard in a browser", () => {
  // Three lines is the clamp itself and twelve overruns it by plenty; the ones
  // around three are where a note is taller than one candidate clamp and
  // shorter than another.
  it.each([1, 2, 3, 4, 5, 12])(
    "offers to expand a %i-line note only when it is cut off",
    async (lineCount) => {
      const card = await renderCard(lines(lineCount));

      // The overflow check runs in an effect, so give it a frame to land.
      await expect.poll(() => card.hasExpandTarget()).toBe(card.isClipped());
    },
  );

  it("leaves a note that already fits as it is", async () => {
    const card = await renderCard(lines(1));

    await expect.poll(() => card.isClipped()).toBe(false);
    expect(card.hasExpandTarget()).toBe(false);
  });

  it("shows the whole note once expanded", async () => {
    const card = await renderCard(lines(12));

    await expect.poll(() => card.hasExpandTarget()).toBe(true);
    card.expand();

    await expect.poll(() => card.isClipped()).toBe(false);
    expect(card.hasExpandTarget()).toBe(false);
  });
});
