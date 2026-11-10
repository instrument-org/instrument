import { findRanges } from "@/client/components/document-viewers/use-find-highlights";
import { renderInBrowser } from "@/tests/render-browser";
import {
  type ActivityRow,
  activityWords,
  ChatIdSchema,
  countMatches,
  StoreId,
  type TurnStep,
} from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import "../../styles/globals.css";
import { ActivityRowView, FoldedActivityView } from "./activity-row";

const chatId = ChatIdSchema.parse("2026-11-10-harbor-notes");

const call = (explanation?: string): TurnStep => ({
  ...(explanation !== undefined && { explanation }),
  metadata: {
    createdAt: new Date("2026-11-10T12:00:00Z"),
    id: StoreId.newPartId(),
    messageId: StoreId.newMessageId(),
    sessionId: StoreId.newSessionId(),
  },
  status: "done",
  tool: "tool-bash",
  type: "step",
});

const activity = (steps: TurnStep[], title?: string): ActivityRow => ({
  apps: [],
  counts: [{ count: 2, label: "files" }],
  id: StoreId.newPartId(),
  kind: "activity",
  sites: [],
  startedAt: new Date("2026-11-10T12:00:00Z"),
  steps,
  ...(title !== undefined && { title }),
});

const rows = {
  "a named activity of one call repeating its name": activity(
    [call("Comparing versions")],
    "Comparing versions",
  ),
  "a named activity of one call saying something else": activity(
    [call("Diffing the two files")],
    "Comparing versions",
  ),
  "a named activity of several calls": activity(
    [call("Reading the notes"), call()],
    "Comparing versions",
  ),
  "an unnamed run": activity([call("Reading the notes"), call()]),
};

const queries = [
  "comparing versions",
  "diffing",
  "reading the notes",
  "ran terminal command",
  "2 files",
];

/**
 * What a chat's find counts of an activity in the records (`activityWords`)
 * is what it finds once the activity is drawn, folded in an opened Worked row
 * or as a line of its own. A turn not loaded yet is counted from the records,
 * so a difference here moves the count as turns load and steps onto nothing.
 */
describe("an activity's words", () => {
  it.each(Object.entries(rows))("counted as drawn, for %s", async (_, row) => {
    for (const inFold of [true, false]) {
      const screen = await renderInBrowser(
        inFold ? (
          <FoldedActivityView chatId={chatId} row={row} />
        ) : (
          <ActivityRowView chatId={chatId} isLive={false} row={row} />
        ),
      );
      const drawn = Object.fromEntries(
        queries.map((query) => [
          query,
          findRanges(screen.container, query).length,
        ]),
      );
      const counted = Object.fromEntries(
        queries.map((query) => [
          query,
          activityWords(row, { inFold }).reduce(
            (sum, words) => sum + countMatches(words, query),
            0,
          ),
        ]),
      );
      expect({ inFold, ...counted }).toEqual({ inFold, ...drawn });
      await screen.unmount();
    }
  });
});
