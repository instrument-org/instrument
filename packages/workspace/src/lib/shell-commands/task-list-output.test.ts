import { describe, expect, it } from "vitest";

import { TaskIdSchema } from "../../schemas/task-id";
import {
  formatAge,
  parseListDate,
  renderTaskList,
  renderTaskSearch,
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
  leftRunning = 0,
): TaskListRow {
  return {
    id: TaskIdSchema.parse(id),
    isRunning,
    leftRunning,
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

  it("adds a background column only when a task has something there", () => {
    const tasks = [
      row("2026-09-08-vault", "Find the vault", 0, false, 1),
      row("2026-09-08-hey", "hey", 0, true),
      row("2026-09-04-webauthn", "Test WebAuthn registration", 4),
    ];
    expect(renderTaskList(selectTasks(tasks), { now: NOW }))
      .toMatchInlineSnapshot(`
      "2026-09-08-vault     idle     1 in background  2026-09-08  1s ago  Find the vault
      2026-09-08-hey       running                   2026-09-08  1s ago  hey
      2026-09-04-webauthn  idle                      2026-09-04  4d ago  Test WebAuthn registration
      "
    `);
  });

  it("names every way to narrow when it left rows behind", () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      row(`task-${index}`, `Task ${index}`, index),
    );
    expect(renderTaskList(selectTasks(many), { now: NOW })).toContain(
      "… 5 more of 30. Narrow with --since <date> or --until <date>, or find one with `task search <words>`; --all shows every match.",
    );
  });
});

describe("renderTaskSearch", () => {
  const found = [
    {
      ...row("2026-09-01-chair", "Cheap small chair options on Wayfair", 7),
      count: 29,
      snippet: "…Opening Wayfair chair search…",
    },
    {
      ...row("2026-08-14-nest", "Second-floor Nest eco mode guard", 25),
      count: 0,
      snippet: "",
    },
  ];

  it("puts what was said under each task", () => {
    expect(
      renderTaskSearch({ omitted: 0, shown: found, total: 2 }, { now: NOW }),
    ).toMatchInlineSnapshot(`
      "2026-09-01-chair  2026-09-01  7d ago   Cheap small chair options on Wayfair
          29×  …Opening Wayfair chair search…
      2026-08-14-nest   2026-08-14  25d ago  Second-floor Nest eco mode guard
          in its name  matched its name
      "
    `);
  });

  it("says a name-only match was one", () => {
    expect(
      renderTaskSearch({ omitted: 0, shown: found, total: 2 }, { now: NOW }),
    ).toContain("in its name  matched its name");
  });
});
