import {
  PRIVATE_FOLDER_NAME,
  SETTINGS_FILE_NAME,
} from "@instrument-org/shared";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WorkspaceDirSchema } from "../schemas/paths";
import {
  readProjectsSync,
  PROJECT_FILE_NAME,
  PROJECTS_FOLDER_NAME,
} from "./chat/projects";
import {
  convertProjectsToProjectFiles,
  moveProjectsToFolder,
  moveTopicsToProjects,
} from "./projects-move";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { workspaceLayout } from "./workspace-layout";

let root: string;
/** Where builds before projects were out in the open hid them, `.instrument/topics/`. */
const hiddenDir = () => workspaceLayout(root).topicsDir;
const folder = () => path.join(root, PROJECTS_FOLDER_NAME);
const previous = getWorkspaceConfig();

/** A project as the build before this one wrote it: two files, both hidden. */
async function writeOldProject(
  dir: string,
  name: string,
  { instructions, ...settings }: Record<string, unknown> = {},
): Promise<void> {
  await fs.mkdir(path.join(dir, name, PRIVATE_FOLDER_NAME), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(dir, name, PRIVATE_FOLDER_NAME, SETTINGS_FILE_NAME),
    JSON.stringify({
      createdAt: Date.parse("2026-09-02T14:14:00.921Z"),
      id: `top_${name}`,
      ...settings,
    }),
  );
  if (typeof instructions === "string") {
    await fs.writeFile(
      path.join(dir, name, "instructions.md"),
      `${instructions}\n`,
    );
  }
}

function projectFile(name: string): Promise<string> {
  return fs.readFile(path.join(folder(), name, PROJECT_FILE_NAME), "utf8");
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "projects-move-test-"));
  setWorkspaceConfig({ ...previous, rootDir: WorkspaceDirSchema.parse(root) });
});

afterEach(async () => {
  setWorkspaceConfig(previous);
  await fs.rm(root, { force: true, recursive: true });
});

describe("moveProjectsToFolder", () => {
  it("brings the projects out where the person can read them", async () => {
    await writeOldProject(hiddenDir(), "Kitchen");

    const moved = await moveProjectsToFolder(root);

    expect(moved).toEqual({ count: 1, kind: "moved", where: folder() });
    await expect(fs.readdir(hiddenDir())).rejects.toThrow();
  });

  it("leaves a Projects folder the person already made alone", async () => {
    await writeOldProject(hiddenDir(), "Kitchen");
    await writeOldProject(folder(), "Theirs");

    const moved = await moveProjectsToFolder(root);

    expect(moved).toEqual({ kind: "already-there", where: folder() });
    expect(await fs.readdir(folder())).toEqual(["Theirs"]);
    expect(await fs.readdir(hiddenDir())).toEqual(["Kitchen"]);
  });

  it("does nothing for a workspace with no projects hidden away", async () => {
    expect(await moveProjectsToFolder(root)).toEqual({ kind: "none" });

    await fs.mkdir(hiddenDir(), { recursive: true });
    expect(await moveProjectsToFolder(root)).toEqual({ kind: "none" });
  });

  it("finds nothing to move on a second launch", async () => {
    await writeOldProject(hiddenDir(), "Kitchen");
    await moveProjectsToFolder(root);

    expect(await moveProjectsToFolder(root)).toEqual({ kind: "none" });
    expect(await fs.readdir(folder())).toEqual(["Kitchen"]);
  });
});

describe("convertProjectsToProjectFiles", () => {
  it("makes one AGENTS.md of the two files, and takes the old ones away", async () => {
    await writeOldProject(folder(), "Kitchen", {
      about: "Kitchen plans and appliances",
      color: "amber",
      emoji: "🍳",
      folders: [{ path: "/Users/someone/Kitchen plans" }],
      instructions: "The standing instructions.",
      projectId: "prj_01KXB5K5ZSQNZ8NQJPQRYRAAS1",
    });

    const converted = await convertProjectsToProjectFiles(root);

    expect(converted).toEqual({
      done: ["converted Kitchen to AGENTS.md"],
      left: [],
    });
    expect(
      (await projectFile("Kitchen")).replace(
        /^created: .+$/m,
        "created: <made>",
      ),
    ).toMatchInlineSnapshot(`
      "---
      id: top_Kitchen
      emoji: 🍳
      color: amber
      about: Kitchen plans and appliances
      created: <made>
      folders:
        - path: /Users/someone/Kitchen plans
      projectId: prj_01KXB5K5ZSQNZ8NQJPQRYRAAS1
      ---

      The standing instructions.
      "
    `);
    expect(await fs.readdir(path.join(folder(), "Kitchen"))).toEqual([
      PROJECT_FILE_NAME,
    ]);
    // And the project reads back as the one the two files held, its folders a
    // key this build carries for the launch that grants them on this
    // computer (`moveProjectFolders`) and otherwise does not read.
    expect(readProjectsSync(root)).toEqual([
      {
        about: "Kitchen plans and appliances",
        color: "amber",
        created: new Date("2026-09-02T14:14:00.000Z"),
        emoji: "🍳",
        id: "top_Kitchen",
        instructions: "The standing instructions.",
        name: "Kitchen",
        others: {
          folders: [{ path: "/Users/someone/Kitchen plans" }],
          projectId: "prj_01KXB5K5ZSQNZ8NQJPQRYRAAS1",
        },
      },
    ]);
  });

  it("keeps a retired project retired, and a settings key it does not know", async () => {
    await writeOldProject(folder(), "Trips", {
      retired: true,
      sortsAfter: "Kitchen",
    });

    await convertProjectsToProjectFiles(root);

    const file = await projectFile("Trips");
    expect(file).toContain("retired: true");
    expect(file).toContain("sortsAfter: Kitchen");
  });

  it("leaves a project that already has its file alone", async () => {
    await writeOldProject(folder(), "Kitchen", {
      instructions: "The old ones.",
    });
    await convertProjectsToProjectFiles(root);
    const written = await projectFile("Kitchen");
    // The person edits the file the conversion wrote.
    await fs.writeFile(
      path.join(folder(), "Kitchen", PROJECT_FILE_NAME),
      written.replace("The old ones.", "What I actually want."),
    );
    // And an old settings file turns up again beside it, from a sync.
    await writeOldProject(folder(), "Kitchen", {
      instructions: "The old ones.",
    });

    const converted = await convertProjectsToProjectFiles(root);

    expect(converted).toEqual({ done: [], left: [] });
    expect(await projectFile("Kitchen")).toContain("What I actually want.");
    expect(readProjectsSync(root)[0]?.instructions).toBe(
      "What I actually want.",
    );
  });

  it("finds nothing to convert on a second launch", async () => {
    await writeOldProject(folder(), "Kitchen");
    expect((await convertProjectsToProjectFiles(root)).done).toHaveLength(1);

    expect(await convertProjectsToProjectFiles(root)).toEqual({
      done: [],
      left: [],
    });
  });

  it("leaves a folder of the person's that was never a project", async () => {
    await fs.mkdir(path.join(folder(), "Scratch"), { recursive: true });
    await fs.writeFile(path.join(folder(), "Scratch", "notes.md"), "mine");

    expect(await convertProjectsToProjectFiles(root)).toEqual({
      done: [],
      left: [],
    });
    expect(await fs.readdir(path.join(folder(), "Scratch"))).toEqual([
      "notes.md",
    ]);
  });

  it("leaves the old files where they are when the settings name no project", async () => {
    await writeOldProject(folder(), "Kitchen", { id: 7 });

    const converted = await convertProjectsToProjectFiles(root);

    expect(converted.done).toEqual([]);
    expect(converted.left).toEqual([
      {
        reason: "Error: settings.json names no project",
        where: path.join(folder(), "Kitchen"),
      },
    ]);
    expect(
      await fs.readdir(path.join(folder(), "Kitchen", PRIVATE_FOLDER_NAME)),
    ).toEqual([SETTINGS_FILE_NAME]);
  });

  it("does nothing for a workspace with no Projects folder", async () => {
    expect(await convertProjectsToProjectFiles(root)).toEqual({
      done: [],
      left: [],
    });
  });
});

describe("moveTopicsToProjects", () => {
  async function writeTopic(name: string, text: string) {
    await fs.mkdir(path.join(root, "Topics", name), { recursive: true });
    await fs.writeFile(path.join(root, "Topics", name, "TOPIC.md"), text);
  }

  it("moves into a lowercase projects folder on a disk that doesn't tell the two apart", async () => {
    await writeTopic("Kitchen", "---\nid: top_1\n---\n\nInduction only.\n");
    await fs.mkdir(path.join(root, "projects", "Garden"), { recursive: true });
    const caseInsensitive = await fs
      .lstat(path.join(root, "PROJECTS"))
      .then(() => true)
      .catch(() => false);

    const moved = await moveTopicsToProjects(root);

    expect(moved.done).toContain(
      caseInsensitive
        ? "moved Topics/Kitchen to Projects/"
        : "moved Topics/ to Projects/",
    );
  });

  it("renames Topics to Projects, each TOPIC.md becoming the project's AGENTS.md", async () => {
    await writeTopic("Kitchen", "---\nid: top_1\n---\n\nInduction only.\n");
    await fs.writeFile(path.join(root, "Topics", "Kitchen", "plan.pdf"), "");

    const moved = await moveTopicsToProjects(root);

    expect(moved).toEqual({
      done: [
        "moved Topics/ to Projects/",
        "renamed Kitchen/TOPIC.md to AGENTS.md",
      ],
      left: [],
    });
    expect(await fs.readdir(root)).toEqual([PROJECTS_FOLDER_NAME]);
    expect(
      (await fs.readdir(path.join(folder(), "Kitchen"))).toSorted(),
    ).toEqual([PROJECT_FILE_NAME, "plan.pdf"]);
    expect(readProjectsSync(root)).toMatchObject([
      { id: "top_1", instructions: "Induction only.", name: "Kitchen" },
    ]);
    expect(await moveTopicsToProjects(root)).toEqual({ done: [], left: [] });
  });

  it("moves topics in beside projects already there, leaving one whose name is taken", async () => {
    await writeTopic("Kitchen", "---\nid: top_1\n---\n");
    await writeTopic("Trips", "---\nid: top_2\n---\n");
    await fs.mkdir(path.join(folder(), "Trips"), { recursive: true });

    const moved = await moveTopicsToProjects(root);

    expect(moved.left).toEqual([
      {
        reason: "Projects/ already has a Trips",
        where: path.join(root, "Topics", "Trips"),
      },
    ]);
    expect((await fs.readdir(folder())).toSorted()).toEqual([
      "Kitchen",
      "Trips",
    ]);
    expect(await fs.readdir(path.join(root, "Topics"))).toEqual(["Trips"]);
    expect(await fs.readdir(path.join(folder(), "Kitchen"))).toEqual([
      PROJECT_FILE_NAME,
    ]);
  });

  it("takes Topics away once only what the system left in it remains", async () => {
    await writeTopic("Kitchen", "---\nid: top_1\n---\n");
    await fs.writeFile(path.join(root, "Topics", ".DS_Store"), "");
    await fs.mkdir(folder(), { recursive: true });
    await fs.writeFile(path.join(folder(), ".DS_Store"), "");

    expect(await moveTopicsToProjects(root)).toEqual({
      done: [
        "moved Topics/Kitchen to Projects/",
        "renamed Kitchen/TOPIC.md to AGENTS.md",
      ],
      left: [],
    });
    expect(await fs.readdir(root)).toEqual([PROJECTS_FOLDER_NAME]);
    expect(await moveTopicsToProjects(root)).toEqual({ done: [], left: [] });
  });

  it("does nothing for a workspace with no Topics folder", async () => {
    expect(await moveTopicsToProjects(root)).toEqual({ done: [], left: [] });
  });
});
