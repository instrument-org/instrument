import { TaskIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  conversationPathOfTaskPath,
  hostPathOfMount,
  mountOfHostPath,
} from "./file-tabs";

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

// The grants hold whatever the computer calls its folders, so the same two
// functions have to write a Windows path and read one back.
const WINDOWS_FOLDERS = {
  home: { mountName: "Home", path: "C:\\Users\\casey" },
  workspace: {
    mountName: "Instrument",
    path: "C:\\Users\\casey\\Documents\\Instrument",
  },
};

describe("hostPathOfMount", () => {
  it("writes a path the way the computer it is on writes one", () => {
    expect(hostPathOfMount("/mnt/Instrument/smiley.png", WINDOWS_FOLDERS)).toBe(
      "C:\\Users\\casey\\Documents\\Instrument\\smiley.png",
    );
    expect(
      hostPathOfMount("/mnt/Home/Downloads/receipt.pdf", WINDOWS_FOLDERS),
    ).toBe("C:\\Users\\casey\\Downloads\\receipt.pdf");
  });

  it("writes a POSIX path with slashes", () => {
    expect(
      hostPathOfMount("/mnt/Instrument/lisbon/hotels.md", CONVERSATION_FOLDERS),
    ).toBe("/Users/casey/Documents/Instrument/lisbon/hotels.md");
  });

  it("answers the folder itself for the mount's own path", () => {
    expect(hostPathOfMount("/mnt/Instrument", WINDOWS_FOLDERS)).toBe(
      "C:\\Users\\casey\\Documents\\Instrument",
    );
  });

  it("uses the task's own folder for a path under one", () => {
    expect(
      hostPathOfMount(
        "/tasks/lisbon-hotel/output/report.md",
        WINDOWS_FOLDERS,
        new Map([["lisbon-hotel", "C:\\Users\\casey\\tasks\\lisbon-hotel"]]),
      ),
    ).toBe("C:\\Users\\casey\\tasks\\lisbon-hotel\\output\\report.md");
  });
});

describe("mountOfHostPath", () => {
  // The other direction: a virtual path is POSIX wherever it came from, so a
  // Windows path must not carry its separators into one.
  it("reads a Windows path back through the deepest grant", () => {
    expect(
      mountOfHostPath(
        "C:\\Users\\casey\\Documents\\Instrument\\lisbon\\hotels.md",
        WINDOWS_FOLDERS,
      ),
    ).toBe("/mnt/Instrument/lisbon/hotels.md");
  });

  it("reads a POSIX path back", () => {
    expect(
      mountOfHostPath(
        "/Users/casey/Downloads/receipt.pdf",
        CONVERSATION_FOLDERS,
      ),
    ).toBe("/mnt/Home/Downloads/receipt.pdf");
  });

  it("answers the mount itself for the granted folder", () => {
    expect(mountOfHostPath("C:\\Users\\casey", WINDOWS_FOLDERS)).toBe(
      "/mnt/Home",
    );
  });

  it("answers nothing for a path no grant covers", () => {
    expect(
      mountOfHostPath("D:\\Archive\\2019.csv", WINDOWS_FOLDERS),
    ).toBeUndefined();
  });
});
