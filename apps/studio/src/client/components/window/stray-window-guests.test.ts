import {
  encodeBrowserTargetId,
  StoreId,
  TaskIdSchema,
} from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { strayWindowGuests } from "./stray-window-guests";

const windowTaskId = TaskIdSchema.parse("instrument");
const childTaskId = TaskIdSchema.parse("child-task");
const open = StoreId.SessionSchema.parse("ses_01M3G55N35541T2M6SWPS72GMF");
const closed = StoreId.SessionSchema.parse("ses_01M3G55N35541T2M6SWPS72GMG");
const visited = StoreId.SessionSchema.parse("ses_01M3G55N35541T2M6SWPS72GMH");
const taskOwn = StoreId.SessionSchema.parse("ses_01M3G55N35541T2M6SWPS72GMJ");

describe("strayWindowGuests", () => {
  it("names the window's guests no tab or visit holds, and leaves a task's alone", () => {
    const attached = [
      encodeBrowserTargetId(windowTaskId, open),
      encodeBrowserTargetId(windowTaskId, closed),
      encodeBrowserTargetId(windowTaskId, visited),
      encodeBrowserTargetId(childTaskId, taskOwn),
    ];
    expect(
      strayWindowGuests({
        attached,
        heldIds: new Set([open, "screen-1", visited]),
        windowTaskId,
      }),
    ).toMatchInlineSnapshot(`
      [
        "instrument/ses_01M3G55N35541T2M6SWPS72GMG",
      ]
    `);
  });

  it("names nothing while every guest is held", () => {
    expect(
      strayWindowGuests({
        attached: [encodeBrowserTargetId(windowTaskId, open)],
        heldIds: new Set([open]),
        windowTaskId,
      }),
    ).toEqual([]);
  });
});
