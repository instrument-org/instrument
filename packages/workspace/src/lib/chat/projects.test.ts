import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { utcStamp } from "../utc-stamp";
import { SyncedStoreBehindError } from "../synced-store/synced-store";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { DeviceIdSchema } from "../../schemas/device-id";
import {
  projectRecords,
  projectsStore,
  writeProjectRecords,
} from "./project-records";
import {
  createProject,
  folderProjectId,
  listProjects,
  retireProject,
  PROJECT_FILE_NAME,
  PROJECT_ID_FILE_NAME,
  projectName,
  ProjectNameError,
  projectsDir,
  readProjects,
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
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 16), toFake: ["Date"] });
    const reddit = await createProject({ emoji: "🦆", name: "# Reddit" });
    vi.advanceTimersByTime(1000);
    const home = await createProject({ name: "Home" });
    vi.useRealTimers();

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
    expect(await storeOf(made.id)).toEqual({
      about: "What to buy and where",
      color: "amber",
      created: utcStamp(made.created),
      emoji: "🛒",
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
    expect(await storeOf(made.id)).toMatchObject({
      color: "amber",
      emoji: "✈️",
      retired: true,
    });
  });

  it("keeps the created stamp in the store as ISO 8601 in UTC, to the second", async () => {
    const made = await createProject({ name: "Shopping" });

    expect((await storeOf(made.id))?.created).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    );
    expect((await storeOf(made.id))?.created).toBe(utcStamp(made.created));
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
    expect(idFileOf("Travel")).toBe(made.id);

    await fs.rename(
      path.join(projectsDir(), "Travel"),
      path.join(projectsDir(), "Away"),
    );
    expect(await listProjects()).toEqual([
      { ...made, instructions: "Aisle seats.", name: "Away" },
    ]);
    expect(idFileOf("Away")).toBe(made.id);
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
    expect(idFileOf("Trips")).toBe(made.id);
    expect(await storeOf(made.id)).toBeDefined();
  });

  it("makes a folder made where a deleted one was a project of its own", async () => {
    const old = await createProject({ emoji: "🧳", name: "Old" });
    await retireProject(old.id);
    await fs.rm(path.join(projectsDir(), "Old"), { recursive: true });
    await fs.mkdir(path.join(projectsDir(), "Recipes"));

    expect(await listProjects()).toMatchObject([
      { id: folderProjectId("Recipes"), name: "Recipes" },
    ]);
    expect((await listProjects())[0]).not.toHaveProperty("retired");
    expect((await listProjects())[0]).not.toHaveProperty("emoji");
  });

  it("makes a copy of a project's folder a project of its own", async () => {
    const made = await createProject({ emoji: "🧳", name: "Trips" });
    await fs.cp(
      path.join(projectsDir(), "Trips"),
      path.join(projectsDir(), "Trips copy"),
      { recursive: true },
    );

    const listed = await listProjects();

    expect(listed.map(({ id, name }) => [name, id])).toEqual([
      ["Trips", made.id],
      ["Trips copy", folderProjectId("Trips copy")],
    ]);
    expect(idFileOf("Trips copy")).toBe(folderProjectId("Trips copy"));
  });

  it("follows the folder that arrives with its id before its record", async () => {
    const made = await createProject({ emoji: "🧳", name: "Trips" });
    // Renamed on another computer: the folder and its id file arrive here
    // under the new name, and nothing in the store names a folder.
    await fs.rename(
      path.join(projectsDir(), "Trips"),
      path.join(projectsDir(), "Away"),
    );

    expect(await listProjects()).toMatchObject([
      { emoji: "🧳", id: made.id, name: "Away" },
    ]);
  });

  it("takes the record of the computer that made a project when it syncs in after the folder", async () => {
    const id = folderProjectId("Trips");
    // The folder and its id file arrive from the other computer first.
    await fs.mkdir(path.join(projectsDir(), "Trips"), { recursive: true });
    await fs.writeFile(
      path.join(projectsDir(), "Trips", PROJECT_ID_FILE_NAME),
      `${id}\n`,
    );
    expect(await listProjects()).toMatchObject([{ id, name: "Trips" }]);

    // Then its record, written there before this computer read the folder.
    await writeProjectRecords(await otherDevice(), [
      {
        at: Date.UTC(2026, 0, 1),
        id,
        record: { color: "blue", created: "2026-01-01T00:00:00Z", emoji: "🧳" },
      },
    ]);
    await (await projectsStore()).look();

    expect(await listProjects()).toMatchObject([
      { color: "blue", emoji: "🧳", id, name: "Trips" },
    ]);
  });

  it("leaves a folder whose id file cannot be read, and lists the others", async () => {
    const home = await createProject({ name: "Home" });
    const trips = path.join(projectsDir(), "Trips");
    // A folder in the id file's place reads as an error that is not "missing".
    await fs.mkdir(path.join(trips, PROJECT_ID_FILE_NAME), { recursive: true });

    expect(await readProjects()).toMatchObject([{ id: home.id }]);
    expect(await listProjects()).toMatchObject([{ id: home.id }]);
    expect(
      fsSync.statSync(path.join(trips, PROJECT_ID_FILE_NAME)).isDirectory(),
    ).toBe(true);
  });

  it("gives a new project named like a deleted one an id of its own", async () => {
    const first = await createProject({ name: "Taxes" });
    await fs.rm(path.join(projectsDir(), "Taxes"), { recursive: true });

    const second = await createProject({ name: "Taxes" });

    expect(second.id).not.toBe(first.id);
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
      listed.map(({ instructions, name }) => ({ instructions, name })),
    ).toEqual([
      { instructions: undefined, name: "Garden" },
      {
        instructions: "# Repo\n\nRun the tests first.",
        name: "Repo",
      },
    ]);
    // Each goes by an id drawn from its folder's name, the same on every
    // read and every computer, and a running workspace writes it down.
    expect(listed.map((project) => project.id)).toEqual([
      folderProjectId("Garden"),
      folderProjectId("Repo"),
    ]);
    expect(await storeOf(folderProjectId("Garden"))).toBeDefined();
    expect(idFileOf("Garden")).toBe(folderProjectId("Garden"));
    expect((await listProjects()).map((project) => project.id)).toEqual(
      listed.map((project) => project.id),
    );
    expect(tree(projectsDir())).toEqual(["Repo/AGENTS.md", "notes.txt"]);
  });

  it("keeps a folder's id through a rename once something names it", async () => {
    await fs.mkdir(path.join(projectsDir(), "Repo"), { recursive: true });
    await fs.writeFile(
      path.join(projectsDir(), "Repo", PROJECT_FILE_NAME),
      "# Repo\n\nRun the tests first.\n",
    );
    const id = folderProjectId("Repo");
    expect(await storeOf(id)).toBeUndefined();

    expect(await saveProjectId(id)).toBe(true);
    expect(await saveProjectId("prj_nothing")).toBe(false);

    expect(await projectFile("Repo")).toBe("# Repo\n\nRun the tests first.\n");
    await fs.rename(
      path.join(projectsDir(), "Repo"),
      path.join(projectsDir(), "Code"),
    );
    const [code] = await listProjects();
    expect(code).toMatchObject({ id, name: "Code" });
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
/** The id a project folder's `.instrument-project` names. */
function idFileOf(folder: string): string | undefined {
  try {
    return fsSync
      .readFileSync(
        path.join(projectsDir(), folder, PROJECT_ID_FILE_NAME),
        "utf8",
      )
      .trim();
  } catch {
    return undefined;
  }
}

async function storeOf(id: string) {
  return projectRecords(await projectsStore()).get(id);
}

function tree(dir: string): string[] {
  return (
    fsSync
      .readdirSync(dir, { recursive: true, withFileTypes: true })
      // The id file is in every project folder; these trees are what else is.
      .filter((entry) => entry.isFile() && entry.name !== PROJECT_ID_FILE_NAME)
      .map((entry) =>
        path
          .relative(dir, path.join(entry.parentPath, entry.name))
          .replaceAll(path.sep, "/"),
      )
      .sort()
  );
}

/** The projects store as another computer sharing the workspace has it. */
function otherDevice() {
  return projectsStore({
    device: DeviceIdSchema.parse("dev_Z9Y8X7W6"),
    rootDir: getWorkspaceConfig().rootDir,
  });
}

describe("a change made while another device's cannot be read", () => {
  it.runIf(process.platform !== "win32")(
    "is refused, and keeps what that device changed",
    async () => {
      const made = await createProject({ name: "Trips" });
      const other = await otherDevice();
      await other.caughtUp();
      await writeProjectRecords(other, [
        {
          id: made.id,
          record: { created: "2026-01-01T00:00:00Z", retired: true },
        },
      ]);
      const file = path.join(
        getWorkspaceConfig().rootDir,
        ".instrument/devices/dev_Z9Y8X7W6/projects.jsonl",
      );
      await fs.chmod(file, 0o000);

      await expect(
        updateProject(made.id, { color: "#ff0000" }),
      ).rejects.toThrow(SyncedStoreBehindError);

      await fs.chmod(file, 0o644);
      await updateProject(made.id, { color: "#ff0000" });
      expect(await storeOf(made.id)).toMatchObject({
        color: "#ff0000",
        retired: true,
      });
    },
  );
});

describe("changes asked for at once", () => {
  it("keep both, and make one project of one name", async () => {
    const [a, b] = await Promise.all([
      createProject({ name: "Trips" }),
      createProject({ name: "trips" }),
      listProjects(),
    ]);
    expect(a.id).toBe(b.id);
    await Promise.all([
      updateProject(a.id, { color: "#ff0000" }),
      updateProject(a.id, { about: "Where to go." }),
      updateProject(a.id, { name: "Travel" }),
      listProjects(),
    ]);
    expect(await listProjects()).toMatchObject([
      { about: "Where to go.", color: "#ff0000", id: a.id, name: "Travel" },
    ]);
    expect(idFileOf("Travel")).toBe(a.id);
    expect(fsSync.readdirSync(projectsDir())).toEqual(["Travel"]);
  });
});
