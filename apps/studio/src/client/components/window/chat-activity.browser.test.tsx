import { renderInBrowser } from "@/tests/render-browser";
import { ChatIdSchema, TaskIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { ChatActivity } from "./chat-activity";

const CHAT_ID = ChatIdSchema.parse("2026-10-05-lisbon-trip");
const tram = TaskIdSchema.parse("2026-10-05-tram-28");
const nata = TaskIdSchema.parse("2026-10-05-pastel-de-nata");
const sintra = TaskIdSchema.parse("2026-10-05-sintra-palaces");
const packing = TaskIdSchema.parse("2026-10-05-packing-list");

const RUNNING = [
  { id: tram, step: "Reading about tram 28's route", title: "Tram 28 history" },
  { id: nata, step: "Comparing reviews", title: "Pastel de nata shops" },
  { id: sintra, step: "Reading palace hours", title: "Sintra palaces" },
];

vi.mock("./child-tasks-query", () => ({
  useChatTasks: () => ({
    data: [
      ...RUNNING.map((task, index) => ({
        id: task.id,
        standing: { kind: "running", line: task.step },
        title: task.title,
        updatedAt: new Date(2026, 9, 5, 15, 10 - index),
      })),
      {
        id: packing,
        standing: { kind: "done", line: "Made packing-list.md" },
        title: "Packing list",
        updatedAt: new Date(2026, 9, 5, 14, 2),
      },
    ],
  }),
}));

/** The activity in a head of the given width, the container its step is shown by. */
function inHead(width: number, onOpen = vi.fn()) {
  return renderInBrowser(
    <div className="@container/head flex justify-end" style={{ width }}>
      <ChatActivity chatId={CHAT_ID} onOpen={onOpen} tasks={RUNNING} />
    </div>,
  );
}

describe("ChatActivity", () => {
  it("shows the newest step and how many more run in a wide head", async () => {
    await inHead(800);
    await expect
      .element(page.getByText("Reading about tram 28's route"))
      .toBeVisible();
    await expect.element(page.getByText("+2")).toBeVisible();
  });

  it("folds to the spinner and the count in a narrow head", async () => {
    await inHead(300);
    await expect
      .element(page.getByText("Reading about tram 28's route"))
      .not.toBeVisible();
    await expect.element(page.getByText("3", { exact: true })).toBeVisible();
  });

  it("lists running tasks, then finished ones, and opens the one pressed", async () => {
    const onOpen = vi.fn();
    await inHead(800, onOpen);
    await userEvent.click(
      page.getByRole("button", { name: "3 tasks working" }),
    );
    await expect.element(page.getByText("Running")).toBeVisible();
    await expect.element(page.getByText("Finished")).toBeVisible();
    await expect.element(page.getByText("Pastel de nata shops")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: /Packing list/ }));
    expect(onOpen).toHaveBeenCalledWith(packing);
  });

  it("draws nothing while nothing runs", async () => {
    const { container } = await renderInBrowser(
      <ChatActivity chatId={CHAT_ID} onOpen={vi.fn()} tasks={[]} />,
    );
    expect(container.textContent).toBe("");
  });
});
