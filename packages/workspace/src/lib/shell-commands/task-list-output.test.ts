import { describe, expect, it } from "vitest";

import {
  formatAge,
  parseListDate,
  renderTaskList,
  selectTasks,
  TASK_LIST_WINDOW,
  type TaskListRow,
} from "./task-list-output";

const NOW = new Date("2026-09-08T12:00:00.000Z");

/** A task last active `daysAgo` before NOW. */
function row(
  id: string,
  title: string,
  daysAgo: number,
  isRunning = false,
): TaskListRow {
  return {
    id,
    isRunning,
    title,
    updatedAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
  };
}

const TASKS: TaskListRow[] = [
  row("2026-09-08-hey", "hey", 0, true),
  row("2026-09-04-webauthn", "Test WebAuthn registration", 4),
  row("2026-08-14-nest", "Second-floor Nest eco mode guard", 25),
  row("golden-iron-stone-73", "Wednesday afternoon greeting", 146),
];

describe("formatAge", () => {
  it.each([
    [500, "1s"],
    [30_000, "30s"],
    [90_000, "2m"],
    [3 * 3_600_000, "3h"],
    [6 * 86_400_000, "6d"],
    [25 * 86_400_000, "25d"],
    [46 * 86_400_000, "2mo"],
    [146 * 86_400_000, "5mo"],
    [400 * 86_400_000, "1y"],
  ])("%i ms reads as %s", (milliseconds, expected) => {
    expect(formatAge(milliseconds)).toBe(expected);
  });
});

describe("parseListDate", () => {
  it("takes a calendar day", () => {
    expect(parseListDate("2026-08-14").toISOString()).toBe(
      "2026-08-14T00:00:00.000Z",
    );
  });

  it("runs a day to its end for --until", () => {
    expect(parseListDate("2026-08-14", { endOfDay: true }).toISOString()).toBe(
      "2026-08-14T23:59:59.999Z",
    );
  });

  it("takes a span back from now", () => {
    expect(parseListDate("30d", { now: NOW }).toISOString()).toBe(
      "2026-08-09T12:00:00.000Z",
    );
  });

  it("refuses anything else", () => {
    expect(() => parseListDate("last august")).toThrow(/not a date or a span/);
  });
});

describe("selectTasks", () => {
  it("windows to the newest and counts the rest", () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      row(`task-${index}`, `Task ${index}`, index),
    );
    const selection = selectTasks(many);
    expect(selection.shown).toHaveLength(TASK_LIST_WINDOW);
    expect(selection.omitted).toBe(40 - TASK_LIST_WINDOW);
    expect(selection.total).toBe(40);
  });

  it("leaves nothing behind when the list fits", () => {
    expect(selectTasks(TASKS).omitted).toBe(0);
  });

  it("searches every task, not just the window", () => {
    const many = [
      ...Array.from({ length: 40 }, (_, index) =>
        row(`task-${index}`, `Task ${index}`, index),
      ),
      row("2026-01-02-needle", "The one about the needle", 200),
    ];
    const selection = selectTasks(many, { search: "needle" });
    expect(selection.shown.map((task) => task.title)).toEqual([
      "The one about the needle",
    ]);
  });

  it("matches the id as well as the title", () => {
    expect(
      selectTasks(TASKS, { search: "webauthn" }).shown.map((task) => task.id),
    ).toEqual(["2026-09-04-webauthn"]);
  });

  it("holds a date range against last activity", () => {
    const selection = selectTasks(TASKS, {
      since: parseListDate("2026-08-10"),
      until: parseListDate("2026-08-20", { endOfDay: true }),
    });
    expect(selection.shown.map((task) => task.title)).toEqual([
      "Second-floor Nest eco mode guard",
    ]);
  });

  it("keeps a task whose id carries no date", () => {
    const selection = selectTasks(TASKS, {
      since: parseListDate("2026-04-01"),
      until: parseListDate("2026-04-30", { endOfDay: true }),
    });
    expect(selection.shown.map((task) => task.id)).toEqual([
      "golden-iron-stone-73",
    ]);
  });

  it("keeps only what is running", () => {
    expect(
      selectTasks(TASKS, { running: true }).shown.map((task) => task.id),
    ).toEqual(["2026-09-08-hey"]);
  });

  it("lists every one for --all", () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      row(`task-${index}`, `Task ${index}`, index),
    );
    expect(selectTasks(many, { all: true }).omitted).toBe(0);
  });
});

describe("renderTaskList", () => {
  it("writes a column each for the day and the age", () => {
    expect(renderTaskList(selectTasks(TASKS), { now: NOW }))
      .toMatchInlineSnapshot(`
      "2026-09-08-hey        running  2026-09-08  1s ago   hey
      2026-09-04-webauthn   idle     2026-09-04  4d ago   Test WebAuthn registration
      2026-08-14-nest       idle     2026-08-14  25d ago  Second-floor Nest eco mode guard
      golden-iron-stone-73  idle     2026-04-15  5mo ago  Wednesday afternoon greeting
      "
    `);
  });

  it("names every way to narrow when it left rows behind", () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      row(`task-${index}`, `Task ${index}`, index),
    );
    expect(renderTaskList(selectTasks(many), { now: NOW })).toContain(
      "… 5 more of 30. Narrow with --search <words>, --since <date>, or --until <date>; --all shows every match.",
    );
  });
});
