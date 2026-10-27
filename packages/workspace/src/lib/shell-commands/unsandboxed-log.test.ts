import { describe, expect, it } from "vitest";

import { classifyLog } from "./unsandboxed-log";

const allowed = (argv: string[]) =>
  classifyLog(argv, "darwin").allowed === true;

describe("classifyLog", () => {
  it.each([
    [["show", "--last", "1h"]],
    [["show", "--last=1h", "--style", "compact"]],
    [["show", "-l1h", "-s", "compact", "--info", "--no-debug"]],
    [["show", "--predicate", 'messageType == error OR process == "Finder"']],
    [["show", "-P", 'eventMessage CONTAINS[c] "function"']],
    [["show", "--start", "2026-10-25 10:00:00", "--end", "2026-10-25 11:00"]],
    [["show", "--timezone", "America/Chicago", "--last24"]],
    [["stats", "--overview", "--last", "1h", "--count", "10"]],
    [["stream", "--level", "info", "--timeout", "1m", "--process", "Finder"]],
    [["help"]],
    [["help", "predicates"]],
  ])("runs log %j", (argv) => {
    expect(allowed(argv)).toBe(true);
  });

  it.each([
    [[]],
    [["collect", "--output", "/tmp/x.logarchive"]],
    [["config", "--mode", "level:debug"]],
    [["erase", "--all"]],
    [["emit", "hello"]],
    [["show", "/tmp/x.logarchive"]],
    [["show", "--archive", "/tmp/x.logarchive"]],
    [["show", "-A", "/tmp/x.logarchive"]],
    [["show", "--arch", "/tmp/x.logarchive"]],
    [["show", "-LA", "/tmp/x.logarchive"]],
    [["show", "-pager"]],
    [["show", "-pa"]],
    [["show", "-archive", "/tmp/x.logarchive"]],
    [["show", '-predicate=FUNCTION(processImagePath, "length") > 0']],
    [["show", "-pFinder"]],
    [["show", "--directory", "/tmp"]],
    [["stats", "--file", "/tmp/x.tracev3"]],
    [["show", "--pager"]],
    [["show", "--last"]],
    [["show", "--info=yes"]],
    [["show", "--", "--last", "1h"]],
    [["show", "--predicate", 'FUNCTION(processImagePath, "length") > 0']],
    [["show", "-H", 'cast("NSTask", "Class") != nil']],
    [["stats", "-P", "SUBQUERY(a, $x, $x == 1).@count > 0"]],
    [["show", "--timezone", "../../etc/x"]],
    [["help", "collect"]],
  ])("refuses log %j", (argv) => {
    expect(allowed(argv)).toBe(false);
  });

  it("is macOS only", () => {
    expect(classifyLog(["show"], "linux").allowed).toBe(false);
  });

  it("says what it takes", () => {
    expect(classifyLog(["show", "--archive", "x"], "darwin"))
      .toMatchInlineSnapshot(`
        {
          "allowed": false,
          "reason": "log: \`--archive\` can't be used here. \`log\` runs \`show\`, \`stats\` and \`stream\` with their options as \`log help <verb>\` lists them, spelled in full or as one short letter per argument; not an archive, a directory, a file or \`--pager\`.",
        }
      `);
  });
});
