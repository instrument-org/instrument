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
  return screen.getByText(/Switched model/).textContent ?? "";
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

    expect(noteText()).toBe("Switched model from Auto to Gemini 3.1 Pro Preview");
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

    expect(noteText()).toBe("Switched model from Auto to GPT-5.6 Luna");
  });

  it("falls back to the id when no name was recorded", () => {
    renderWithProviders(
      <ModelChangeNote
        data={change({ modelId: "older-model" }, { modelId: "auto" })}
      />,
    );

    expect(noteText()).toBe("Switched model from older-model to auto");
  });

  it("falls back to the id when the name is only whitespace", () => {
    renderWithProviders(
      <ModelChangeNote
        data={change(
          { modelId: "older-model", name: "   " },
          { modelId: "auto", name: "Auto" },
        )}
      />,
    );

    expect(noteText()).toBe("Switched model from older-model to Auto");
  });
});
