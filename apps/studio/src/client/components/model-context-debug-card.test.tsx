import { renderWithProviders } from "@/tests/render";
import { describe, expect, it } from "vitest";

import { ModelContextDebugCard } from "./model-context-debug-card";
import { TooltipProvider } from "./ui/tooltip";

// What the model receives, verbatim: the tag, and the blank line the wrapper
// leaves above it.
const NOTE = `
<instrument-system-note>
The previous run stopped after reaching the maximum of 200 unattended steps.
</instrument-system-note>`;

function renderCard(text: string) {
  renderWithProviders(
    // Radix throws without one, and a test rendering a single component is the
    // app root it is asking for.
    // eslint-disable-next-line no-restricted-syntax -- see above
    <TooltipProvider>
      <ModelContextDebugCard text={text} />
    </TooltipProvider>,
  );

  return document.querySelector('[data-slot="model-context-debug-card-note"]');
}

describe("ModelContextDebugCard", () => {
  it("draws the note's prose without the harness markup around it", () => {
    expect(renderCard(NOTE)?.textContent).toBe(
      "The previous run stopped after reaching the maximum of 200 unattended steps.",
    );
  });

  it("draws text that was never wrapped in a note unchanged", () => {
    expect(renderCard("Skills mentioned: pdf")?.textContent).toBe(
      "Skills mentioned: pdf",
    );
  });
});
