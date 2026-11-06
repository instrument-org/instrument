import { type Action } from "@instrument-org/workspace/electron";
import { describe, expect, it } from "vitest";

import { activityExportCsv } from "./activity-csv";

const REQUESTS = `Started,Result,Error
2026-11-05T20:44:00.000Z,finished,
2026-11-05T20:30:00.000Z,failed,"Bad request:
""model"" is unknown"
`;

const ACTIONS: Action[] = [
  {
    at: "2026-11-05T20:50:00.000Z",
    from: "/Users/sam/Downloads",
    kind: "move",
    names: ["a.pdf", "b, c.pdf"],
    to: "/Users/sam/Archive",
  },
  {
    at: "2026-11-05T20:40:00.000Z",
    kind: "page",
    title: "Where's My Refund?",
    url: "https://www.irs.gov/refunds",
  },
];

describe("activityExportCsv", () => {
  it("saves the requests as the workspace writes them", () => {
    expect(activityExportCsv({ requests: REQUESTS })).toBe(REQUESTS);
  });

  it("saves the person's actions with a column per field", () => {
    expect(activityExportCsv({ actions: ACTIONS })).toMatchInlineSnapshot(`
      "Time,What,Path,Paths,From,To,Names,Selected,App,Chat,Title,Address,Name,Did,Message,Where,Value
      2026-11-05T20:50:00.000Z,move,,,/Users/sam/Downloads,/Users/sam/Archive,"a.pdf
      b, c.pdf",,,,,,,,,,
      2026-11-05T20:40:00.000Z,page,,,,,,,,,Where's My Refund?,https://www.irs.gov/refunds,,,,,
      "
    `);
  });

  it("puts both in one file newest first, each row with the other's columns empty", () => {
    expect(activityExportCsv({ actions: ACTIONS, requests: REQUESTS }))
      .toMatchInlineSnapshot(`
      "Time,Source,What,Path,Paths,From,To,Names,Selected,App,Chat,Title,Address,Name,Did,Message,Where,Value,Result,Error
      2026-11-05T20:50:00.000Z,Your activity,move,,,/Users/sam/Downloads,/Users/sam/Archive,"a.pdf
      b, c.pdf",,,,,,,,,,,,
      2026-11-05T20:44:00.000Z,AI request,,,,,,,,,,,,,,,,,finished,
      2026-11-05T20:40:00.000Z,Your activity,page,,,,,,,,,Where's My Refund?,https://www.irs.gov/refunds,,,,,,,
      2026-11-05T20:30:00.000Z,AI request,,,,,,,,,,,,,,,,,failed,"Bad request:
      ""model"" is unknown"
      "
    `);
  });
});
