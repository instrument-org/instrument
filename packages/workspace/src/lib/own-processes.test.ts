import { describe, expect, it } from "vitest";

import {
  jobOwning,
  type JobPrograms,
  parseProcStat,
  parsePsTable,
} from "./own-processes";

const job = (
  id: string | undefined,
  running: number[],
  ended: number[] = [],
): JobPrograms => ({
  ended: new Set(ended),
  ...(id === undefined ? {} : { id }),
  running: new Set(running),
});

// pnpm (100) leads its group and runs node (101), which runs esbuild (102).
// A daemon (103) left its group; 200 is the person's own shell, 201 its child.
const table = parsePsTable(`
    1     0     1
  100    50   100
  101   100   100
  102   101   100
  103     1   103
  200     1   200
  201   200   200
  300   100   300
`);

describe("jobOwning", () => {
  it.each([
    ["the program a job runs", 100, [job("bg_1", [100])], "bg_1"],
    ["its child", 101, [job("bg_1", [100])], "bg_1"],
    ["its grandchild", 102, [job("bg_1", [100])], "bg_1"],
    ["a child in a group of its own", 300, [job("bg_1", [100])], "bg_1"],
    ["a daemon that left", 103, [job("bg_1", [100])], undefined],
    ["the person's own shell", 200, [job("bg_1", [100])], undefined],
    ["the person's own child", 201, [job("bg_1", [100])], undefined],
    [
      "a group no program of the job led",
      102,
      [job("bg_1", [], [99])],
      undefined,
    ],
    // An ended leader's pid now names a live process, so its group was
    // emptied and given out again.
    [
      "a group whose leader's pid went to another",
      101,
      [job("bg_1", [], [100])],
      undefined,
    ],
    // The pid of an ended leader now names some other process.
    [
      "a pid the system gave out again",
      200,
      [job("bg_1", [], [200])],
      undefined,
    ],
    [
      "a reused pid a foreground call once started",
      201,
      [job(undefined, [], [200])],
      undefined,
    ],
  ])("%s", (_name, pid, jobs, owner) => {
    expect(jobOwning(pid, jobs, table)?.id).toBe(owner);
  });

  it("keeps the group of a leader that ended while nothing took its pid", () => {
    const orphaned = parsePsTable(`
      101     1   100
      102   101   100
    `);
    expect(jobOwning(102, [job("bg_1", [], [100])], orphaned)?.id).toBe("bg_1");
    expect(jobOwning(102, [job(undefined, [], [100])], orphaned)).toBeDefined();
  });

  it("knows only the programs a job runs without a table", () => {
    expect(jobOwning(100, [job("bg_1", [100])], undefined)?.id).toBe("bg_1");
    expect(jobOwning(101, [job("bg_1", [100])], undefined)).toBeUndefined();
  });
});

describe("parseProcStat", () => {
  it("reads past a name with spaces and parentheses", () => {
    expect(
      parseProcStat("4242 (node (dev) srv) S 4100 4100 4100 0 -1 4194560"),
    ).toEqual({ pgid: 4100, pid: 4242, ppid: 4100 });
  });

  it("reads nothing from a line it cannot parse", () => {
    expect(parseProcStat("garbage")).toBeUndefined();
  });
});
