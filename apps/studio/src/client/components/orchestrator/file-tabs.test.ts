import { TaskIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { conversationPathOfTaskPath } from "./file-tabs";

const TASK_ID = TaskIdSchema.parse("lisbon-hotel");

// The conversation was granted the home folder and the workspace folder; the
// task was handed Downloads out of the first of those and the workspace folder
// whole, so the two name one folder differently and one folder alike.
const CONVERSATION_FOLDERS = {
  home: { mountName: "Home", path: "/Users/casey" },
  workspace: {
    mountName: "Instrument",
    path: "/Users/casey/Documents/Instrument",
  },
};

const TASK_FOLDERS = {
  downloads: { mountName: "Downloads", path: "/Users/casey/Downloads" },
  workspace: {
    mountName: "Instrument",
    path: "/Users/casey/Documents/Instrument",
  },
};

const translate = (
  path: string,
  attachedFolders: Record<
    string,
    { mountName: string; path: string }
  > = TASK_FOLDERS,
) =>
  conversationPathOfTaskPath({
    attachedFolders,
    conversationFolders: CONVERSATION_FOLDERS,
    path,
    taskId: TASK_ID,
  });

describe("conversationPathOfTaskPath", () => {
  it.each([
    ["output/report.md", "/tasks/lisbon-hotel/output/report.md"],
    ["chart.png", "/tasks/lisbon-hotel/chart.png"],
    ["/task/work/notes.txt", "/tasks/lisbon-hotel/work/notes.txt"],
  ])(
    "reads the task's own folder through the conversation: %s",
    (path, expected) => {
      expect(translate(path)).toBe(expected);
    },
  );

  it("takes a handed folder by the name the conversation has for it", () => {
    expect(translate("/mnt/Downloads/receipt.pdf")).toBe(
      "/mnt/Home/Downloads/receipt.pdf",
    );
  });

  it("leaves a folder both know alike where it is", () => {
    expect(translate("/mnt/Instrument/lisbon/hotels.md")).toBe(
      "/mnt/Instrument/lisbon/hotels.md",
    );
  });

  it("leaves a folder the conversation cannot reach as the task named it", () => {
    expect(
      translate("/mnt/Archive/2019.csv", {
        archive: { mountName: "Archive", path: "/Volumes/Backup/Archive" },
      }),
    ).toBe("/mnt/Archive/2019.csv");
  });

  it("leaves a mount that is neither the task's nor a folder alone", () => {
    expect(translate("/skills/pdf/SKILL.md")).toBe("/skills/pdf/SKILL.md");
  });
});
