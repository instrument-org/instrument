import { renderWithProviders } from "@/tests/render";
import {
  type ActivityRow,
  ChatIdSchema,
  StoreId,
  SUMMARIZING_LINE,
  type TurnStep,
} from "@instrument-org/workspace/client";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ActivityRowView, FoldedActivityView, RowLine } from "./activity-row";

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

describe("ActivityRowView", () => {
  it.each([
    [
      "Writing the scraper",
      "Building the scraper",
      "Writing the scraper · 48 lines",
    ],
    [undefined, "Building the scraper", "Creating a file · 48 lines"],
    [undefined, undefined, "48 lines"],
  ])(
    "says how far a file with no card to watch it on has got (%s, %s)",
    (explanation, title, detail) => {
      const { explanation: _, ...unexplained } = call("");
      const writing: TurnStep = {
        ...(explanation === undefined ? unexplained : call(explanation)),
        shows: { kind: "file", lines: 48, path: "/w/scrape.py" },
        status: "writing",
        tool: "tool-write_file",
      };
      renderWithProviders(
        <ActivityRowView
          chatId={chatId}
          isLive
          row={activity([writing], title)}
        />,
      );
      expect(screen.getByText(detail)).toBeTruthy();
    },
  );

  it("says a summary is being written between calls, over the last call's words", () => {
    renderWithProviders(
      <ActivityRowView
        chatId={chatId}
        isLive
        isSummarizing
        row={activity(
          [call("Opening the plan sheet")],
          "Reading your plan sheet",
        )}
      />,
    );
    expect(screen.getByText(SUMMARIZING_LINE)).toBeTruthy();
    expect(screen.queryByText("Opening the plan sheet")).toBeNull();
  });
});

describe("ActivityRowView", () => {
  const blocked = (inSettings: boolean): TurnStep => ({
    ...call("Opening the Taxes folder"),
    blocked: {
      ...(inSettings && { inSettings: true }),
      why: "Taxes is set to Not allowed in Settings.",
    },
    couldnt: "Couldn't open Taxes",
    status: "failed",
    tool: "tool-ask_permission",
  });

  it("opens by itself to what blocked it, and closes", () => {
    renderWithProviders(
      <ActivityRowView
        chatId={chatId}
        isLive={false}
        row={{
          ...activity(
            [call("Looking for receipts"), blocked(true)],
            "Finding the receipts",
          ),
          endsBlocked: true,
        }}
      />,
    );
    expect(screen.getByText("Couldn't open Taxes")).toBeTruthy();
    expect(screen.getByText("Taxes is set to Not allowed in Settings.")).toBeTruthy();
    expect(screen.getByText("Open Permissions")).toBeTruthy();

    fireEvent.click(screen.getByText("Finding the receipts"));
    expect(screen.queryByText("Couldn't open Taxes")).toBeNull();
  });

  it("stays closed when the work went on, and offers no setting that isn't the reason", () => {
    renderWithProviders(
      <ActivityRowView
        chatId={chatId}
        isLive={false}
        row={activity([blocked(false)], "Finding the receipts")}
      />,
    );
    expect(screen.queryByText("Couldn't open Taxes")).toBeNull();

    fireEvent.click(screen.getByText("Finding the receipts"));
    fireEvent.click(screen.getByText("Couldn't open Taxes"));
    expect(screen.getByText("Taxes is set to Not allowed in Settings.")).toBeTruthy();
    expect(screen.queryByText("Open Permissions")).toBeNull();
  });
});
