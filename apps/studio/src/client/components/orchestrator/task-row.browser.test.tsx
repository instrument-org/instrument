import { TaskRow } from "@/client/components/orchestrator/task-row";
import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it, vi } from "vitest";

/**
 * The list is scanned down its right edge, so the marks there have to be
 * columns. Only a real layout engine can say whether they are: jsdom measures
 * every box as zero and would pass whatever these rows did.
 */
describe("TaskRow", () => {
  it("puts every row's time at the same left edge", async () => {
    const { container } = await renderInBrowser(
      <div style={{ width: "320px" }}>
        <TaskRow
          isOpen={false}
          line="Reading the recipe"
          onOpen={vi.fn()}
          standing="running"
          threadTitle="Plan a week of dinners"
          time="now"
          title="Plan a week of dinners"
        />
        <TaskRow
          isOpen={false}
          line="Done"
          onOpen={vi.fn()}
          standing="done"
          threadTitle="Summarize the chapter"
          time="Sep 28"
          title="Summarize the chapter"
        />
      </div>,
    );
    // The two rows carry the shortest and the longest time the list writes,
    // which is the pair a content-sized column pulls furthest apart.
    const lefts = [...container.querySelectorAll("button")].map((row) => {
      const time = row.querySelector(".tabular-nums");
      if (!time) {
        throw new Error("a row drew no time cell");
      }
      return time.getBoundingClientRect().left;
    });
    expect(lefts).toHaveLength(2);
    expect(lefts[0]).toBe(lefts[1]);
  });

  it("writes a waiting task's line in its own color per theme", async () => {
    const row = (
      <TaskRow
        isOpen={false}
        line="Waiting on you"
        onOpen={vi.fn()}
        standing="waiting"
        time="3h"
        title="Book the flights"
      />
    );
    const { container } = await renderInBrowser(
      <>
        <div>{row}</div>
        <div className="dark">{row}</div>
      </>,
    );
    // Both halves of the ramp, because a token defined once under `:root`
    // renders the same in both themes and is how this line came to be all but
    // unreadable on the dark surface.
    const [light, dark] = [...container.querySelectorAll("button")].map(
      (button) => {
        const line = [...button.querySelectorAll("span")].find(
          (span) => span.textContent === "Waiting on you",
        );
        if (!line) {
          throw new Error("a row drew no second line");
        }
        return globalThis.getComputedStyle(line).color;
      },
    );
    expect(light).toBeTruthy();
    expect(dark).not.toBe(light);
  });

  it("marks a working task with the traveling highlight and no dot", async () => {
    const { container } = await renderInBrowser(
      <TaskRow
        isOpen={false}
        line="Reading the recipe"
        onOpen={vi.fn()}
        standing="running"
        time="now"
        title="Plan a week of dinners"
      />,
    );
    const row = container.querySelector("button");
    expect(row?.querySelector(".brand-shiny-text")?.textContent).toBe(
      "Reading the recipe",
    );
    expect(row?.querySelector(".rounded-full")).toBeNull();
  });
});
