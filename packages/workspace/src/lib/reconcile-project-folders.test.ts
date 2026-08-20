import { describe, expect, it } from "vitest";

import { FolderAttachment } from "../schemas/folder-attachment";
import { AbsolutePathSchema } from "../schemas/paths";
import { reconcileProjectFolders } from "./reconcile-project-folders";

const NOTES = "/Users/sam/Notes";
const PHOTOS = "/Users/sam/Photos";

function attachment({
  access = "read-only",
  path = NOTES,
  source = "project",
}: {
  access?: FolderAttachment.Access;
  path?: string;
  source?: FolderAttachment.Source;
} = {}): FolderAttachment.Type {
  return {
    access,
    createdAt: 0,
    id: FolderAttachment.IdSchema.parse(path),
    mountName: path.split("/").at(-1) ?? path,
    path: AbsolutePathSchema.parse(path),
    source,
  };
}

// The access each surviving folder ended up with, and what the task takes on.
function settle({
  attached = [],
  baseline = {},
  projectFolders = [],
}: {
  attached?: FolderAttachment.Type[];
  baseline?: Record<string, FolderAttachment.Access>;
  projectFolders?: { access: FolderAttachment.Access; path: string }[];
} = {}) {
  const result = reconcileProjectFolders({
    attached,
    baseline,
    projectFolders,
  });
  return {
    attaches: result.toAttach.map((folder) => folder.path),
    keeps: Object.fromEntries(
      result.surviving.map((folder) => [folder.path, folder.access]),
    ),
    removes: result.removed.map((folder) => folder.path),
  };
}

describe("reconcileProjectFolders", () => {
  // The case the whole thing is for: go back to the project, edit it, return to
  // the task and find it understands.
  it("takes on a folder the project added", () => {
    expect(
      settle({
        attached: [attachment()],
        baseline: { [NOTES]: "read-only" },
        projectFolders: [
          { access: "read-only", path: NOTES },
          { access: "read-write", path: PHOTOS },
        ],
      }).attaches,
    ).toEqual([PHOTOS]);
  });

  it("drops a folder the project no longer has", () => {
    expect(
      settle({
        attached: [attachment()],
        baseline: { [NOTES]: "read-only" },
        projectFolders: [],
      }).removes,
    ).toEqual([NOTES]);
  });

  it("adopts the project's access for a folder the task never decided", () => {
    expect(
      settle({
        attached: [attachment({ access: "read-only" })],
        baseline: { [NOTES]: "read-only" },
        projectFolders: [{ access: "read-write", path: NOTES }],
      }).keeps,
    ).toEqual({ [NOTES]: "read-write" });
  });

  // The task edited last, and the project has not moved this folder since.
  it("keeps the task's access over an unchanged project", () => {
    expect(
      settle({
        attached: [attachment({ access: "read-write" })],
        baseline: { [NOTES]: "read-only" },
        projectFolders: [{ access: "read-only", path: NOTES }],
      }).keeps,
    ).toEqual({ [NOTES]: "read-write" });
  });

  // ...and the project editing it afterwards is the later edit, so it wins,
  // which is what keeps a grant narrowed in the project from being stranded.
  it("lets a later project edit override the task's access", () => {
    expect(
      settle({
        attached: [attachment({ access: "read-write" })],
        baseline: { [NOTES]: "read-write" },
        projectFolders: [{ access: "read-only", path: NOTES }],
      }).keeps,
    ).toEqual({ [NOTES]: "read-only" });
  });

  it("leaves a folder the task detached detached", () => {
    expect(
      settle({
        attached: [],
        baseline: { [NOTES]: "read-only" },
        projectFolders: [{ access: "read-only", path: NOTES }],
      }).attaches,
    ).toEqual([]);
  });

  it("brings back a detached folder the project has since edited", () => {
    expect(
      settle({
        attached: [],
        baseline: { [NOTES]: "read-only" },
        projectFolders: [{ access: "read-write", path: NOTES }],
      }).attaches,
    ).toEqual([NOTES]);
  });

  // Removed from the project and added again later is a fresh offer: the
  // baseline entry goes with the folder, so nothing is left to decline with.
  it("brings back a folder the project dropped and re-added", () => {
    const dropped = settle({
      attached: [attachment()],
      baseline: { [NOTES]: "read-only" },
      projectFolders: [],
    });
    expect(dropped.removes).toEqual([NOTES]);

    expect(
      settle({
        attached: [],
        baseline: reconcileProjectFolders({
          attached: [attachment()],
          baseline: { [NOTES]: "read-only" },
          projectFolders: [],
        }).nextBaseline,
        projectFolders: [{ access: "read-only", path: NOTES }],
      }).attaches,
    ).toEqual([NOTES]);
  });

  // A task carried folders before this rule existed, so there is nothing
  // recorded for them. The project's version is taken, which is what the task
  // would have had anyway.
  it("takes the project's access with no baseline at all", () => {
    expect(
      settle({
        attached: [attachment({ access: "read-write" })],
        projectFolders: [{ access: "read-only", path: NOTES }],
      }).keeps,
    ).toEqual({ [NOTES]: "read-only" });
  });

  it("never touches a folder the user attached to the task", () => {
    expect(
      settle({
        attached: [attachment({ access: "read-write", source: "user" })],
        baseline: { [NOTES]: "read-only" },
        projectFolders: [{ access: "read-only", path: NOTES }],
      }),
    ).toEqual({
      attaches: [],
      keeps: { [NOTES]: "read-write" },
      removes: [],
    });
  });
});
