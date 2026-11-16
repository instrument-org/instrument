import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { utcStamp } from "../utc-stamp";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { readProjectRecords } from "./project-records";
import {
  createProject,
  folderProjectId,
  listProjects,
  retireProject,
  PROJECT_FILE_NAME,
  projectName,
  ProjectNameError,
  projectsDir,
  readProjectsSync,
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
  it("keeps the instructions alone in AGENTS.md and the rest in the projects store", async () => {
    const made = await createProject({
      about: "What to buy and where",
      emoji: "🛒",
      name: "Shopping",
    });
    expect(tree(projectsDir())).toEqual([]);
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
      "I have the Prime card.
      "
    `);
    expect(storeOf(made.id)).toEqual({
      about: "What to buy and where",
      color: "amber",
      created: utcStamp(made.created),
      emoji: "🛒",
      folder: "Shopping",
    });
    expect(await listProjects()).toEqual([
      {
        ...made,
        color: "amber",
        folders: [{ path: "/Users/someone/Deals" }],
        instructions: "I have the Prime card.",
      },
    ]);
  });

  it("takes the file away when the instructions are cleared", async () => {
    const made = await createProject({
      instructions: "Aisle seats.",
      name: "Trips",
    });
    expect(tree(projectsDir())).toEqual(["Trips/AGENTS.md"]);

    await updateProject(made.id, { instructions: "" });

    expect(tree(projectsDir())).toEqual([]);
    expect(fsSync.existsSync(path.join(projectsDir(), "Trips"))).toBe(true);
  });

  it("never touches AGENTS.md for a change to anything else", async () => {
    const made = await createProject({ name: "Trips" });
    const file = path.join(projectsDir(), "Trips", PROJECT_FILE_NAME);
    // Written by hand, or by another agent opened in the folder.
    await fs.writeFile(file, "Aisle seats, always.\n");

    await updateProject(made.id, { color: "amber", emoji: "✈️" });
    await retireProject(made.id);

    expect(await fs.readFile(file, "utf8")).toBe("Aisle seats, always.\n");
    expect(storeOf(made.id)).toMatchObject({
      color: "amber",
      emoji: "✈️",
      retired: true,
    });
  });

  it("keeps the created stamp in the store as ISO 8601 in UTC, to the second", async () => {
    const made = await createProject({ name: "Shopping" });

    expect(storeOf(made.id)?.created).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    );
    expect(storeOf(made.id)?.created).toBe(utcStamp(made.created));
    // What is in hand and what is read back are the same project, to the second.
    expect((await listProjects())[0]?.created).toEqual(made.created);
  });

  it("keeps a key in the front matter it does not know, where it found it", async () => {
    const made = await createProject({ emoji: "✈️", name: "Trips" });
    // Two keys another client wrote, which this build has never heard of.
    await fs.writeFile(
      path.join(projectsDir(), "Trips", PROJECT_FILE_NAME),
      `---\nsortsAfter: Home\nseen:\n  - phone\n---\n`,
    );

    await updateProject(made.id, { instructions: "Aisle seats." });

    expect(await projectFile("Trips")).toMatchInlineSnapshot(`
      "---
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
    expect(storeOf(made.id)?.folder).toBe("Travel");

    await fs.rename(
      path.join(projectsDir(), "Travel"),
      path.join(projectsDir(), "Away"),
    );
    expect(await listProjects()).toEqual([
      { ...made, instructions: "Aisle seats.", name: "Away" },
    ]);
    // Written down, so a folder made later cannot make it ambiguous.
    expect(storeOf(made.id)?.folder).toBe("Away");
    await fs.mkdir(path.join(projectsDir(), "Garden"));
    expect((await listProjects()).map(({ id, name }) => [name, id])).toEqual([
      ["Away", made.id],
      ["Garden", folderProjectId("Garden")],
    ]);
  });

  it("keeps a project's id for its folder while its AGENTS.md cannot be read", async () => {
    const made = await createProject({ name: "Trips" });
    // A file that is there but cannot be read, on every system.
    await fs.mkdir(path.join(projectsDir(), "Trips", PROJECT_FILE_NAME));
    await fs.mkdir(path.join(projectsDir(), "Garden"));

    expect((await listProjects()).map(({ id, name }) => [name, id])).toEqual([
      ["Garden", folderProjectId("Garden")],
    ]);
    expect(storeOf(made.id)?.folder).toBe("Trips");
  });

  it("keeps working when another agent rewrites AGENTS.md whole", async () => {
    const made = await createProject({
      emoji: "🌱",
      instructions: "Water on Sundays.",
      name: "Garden",
    });
    await fs.writeFile(
      path.join(projectsDir(), "Garden", PROJECT_FILE_NAME),
      "# Garden\n\nWater on Sundays and Wednesdays.\n",
    );

    expect(await listProjects()).toEqual([
      {
        ...made,
        instructions: "# Garden\n\nWater on Sundays and Wednesdays.",
      },
    ]);
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
      { instructions: undefined, name: "Garden", unsaved: undefined },
      {
        instructions: "# Repo\n\nRun the tests first.",
        name: "Repo",
        unsaved: undefined,
      },
    ]);
    // Each goes by an id drawn from its folder's name, the same on every
    // read and every computer, and a running workspace writes it down.
    expect(listed.map((project) => project.id)).toEqual([
      folderProjectId("Garden"),
      folderProjectId("Repo"),
    ]);
    expect(storeOf(folderProjectId("Garden"))?.folder).toBe("Garden");
    expect((await listProjects()).map((project) => project.id)).toEqual(
      listed.map((project) => project.id),
    );
    expect(tree(projectsDir())).toEqual(["Repo/AGENTS.md", "notes.txt"]);
  });

  it("writes nothing down where it reads with no device, and the id waits for saveProjectId", async () => {
    await fs.mkdir(path.join(projectsDir(), "Repo"), { recursive: true });
    await fs.writeFile(
      path.join(projectsDir(), "Repo", PROJECT_FILE_NAME),
      "# Repo\n\nRun the tests first.\n",
    );
    const id = folderProjectId("Repo");
    expect(
      readProjectsSync(getWorkspaceConfig().rootDir, { device: null }),
    ).toMatchObject([{ id, unsaved: true }]);
    expect(storeOf(id)).toBeUndefined();

    expect(await saveProjectId(id)).toBe(true);
    expect(await saveProjectId("prj_nothing")).toBe(false);

    expect(await projectFile("Repo")).toBe("# Repo\n\nRun the tests first.\n");
    await fs.rename(
      path.join(projectsDir(), "Repo"),
      path.join(projectsDir(), "Code"),
    );
    const [code] = await listProjects();
    expect(code).toMatchObject({ id, name: "Code" });
    expect(code).not.toHaveProperty("unsaved");
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

/** A project's record as the projects store has it. */
function storeOf(id: string) {
  return readProjectRecords(getWorkspaceConfig().rootDir).get(id);
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
