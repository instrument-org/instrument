import { renderWithProviders } from "@/tests/render";
import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ModelChangeNote } from "./model-change-note";

function change(
  from: SessionMessageDataPart.ModelChangeDataPart["from"],
  to: SessionMessageDataPart.ModelChangeDataPart["to"],
): SessionMessageDataPart.ModelChangeDataPart {
  return { from, to };
}

function noteText() {
  return screen.getByText(/Switched from/).textContent;
}

describe("ModelChangeNote", () => {
  it("names both models", () => {
    renderWithProviders(
      <ModelChangeNote
        data={change(
          { modelId: "auto", name: "Auto" },
          { modelId: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
        )}
      />,
    );

    expect(noteText()).toBe("Switched from Auto to Gemini 3.1 Pro Preview");
  });

  // The gateway hands these names over with a leading space, so an untrimmed
  // note reads "from  Auto to  Gemini" with the gap visible mid-sentence.
  it("trims the padding the gateway puts on a model name", () => {
    renderWithProviders(
      <ModelChangeNote
        data={change(
          { modelId: "auto", name: " Auto" },
          { modelId: "gpt-5.6-luna", name: " GPT-5.6 Luna" },
        )}
      />,
    );

    expect(noteText()).toBe("Switched from Auto to GPT-5.6 Luna");
  });

  it("draws each side with its provider's mark rather than its name", () => {
    const { container } = renderWithProviders(
      <ModelChangeNote
        data={change(
          {
            modelId: "auto",
            name: "Auto",
            provider: "instrument",
            providerName: "Instrument",
          },
          {
            modelId: "gpt-6.1-sol",
            name: "GPT-6.1 Sol",
            provider: "chatgpt-account",
            providerName: "ChatGPT account",
          },
        )}
      />,
    );

    expect(noteText()).toBe("Switched from Auto to GPT-6.1 Sol");
    expect(container.querySelectorAll("svg")).toHaveLength(2);
  });

  it("names a side from its id when no name was recorded", () => {
    renderWithProviders(
      <ModelChangeNote
        data={change(
          { modelId: "anthropic/claude-haiku-5.5" },
          { modelId: "auto" },
        )}
      />,
    );

    expect(noteText()).toBe("Switched from Claude Haiku 5.5 to Auto");
  });

  it("names a side from its id when the name is only whitespace", () => {
    renderWithProviders(
      <ModelChangeNote
        data={change(
          { modelId: "older-model", name: "   " },
          { modelId: "auto", name: "Auto" },
        )}
      />,
    );

    expect(noteText()).toBe("Switched from Older Model to Auto");
  });
});
