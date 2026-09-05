import { describe, expect, it } from "vitest";

import { TaskPane } from "../schemas/task-pane";
import { paneTabsModelNote } from "./pane-tabs-model-text";

const report = TaskPane.fileTab("output/report.md");
const chart = TaskPane.fileTab("output/chart.png");

describe("paneTabsModelNote", () => {
  it("names the file in front and what is behind it", () => {
    expect(
      paneTabsModelNote({
        open: true,
        selected: TaskPane.tabKey(report),
        tabs: [chart, report],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      The panel beside the conversation is open, showing \`output/report.md\`. Behind it, a click away: \`output/chart.png\`, the browser. \`show\` brings one of those to the front rather than adding a second tab, and what is in front needs no showing.
      </instrument-system-note>"
    `);
  });

  it("puts the browser in front when it is selected", () => {
    expect(
      paneTabsModelNote({
        open: true,
        selected: "browser",
        tabs: [report],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      The panel beside the conversation is open, showing the browser. Behind it, a click away: \`output/report.md\`. \`show\` brings one of those to the front rather than adding a second tab, and what is in front needs no showing.
      </instrument-system-note>"
    `);
  });

  it("says an open pane with no files is showing the browser", () => {
    expect(paneTabsModelNote({ open: true, selected: "browser", tabs: [] }))
      .toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      The panel beside the conversation is open, showing the browser, and holds no file tabs. No file named earlier is on screen.
      </instrument-system-note>"
    `);
  });

  // The tabs survive the close, and the note says so: the agent can bring
  // one back with `show`, but nothing is on screen until it does.
  it("says a closed pane shows nothing, and what it still holds", () => {
    expect(
      paneTabsModelNote({
        open: false,
        selected: TaskPane.tabKey(report),
        tabs: [chart, report],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      The panel beside the conversation is closed, so nothing named earlier is on screen. It still holds tabs for \`output/chart.png\`, \`output/report.md\`; \`show\` on one of those reopens the panel on that tab rather than adding a second one.
      </instrument-system-note>"
    `);
  });

  it("says a closed, empty pane shows nothing", () => {
    expect(paneTabsModelNote({ open: false, tabs: [] })).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      The panel beside the conversation is closed and holds no file tabs. Nothing named earlier is on screen.
      </instrument-system-note>"
    `);
  });

  // The renderer falls back the same way, so the note names what is drawn.
  it("falls back to the last file when the selection names nothing open", () => {
    expect(
      paneTabsModelNote({
        open: true,
        selected: "file:output/gone.md",
        tabs: [chart, report],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      The panel beside the conversation is open, showing \`output/report.md\`. Behind it, a click away: \`output/chart.png\`, the browser. \`show\` brings one of those to the front rather than adding a second tab, and what is in front needs no showing.
      </instrument-system-note>"
    `);
  });
});
