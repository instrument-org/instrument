import { renderWithProviders } from "@/tests/render";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ContextRolloverNote } from "./context-rollover-note";

function noteText() {
  return screen.queryByText(/Continued in a new context window/)?.textContent;
}

describe("ContextRolloverNote", () => {
  it.each([
    {
      name: "one carried message reads as one",
      retainedUserMessages: 1,
      text: "Continued in a new context window, 1 of your messages carried forward",
    },
    {
      name: "several carried messages read as several",
      retainedUserMessages: 4,
      text: "Continued in a new context window, 4 of your messages carried forward",
    },
    {
      // The floor that makes a rollover worth doing counts model turns, not
      // user ones, so a reset carrying nothing the user wrote is reachable.
      // Naming a count of zero would read as a bug rather than as a boundary.
      name: "carrying nothing says only that the window reset",
      retainedUserMessages: 0,
      text: "Continued in a new context window",
    },
  ])("$name", ({ retainedUserMessages, text }) => {
    renderWithProviders(
      <ContextRolloverNote
        data={{ droppedMessages: 12, retainedUserMessages }}
      />,
    );

    expect(noteText()).toBe(text);
  });
});
