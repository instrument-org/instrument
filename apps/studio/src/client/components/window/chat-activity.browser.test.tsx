import { renderInBrowser } from "@/tests/render-browser";
import { ChatIdSchema, TaskIdSchema } from "@instrument-org/workspace/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const PACKING = {
  id: packing,
  standing: { kind: "done", line: "Made packing-list.md" },
  title: "Packing list",
  updatedAt: new Date(2026, 9, 5, 14, 2),
};

/** What the chat's task list holds for the test running. */
const listed = vi.hoisted(() => ({ tasks: [] as unknown[] }));

vi.mock("./child-tasks-query", () => ({
  useChatTasks: () => ({ data: listed.tasks }),
}));

beforeEach(() => {
  listed.tasks = [
    ...RUNNING.map((task, index) => ({
      id: task.id,
      standing: { kind: "running", line: task.step },
      title: task.title,
      updatedAt: new Date(2026, 9, 5, 15, 10 - index),
    })),
    PACKING,
  ];
});

/** The activity in a head of the given width, the container its step is shown by. */
function inHead(width: number, onOpen = vi.fn()) {
  return renderInBrowser(
    <div className="@container/head flex justify-end" style={{ width }}>
      <ChatActivity chatId={CHAT_ID} onOpen={onOpen} tasks={RUNNING} />
    </div>,
  );
}

describe("ChatActivity", () => {
  it("shows the newest step in a wide head", async () => {
    await inHead(800);
    await expect
      .element(page.getByText("Reading about tram 28's route"))
      .toBeVisible();
  });

  it("folds to the dot alone in a narrow head", async () => {
    await inHead(300);
    await expect
      .element(page.getByText("Reading about tram 28's route"))
      .not.toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "3 tasks working" }))
      .toBeVisible();
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

  it("offers the finished tasks while nothing runs", async () => {
    listed.tasks = [PACKING];
    const onOpen = vi.fn();
    await renderInBrowser(
      <ChatActivity chatId={CHAT_ID} onOpen={onOpen} tasks={[]} />,
    );
    await userEvent.click(page.getByRole("button", { name: "1 task" }));
    await expect.element(page.getByText("Running")).not.toBeInTheDocument();
    await userEvent.click(page.getByRole("button", { name: /Packing list/ }));
    expect(onOpen).toHaveBeenCalledWith(packing);
  });

  it("draws nothing for a chat that filed no task", async () => {
    listed.tasks = [];
    const { container } = await renderInBrowser(
      <ChatActivity chatId={CHAT_ID} onOpen={vi.fn()} tasks={[]} />,
    );
    expect(container.textContent).toBe("");
  });
});
