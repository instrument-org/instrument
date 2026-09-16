import { renderInBrowser } from "@/tests/render-browser";
import { StoreId, TaskIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it, vi } from "vitest";

import { ThreadRow } from "./thread-row";
import { type Thread, type Topic } from "./threads";

const sessionId = StoreId.newSessionId();

/** A long ask, so the clamp has something to cut. */
const LONG_ASK =
  "Hey, I'm trying to set up an automation that uses some criteria to determine if the second floor nest thermostat goes into eco mode, and then it could either alert me or even turn it back off. But I need this to only happen if I'm at home at the time and it's earlier in the day than, like, let's say 5 p.m. or so. I think I already have an automation set up for this, but I don't know.";

function thread(
  overrides: Partial<Thread> = {},
  ask = "Guard the Nest eco mode before 5 p.m.",
): Thread {
  const messageId = StoreId.newMessageId();
  return {
    createdAt: new Date(2026, 8, 16, 8, 46).getTime(),
    holds: { apps: [], files: [], sites: [] },
    id: sessionId,
    replyCount: 3,
    root: {
      id: messageId,
      metadata: { createdAt: new Date(2026, 8, 16, 8, 46), sessionId },
      parts: [
        {
          metadata: {
            createdAt: new Date(2026, 8, 16, 8, 46),
            id: StoreId.newPartId(),
            messageId,
            sessionId,
          },
          text: ask,
          type: "text",
        },
      ],
      role: "user",
    },
    runningTasks: [],
    state: "idle",
    title: "Second-floor Nest eco mode guard before 5 p.m.",
    topics: [],
    unread: 0,
    updatedAt: new Date(2026, 8, 16, 9, 11).getTime(),
    ...overrides,
  };
}

const HOUSE: Topic = {
  color: "#0f9d6e",
  createdAt: 1,
  emoji: "🏠",
  id: "house",
  name: "House",
};

async function renderRow(row: Thread, onOpen = vi.fn()) {
  const rendered = await renderInBrowser(
    <div style={{ width: "400px" }}>
      <ThreadRow
        appsBySlug={new Map()}
        onNewTopic={vi.fn()}
        onOpen={onOpen}
        onSetTopics={vi.fn()}
        thread={row}
        topics={[HOUSE]}
      />
    </div>,
  );
  return { ...rendered, onOpen };
}

describe("ThreadRow", () => {
  it("keeps the header on one line however much it carries", async () => {
    const { container } = await renderRow(
      thread({
        holds: {
          apps: ["github", "wakatime"],
          files: ["/task/out/report.md", "/task/out/data.csv", "/task/a.json"],
          sites: ["github.com", "wakatime.com"],
        },
        topics: ["house"],
      }),
    );
    const header = container.querySelector("p");
    if (!header) {
      throw new Error("no header line");
    }
    const title = header.querySelector("span");
    const titleHeight = title?.getBoundingClientRect().height ?? 0;
    // One line of the header's own text, with a little air; two lines would
    // be about double.
    expect(header.getBoundingClientRect().height).toBeLessThan(
      titleHeight * 1.6,
    );
    expect(header.textContent).toContain("3 replies");
    expect(header.textContent).toContain("last reply");
    expect(header.textContent).toContain("report.md");
  });

  it("clamps a long ask to two lines and fades it", async () => {
    const { container } = await renderRow(thread({}, LONG_ASK));
    const ask = container.querySelector(".line-clamp-2");
    if (!ask) {
      throw new Error("no ask");
    }
    expect(ask.scrollHeight).toBeGreaterThan(ask.clientHeight);
    await vi.waitFor(() => {
      expect(ask.className).toContain("mask-b-from");
    });
  });

  it("says where a waiting thread stands in warning, with the question as its peer line", async () => {
    const { container } = await renderRow(
      thread({
        latest: {
          at: Date.now(),
          kind: "question",
          text: "Reuse the old CSR, or generate a new one?",
        },
        state: "waiting",
      }),
    );
    expect(container.textContent).toContain("Needs you");
    expect(container.textContent).toContain("Reuse the old CSR");
    expect(container.querySelector(".bg-warning-500")).not.toBeNull();
    expect(container.querySelector(".bg-brand-500")).toBeNull();
  });

  it("counts unseen replies in brand and marks the row with a dot", async () => {
    const { container } = await renderRow(thread({ unread: 2 }));
    expect(container.textContent).toContain("2 new");
    expect(container.querySelector(".bg-brand-500")).not.toBeNull();
  });

  it("writes a working thread's step with the traveling highlight", async () => {
    const { container } = await renderRow(
      thread({
        runningTasks: [
          {
            id: TaskIdSchema.parse("nest-guard"),
            step: "Reading the automation",
            title: "Nest guard",
          },
        ],
        state: "working",
      }),
    );
    expect(container.querySelector(".brand-shiny-text")?.textContent).toBe(
      "Reading the automation",
    );
  });

  it("opens on a click anywhere but the controls at its edge", async () => {
    const { container, onOpen } = await renderRow(thread());
    const ask = container.querySelector<HTMLElement>(".line-clamp-2");
    ask?.click();
    expect(onOpen).toHaveBeenCalledTimes(1);
    container.querySelector<HTMLElement>('[aria-label="Topics"]')?.click();
    expect(onOpen).toHaveBeenCalledTimes(1);
    container.querySelector<HTMLElement>('[aria-label="Open thread"]')?.click();
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});
