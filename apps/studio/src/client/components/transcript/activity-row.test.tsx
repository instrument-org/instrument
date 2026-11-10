import { renderWithProviders } from "@/tests/render";
import {
  type ActivityRow,
  ChatIdSchema,
  StoreId,
  type TurnStep,
} from "@instrument-org/workspace/client";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FoldedActivityView, RowLine } from "./activity-row";

// jsdom runs no animation and never delivers `animationend` to React, so what
// it sees is the sweep's class going on for a changed label.
describe("RowLine", () => {
  it("sweeps a changed label in", () => {
    const { rerender } = renderWithProviders(
      <RowLine label="Worked for 12s" mark={null} sweepsIn />,
    );
    expect(screen.getByText("Worked for 12s").className).not.toContain(
      "title-arrival",
    );

    rerender(<RowLine label="Read 3 files" mark={null} sweepsIn />);
    expect(screen.getByText("Read 3 files").className).toContain(
      "title-arrival",
    );
    expect(screen.queryByText("Worked for 12s")).toBeNull();
  });

  it("changes a label outright without sweepsIn", () => {
    const { rerender } = renderWithProviders(
      <RowLine label="One" mark={null} />,
    );
    rerender(<RowLine label="Two" mark={null} />);
    expect(screen.getByText("Two").className).not.toContain("title-arrival");
  });
});

const chatId = ChatIdSchema.parse("2026-11-10-help-desk-pricing");

const call = (explanation: string): TurnStep => ({
  explanation,
  metadata: {
    createdAt: new Date("2026-11-10T12:00:00Z"),
    id: StoreId.newPartId(),
    messageId: StoreId.newMessageId(),
    sessionId: StoreId.newSessionId(),
  },
  status: "done",
  tool: "tool-bash",
  type: "step",
});

const activity = (steps: TurnStep[], title?: string): ActivityRow => ({
  apps: [],
  counts: [{ count: 3, label: "pages" }],
  id: StoreId.newPartId(),
  kind: "activity",
  sites: [],
  startedAt: new Date("2026-11-10T12:00:00Z"),
  steps,
  ...(title !== undefined && { title }),
});

describe("FoldedActivityView", () => {
  it("lists an activity's calls under its name without opening it", () => {
    renderWithProviders(
      <FoldedActivityView
        chatId={chatId}
        row={activity(
          [call("Opening Zendesk's pricing page"), call("Opening Intercom's")],
          "Checking competitors' list prices",
        )}
      />,
    );
    expect(screen.getByText("Checking competitors' list prices")).toBeTruthy();
    expect(screen.getByText("· 3 pages")).toBeTruthy();
    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["Opening Zendesk's pricing page", "Opening Intercom's"]);
  });

  it("draws an unnamed run as its calls alone", () => {
    renderWithProviders(
      <FoldedActivityView
        chatId={chatId}
        row={activity([call("Multiplying each plan by ten seats")])}
      />,
    );
    expect(screen.queryByText("· 3 pages")).toBeNull();
    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["Multiplying each plan by ten seats"]);
  });

  it("draws a named activity of one call as that call's row under its name", () => {
    renderWithProviders(
      <FoldedActivityView
        chatId={chatId}
        row={activity(
          [call("Opening the plan sheet")],
          "Reading your plan sheet",
        )}
      />,
    );
    expect(screen.queryByText("· 3 pages")).toBeNull();
    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["Reading your plan sheet"]);
  });
});
