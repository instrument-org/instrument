import { describe, expect, it } from "vitest";

import { SETTING_ANSWERS } from "../settings/agent-answers";
import {
  type AgentAnswer,
  ROW_FACT_ANSWERS,
  WINDOW_CHANGE_ANSWERS,
} from "./agent-answers";

/** The rows a table answers with a gap, each with what is missing. */
const gapsOf = (table: Record<string, AgentAnswer<string>>) =>
  Object.entries(table).flatMap(([row, answer]) =>
    typeof answer === "object" && "gap" in answer
      ? [`${row}: ${answer.gap}`]
      : [],
  );

// The tables are checked by the compiler; this lists the person's actions
// no agent command covers yet, so closing one shows here.
describe("agent answers", () => {
  it("lists the window's gaps", () => {
    expect(gapsOf(WINDOW_CHANGE_ANSWERS)).toMatchInlineSnapshot(`
      [
        "stepTrail: Back and Forward on a tab: agent-browser steps a page's own history, and nothing steps a tab between the screens and pages it showed",
        "stepVisit: Back and Forward on a tab: agent-browser steps a page's own history, and nothing steps a tab between the screens and pages it showed",
        "group.share: how wide each side of a split is, which the person drags",
      ]
    `);
  });

  it("lists no gap in what a sidebar row shows or in Settings", () => {
    expect([...gapsOf(ROW_FACT_ANSWERS), ...gapsOf(SETTING_ANSWERS)]).toEqual(
      [],
    );
  });
});
