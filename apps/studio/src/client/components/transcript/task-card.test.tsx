import { type RPCOutput } from "@/client/rpc/client";
import { renderWithProviders } from "@/tests/render";
import { transcriptRecords } from "@/tests/transcript-records";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskCardRow } from "./task-card";
import { TranscriptRecordsContext } from "./transcript-data";

type ChildTask = RPCOutput["workspace"]["chats"]["tasks"][number];

const NOW = new Date("2026-11-08T09:51:00Z");
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000);

const sessionId = StoreId.newSessionId();
const assignment = StoreId.newMessageId();
const sent = StoreId.newMessageId();

/** A task that finished one run, then was sent more work 40 seconds ago. */
const resumed = (working: boolean): ChildTask => ({
  chatId: ChatIdSchema.parse("pricing-chat"),
  createdAt: minutesAgo(39),
  handle: "t1",
  id: sessionId,
  slices: [
    {
      endedAt: minutesAgo(36),
      from: assignment,
      line: "Noted every tier on three pricing pages",
      startedAt: minutesAgo(39),
    },
    {
      endedAt: working ? NOW : new Date(NOW.getTime() + 20_000),
      from: sent,
      startedAt: new Date(NOW.getTime() - 40_000),
      ...(!working && { line: "Compared this year's tiers with last year's" }),
    },
  ],
  status: working
    ? { kind: "running", line: "Reading 2025 plans" }
    : {
        kind: "done",
        line: "Zendesk raised its mid tier.",
        summary: "Compared this year's tiers with last year's",
      },
  step: "Reading 2025 plans",
  stoppable: working,
  title: "Pricing",
  updatedAt: NOW,
  working,
});

/** The first card, from `task new` 39 minutes ago, and the bottom one, from `task send`. */
function renderBoth(task: ChildTask) {
  renderWithProviders(
    <TranscriptRecordsContext value={transcriptRecords({ tasks: [task] })}>
      <div data-testid="first">
        <TaskCardRow sessionId={sessionId} startedAt={minutesAgo(39)} />
      </div>
      <div data-testid="bottom">
        <TaskCardRow
          from={sent}
          sessionId={sessionId}
          startedAt={new Date(NOW.getTime() - 41_000)}
        />
      </div>
    </TranscriptRecordsContext>,
  );
  return {
    bottom: screen.getByTestId("bottom").textContent,
    first: screen.getByTestId("first").textContent,
  };
}

describe("TaskCardRow for a task sent more work", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("works at the bottom from the delivered message, leaving the first card as it ended", () => {
    expect(renderBoth(resumed(true))).toStrictEqual({
      bottom: "Reading 2025 plansTask · Pricing · 40s",
      first: "Noted every tier on three pricing pagesTask · Pricing · 3 min",
    });
  });

  it("settles the bottom card on its own run's line and time", () => {
    expect(renderBoth(resumed(false))).toStrictEqual({
      bottom:
        "Compared this year's tiers with last year'sTask · Pricing · 1 min",
      first: "Noted every tier on three pricing pagesTask · Pricing · 3 min",
    });
  });

  it("shows the bottom card starting, timed from its call, while the list has not read the send yet", () => {
    const finished = resumed(false);
    const before = {
      ...finished,
      slices: finished.slices.slice(0, 1),
      status: { kind: "done" as const, line: "Our Team plan is 18% under." },
    };
    expect(renderBoth(before)).toStrictEqual({
      bottom: "StartingTask · Pricing · 41s",
      first: "Our Team plan is 18% under.Task · Pricing · 3 min",
    });
  });

  it("leaves the check off a first card the chat sent on from mid-step", () => {
    const glyphsOnFirst = (task: ChildTask) => {
      renderBoth(task);
      const count = screen.getByTestId("first").querySelectorAll("svg").length;
      document.body.innerHTML = "";
      return count;
    };
    const busy = resumed(true);
    const [first, ...rest] = busy.slices;
    expect({
      finished: glyphsOnFirst(busy),
      handedOn: glyphsOnFirst({
        ...busy,
        slices: first ? [{ ...first, handedOn: true }, ...rest] : rest,
      }),
    }).toStrictEqual({ finished: 1, handedOn: 0 });
  });
});
