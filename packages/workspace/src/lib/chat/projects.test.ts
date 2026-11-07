import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { utcStamp } from "../utc-stamp";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import {
  createProject,
  folderProjectId,
  listProjects,
  retireProject,
  PROJECT_FILE_NAME,
  projectName,
  ProjectNameError,
  projectsDir,
  saveProjectId,
  updateProject,
} from "./projects";

// Projects are files at the workspace root, so each test gets a root of its
// own, removed after it rather than left in the machine's temporary folder.
const roots: string[] = [];

beforeEach(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "projects-"));
  roots.push(root);
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(path.join(root, "chats")),
    rootDir: WorkspaceDirSchema.parse(root),
    workspaceMachineDir: AbsolutePathSchema.parse(path.join(root, ".machine")),
  });
});

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { force: true, recursive: true })),
  );
});

describe("projectName", () => {
  it.each([
    ["#Reddit", "Reddit"],
    ["  Pelican   News  ", "Pelican News"],
    ["a name that runs well past the limit", "a name that runs well pa"],
  ])("makes %j into %j", (raw, expected) => {
    expect(projectName(raw)).toBe(expected);
  });
});

describe("createProject", () => {
  it("adds a project with an id of its own, keeping the order", async () => {
    const reddit = await createProject({ emoji: "🦆", name: "# Reddit" });
    const home = await createProject({ name: "Home" });

    expect(reddit.id).toMatch(/^prj_/);
    expect(reddit.name).toBe("Reddit");
    expect(reddit.emoji).toBe("🦆");
    const listed = await listProjects();
    expect(listed.map((project) => project.id)).toEqual([reddit.id, home.id]);
  });
});

describe("updateProject", () => {
  it("changes what was given and leaves the rest", async () => {
    const made = await createProject({ emoji: "🦆", name: "Reddit" });

    await updateProject(made.id, { color: "#ff0000", name: "Ducks" });

    expect(await listProjects()).toEqual([
      { ...made, color: "#ff0000", name: "Ducks" },
    ]);
  });

  it("swaps an emoji for an icon and back, keeping the color", async () => {
    const made = await createProject({
      color: "amber",
      emoji: "🦆",
      name: "Reddit",
    });

    await updateProject(made.id, { emoji: "", icon: "bird" });
    const withIcon = (await listProjects())[0];
    await updateProject(made.id, { emoji: "🐤", icon: "" });
    const withEmoji = (await listProjects())[0];

    expect(
      [withIcon, withEmoji].map((each) => [each?.emoji, each?.icon]),
    ).toEqual([
      [undefined, "bird"],
      ["🐤", undefined],
    ]);
    expect(withEmoji?.color).toBe("amber");
  });

  it("keeps a project's emoji through a change that names no mark", async () => {
    const made = await createProject({ emoji: "🦆", name: "Reddit" });

    await updateProject(made.id, { instructions: "Old posts first." });

    expect((await listProjects())[0]?.emoji).toBe("🦆");
  });
});

describe("retireProject", () => {
  it("moves a project behind the ones in use", async () => {
    const reddit = await createProject({ name: "Reddit" });
    const home = await createProject({ name: "Home" });

    await retireProject(reddit.id);

    const listed = await listProjects();
    expect(listed.map((project) => [project.id, project.retired])).toEqual([
      [home.id, undefined],
      [reddit.id, true],
    ]);
  });
});

describe("project folders", () => {
  it("keeps the whole project in one AGENTS.md, in a folder by name", async () => {
    const made = await createProject({
      about: "What to buy and where",
      emoji: "🛒",
      name: "Shopping",
    });
    await updateProject(made.id, {
      color: "amber",
      folders: [{ path: "/Users/someone/Deals" }],
      instructions: "I have the Prime card.",
    });

    expect(tree(projectsDir())).toMatchInlineSnapshot(`
      [
        "Shopping/AGENTS.md",
      ]
    `);
    expect(await projectFile("Shopping")).toMatchInlineSnapshot(`
      "---
      id: <id>
      emoji: 🛒
      color: amber
      about: What to buy and where
      created: <created>
      ---

      I have the Prime card.
      "
    `);
    expect(await listProjects()).toEqual([
      {
        ...made,
        color: "amber",
        folders: [{ path: "/Users/someone/Deals" }],
        instructions: "I have the Prime card.",
      },
    ]);
  });

  it("writes the created stamp as ISO 8601 in UTC, to the second", async () => {
    const made = await createProject({ name: "Shopping" });

    const front = await projectFile("Shopping", { stamps: false });
    expect(front).toMatch(/^created: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/m);
    expect(front).toContain(`created: ${utcStamp(made.created)}`);
    // What is in hand and what is on disk are the same project, to the second.
    expect((await listProjects())[0]?.created).toEqual(made.created);
  });

  it("marks a retired project, and says nothing of one in the menus", async () => {
    const made = await createProject({ name: "Trips" });
    expect(await projectFile("Trips")).not.toContain("retired");

    await retireProject(made.id);

    expect(await projectFile("Trips")).toContain("retired: true");
  });

  it("writes back a key it does not know, where it found it", async () => {
    const made = await createProject({ emoji: "✈️", name: "Trips" });
    // Two keys another client wrote, which this build has never heard of.
    await fs.writeFile(
      path.join(projectsDir(), "Trips", PROJECT_FILE_NAME),
      `---\nid: ${made.id}\nemoji: ✈️\ncreated: ${utcStamp(made.created)}\nsortsAfter: Home\nseen:\n  - phone\n---\n`,
    );

    await updateProject(made.id, { instructions: "Aisle seats." });

    expect(await projectFile("Trips")).toMatchInlineSnapshot(`
      "---
      id: <id>
      emoji: ✈️
      created: <created>
      sortsAfter: Home
      seen:
        - phone
      ---

      Aisle seats.
      "
    `);
    expect((await listProjects())[0]?.others).toEqual({
      seen: ["phone"],
      sortsAfter: "Home",
    });
  });

  it("renames the folder with the project, and a folder renamed by hand renames the project", async () => {
    const made = await createProject({ name: "Trips" });
    await updateProject(made.id, { instructions: "Aisle seats." });

    await updateProject(made.id, { name: "Travel" });
    expect(tree(projectsDir())).toMatchInlineSnapshot(`
      [
        "Travel/AGENTS.md",
      ]
    `);

    await fs.rename(
      path.join(projectsDir(), "Travel"),
      path.join(projectsDir(), "Away"),
    );
    expect(await listProjects()).toEqual([
      { ...made, instructions: "Aisle seats.", name: "Away" },
    ]);
    // The name is the folder's, so nothing in the file says it.
    expect(await projectFile("Away")).not.toContain("Away");
  });

  it("lists every folder as a project, the person's own included, and none of the system's", async () => {
    await fs.mkdir(path.join(projectsDir(), "Garden"), { recursive: true });
    await fs.mkdir(path.join(projectsDir(), "Repo"));
    await fs.writeFile(
      path.join(projectsDir(), "Repo", PROJECT_FILE_NAME),
      "# Repo\n\nRun the tests first.\n",
    );
    await fs.mkdir(path.join(projectsDir(), ".git"));
    await fs.writeFile(path.join(projectsDir(), "notes.txt"), "not a folder");

    const listed = await listProjects();

    expect(
      listed.map(({ instructions, name, unsaved }) => ({
        instructions,
        name,
        unsaved,
      })),
    ).toEqual([
      { instructions: undefined, name: "Garden", unsaved: true },
      {
        instructions: "# Repo\n\nRun the tests first.",
        name: "Repo",
        unsaved: true,
      },
    ]);
    // Each goes by an id drawn from its folder's name, the same on every read,
    // and nothing is written until something points at one.
    expect(listed.map((project) => project.id)).toEqual([
      folderProjectId("Garden"),
      folderProjectId("Repo"),
    ]);
    expect((await listProjects()).map((project) => project.id)).toEqual(
      listed.map((project) => project.id),
    );
    expect(tree(projectsDir())).toEqual(["Repo/AGENTS.md", "notes.txt"]);
  });

  it("writes the id it went by into a file with none, keeping every word, when something points at it", async () => {
    await fs.mkdir(path.join(projectsDir(), "Repo"), { recursive: true });
    await fs.writeFile(
      path.join(projectsDir(), "Repo", PROJECT_FILE_NAME),
      "# Repo\n\nRun the tests first.\n",
    );
    await fs.mkdir(path.join(projectsDir(), "Garden"));
    const id = folderProjectId("Repo");

    expect(await saveProjectId(id)).toBe(true);
    expect(await saveProjectId(folderProjectId("Garden"))).toBe(true);
    expect(await saveProjectId("prj_nothing")).toBe(false);

    expect(await projectFile("Repo")).toBe(
      "---\nid: <id>\ncreated: <created>\n---\n\n# Repo\n\nRun the tests first.\n",
    );
    await fs.rename(
      path.join(projectsDir(), "Repo"),
      path.join(projectsDir(), "Code"),
    );
    const [garden, code] = await listProjects();
    expect(code).toMatchObject({ id, name: "Code" });
    expect(code).not.toHaveProperty("unsaved");
    expect(garden).toMatchObject({ id: folderProjectId("Garden") });
    expect(garden).not.toHaveProperty("unsaved");
  });

  it.each([
    [
      "a name another project has",
      "home",
      "There is already a project called “Home”",
    ],
    [
      "a character no folder can hold",
      "Deals: big",
      "Project name can't contain any of: < > : \" / \\ | ? *",
    ],
    ["a leading period", ".hidden", "Project name can't start with a period"],
  ])("refuses %s", async (_case, name, message) => {
    await createProject({ name: "Home" });
    const made = await createProject({ name: "Trips" });

    await expect(updateProject(made.id, { name })).rejects.toThrow(
      new ProjectNameError(message),
    );
  });

  it("returns the project already called that, and brings back a retired one", async () => {
    const made = await createProject({ name: "Trips" });
    await updateProject(made.id, { instructions: "Aisle seats." });

    const again = await createProject({ name: "trips" });
    expect(again.id).toBe(made.id);
    await retireProject(made.id);
    const revived = await createProject({ emoji: "✈️", name: "Trips" });
    expect(revived).toEqual({
      ...made,
      emoji: "✈️",
      instructions: "Aisle seats.",
    });
    const [listed] = await listProjects();
    expect(listed?.retired).toBeUndefined();
  });

  it.each([
    ["instructions", { instructions: "Window seats." }],
    ["folders", { folders: [{ path: os.tmpdir() }] }],
  ])(
    "refuses a name in use given %s, leaving that project as it was",
    async (_case, given) => {
      const made = await createProject({ name: "Trips" });
      await updateProject(made.id, { instructions: "Aisle seats." });

      await expect(createProject({ name: "trips", ...given })).rejects.toThrow(
        new ProjectNameError("There is already a project called “Trips”"),
      );
      expect(await listProjects()).toEqual([
        { ...made, instructions: "Aisle seats." },
      ]);
    },
  );
});

/**
 * A project's file as it reads, with the two values no snapshot can hold still
 * stood in for: its id and the moment it was made.
 */
async function projectFile(
  name: string,
  { stamps = true }: { stamps?: boolean } = {},
): Promise<string> {
  const text = await fs.readFile(
    path.join(projectsDir(), name, PROJECT_FILE_NAME),
    "utf8",
  );
  return stamps
    ? text
        .replace(/^id: .+$/m, "id: <id>")
        .replace(/^created: .+$/m, "created: <created>")
    : text;
}

function tree(dir: string): string[] {
  return fsSync
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path
        .relative(dir, path.join(entry.parentPath, entry.name))
        .replaceAll(path.sep, "/"),
    )
    .sort();
}
