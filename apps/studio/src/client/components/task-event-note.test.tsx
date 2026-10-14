import { renderWithProviders } from "@/tests/render";
import { type StoreId } from "@instrument-org/workspace/client";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TaskEventNote } from "./task-event-note";

const SESSION = "ses_01K4M7V0A7T2B9S6QH4Z3X1C5D" as StoreId.Session;

describe("TaskEventNote", () => {
  it.each([
    { event: { status: "done" as const }, text: "Finished: Audit the vault" },
    {
      event: { status: "done" as const, stoppedBy: "user" as const },
      text: "You stopped: Audit the vault",
    },
    {
      event: {
        needs: ["folder: ~/Documents/Pantry, on the card in this chat"],
        status: "done" as const,
      },
      text: "Waiting on you: Audit the vault",
    },
    {
      event: { status: "done" as const, stoppedBy: "app" as const },
      text: "Interrupted when the app closed: Audit the vault",
    },
  ])("says $text", ({ event, text }) => {
    renderWithProviders(
      <TaskEventNote
        data={{
          events: [{ ...event, sessionId: SESSION, title: "Audit the vault" }],
        }}
      />,
    );
    expect(screen.getByText(text)).toBeTruthy();
  });
});
