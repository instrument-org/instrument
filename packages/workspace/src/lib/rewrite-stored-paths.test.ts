import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";

import { withTempDir } from "../test/helpers/temp-dir";
import {
  registerStoredPaths,
  rewriteStoredPaths,
  settleMovedPaths,
  type StoredPathRewrite,
} from "./rewrite-stored-paths";

const workspace = withTempDir("rewrite-stored-paths-workspace");
const machine = withTempDir("rewrite-stored-paths-machine");

function write(file: string, contents = "") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function at(...segments: string[]) {
  return path.join(workspace.path, ...segments);
}

const permissionsFile = () => path.join(machine.path, "permissions.json");

function permissions(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(permissionsFile(), "utf8")) as Record<
    string,
    unknown
  >;
}

/** The one move every test here uses: `chats/` out into the work folder. */
function move() {
  return {
    from: at("chats"),
    to: path.join(machine.path, "work"),
  };
}

/** Settings › Permissions holding a path under each of its three shapes. */
function writePermissions(folder: string) {
  write(
    permissionsFile(),
    JSON.stringify({
      chats: {
        c: {
          denials: [
            {
              deniedAt: "2026-10-01T00:00:00.000Z",
              kind: "folder",
              target: folder,
            },
            {
              deniedAt: "2026-10-01T00:00:00.000Z",
              kind: "app",
              target: "Mail",
            },
          ],
          grants: [
            {
              grantedAt: "2026-10-01T00:00:00.000Z",
              path: folder,
              source: "attached",
            },
          ],
        },
      },
      dangerouslyAllowEveryFolder: false,
      folders: [
        { addedAt: "2026-10-01T00:00:00.000Z", level: "allow", path: folder },
      ],
    }),
  );
}

function rewrite() {
  return rewriteStoredPaths({
    machineDir: machine.path,
    moves: [move()],
    rootDir: workspace.path,
  });
}

describe("Settings › Permissions", () => {
  it("writes a folder rule, a chat's grant and a folder it said no to where the folder went", () => {
    const before = at("chats", "c", "notes");
    const now = path.join(machine.path, "work", "c", "notes");
    fs.mkdirSync(now, { recursive: true });
    writePermissions(before);

    const done = rewrite();

    expect(permissions()).toMatchObject({
      chats: {
        c: {
          denials: [{ target: now }, { target: "Mail" }],
          grants: [{ path: now, source: "attached" }],
        },
      },
      dangerouslyAllowEveryFolder: false,
      folders: [{ level: "allow", path: now }],
    });
    expect(done).toEqual([
      `wrote 3 path(s) where they went in ${permissionsFile()}`,
    ]);
  });

  it("writes nothing on the run after, since the paths are where they say", () => {
    const now = path.join(machine.path, "work", "c", "notes");
    fs.mkdirSync(now, { recursive: true });
    writePermissions(at("chats", "c", "notes"));
    rewrite();
    const written = fs.readFileSync(permissionsFile(), "utf8");

    expect(rewrite()).toEqual([]);
    expect(fs.readFileSync(permissionsFile(), "utf8")).toBe(written);
  });

  it("leaves a folder of the person's own that no move holds", () => {
    const outside = path.join(machine.path, "Deals");
    fs.mkdirSync(outside, { recursive: true });
    writePermissions(outside);

    expect(rewrite()).toEqual([]);
    expect(permissions()).toMatchObject({ folders: [{ path: outside }] });
  });

  // A folder-by-folder move can leave an entry behind, and the path that
  // entry has is still the right one.
  it("leaves a path whose folder is still where it says", () => {
    const stayed = at("chats", "c", "notes");
    fs.mkdirSync(stayed, { recursive: true });
    writePermissions(stayed);

    expect(rewrite()).toEqual([]);
    expect(permissions()).toMatchObject({ folders: [{ path: stayed }] });
  });
});

describe("a topic's granted folders", () => {
  const topicFile = () => at("Topics", "Home", "TOPIC.md");

  it("writes them where they went, in this computer's permission settings", () => {
    const now = path.join(machine.path, "work", "c", "notes");
    fs.mkdirSync(now, { recursive: true });
    write(
      permissionsFile(),
      JSON.stringify({
        topics: {
          top_1: {
            folders: [
              {
                addedAt: "2026-10-01T00:00:00.000Z",
                path: at("chats", "c", "notes"),
              },
              {
                addedAt: "2026-10-01T00:00:00.000Z",
                path: "/Users/someone/Deals",
              },
            ],
          },
        },
      }),
    );

    const done = rewrite();

    expect(permissions()).toMatchObject({
      topics: {
        top_1: {
          folders: [{ path: now }, { path: "/Users/someone/Deals" }],
        },
      },
    });
    expect(done).toEqual([
      `wrote 1 path(s) where they went in ${permissionsFile()}`,
    ]);
  });

  // The folders a topic's file lists are read once per computer, by the
  // launch that moves them into the settings, and never rewritten here.
  it("leaves a topic's file as it is", () => {
    const listed = [
      "---",
      "id: top_1",
      "folders:",
      `  - path: ${at("chats", "c", "notes")}`,
      "---",
      "",
    ].join("\n");
    fs.mkdirSync(path.join(machine.path, "work", "c", "notes"), {
      recursive: true,
    });
    write(topicFile(), listed);

    expect(rewrite()).toEqual([]);
    expect(fs.readFileSync(topicFile(), "utf8")).toBe(listed);
  });
});

describe("a draft's attachments", () => {
  const draftFile = () => at("Drafts", "2026-10-16", "DRAFT.md");

  function writeDraft(...attached: string[]) {
    write(
      draftFile(),
      [
        "---",
        'id: "d1"',
        "created: 2026-10-16T00:00:00.000Z",
        "updated: 2026-10-16T09:00:00.000Z",
        "attached:",
        ...attached.flatMap((item) => [
          `  - path: ${JSON.stringify(item)}`,
          "    kind: file",
        ]),
        "---",
        "",
        "Have a look at this.\n",
      ].join("\n"),
    );
  }

  it("writes an attached file where its folder went", () => {
    const now = path.join(machine.path, "work", "c", "notes", "report.md");
    fs.mkdirSync(path.dirname(now), { recursive: true });
    write(now, "report");
    writeDraft(at("chats", "c", "notes", "report.md"), "pasted-image.png");

    const done = rewrite();

    const written = fs.readFileSync(draftFile(), "utf8");
    expect(written).toContain(`- path: ${JSON.stringify(now)}`);
    // What was pasted into the draft is beside it, so its path is the
    // draft folder's and no move holds it.
    expect(written).toContain('- path: "pasted-image.png"');
    // The person's words and when the draft last changed are untouched, so
    // the rewrite does not move it to the front of its chat's box.
    expect(written).toContain("Have a look at this.");
    expect(written).toContain("updated: 2026-10-16T09:00:00.000Z");
    expect(done).toEqual([`wrote 1 path(s) where they went in ${draftFile()}`]);
  });

  it("writes nothing on the run after, since the paths are where they say", () => {
    const now = path.join(machine.path, "work", "c", "notes", "report.md");
    fs.mkdirSync(path.dirname(now), { recursive: true });
    write(now, "report");
    writeDraft(at("chats", "c", "notes", "report.md"));
    rewrite();
    const written = fs.readFileSync(draftFile(), "utf8");

    expect(rewrite()).toEqual([]);
    expect(fs.readFileSync(draftFile(), "utf8")).toBe(written);
  });

  it("leaves a file of the person's own that no move holds", () => {
    const outside = path.join(machine.path, "Deals", "offer.pdf");
    fs.mkdirSync(path.dirname(outside), { recursive: true });
    write(outside, "pdf");
    writeDraft(outside);

    expect(rewrite()).toEqual([]);
    expect(fs.readFileSync(draftFile(), "utf8")).toContain(
      `- path: ${JSON.stringify(outside)}`,
    );
  });
});

describe("the stores the app registers", () => {
  function register(name: string, store: StoredPathRewrite) {
    onTestFinished(registerStoredPaths(name, store));
  }

  it("runs every one on a call that passes nothing for them, with the machine folder, and keeps what each says", () => {
    const now = path.join(machine.path, "work", "c", "notes");
    fs.mkdirSync(now, { recursive: true });
    register("window", ({ machineDir, where }) => [
      `a tab in ${machineDir} opens on ${where(at("chats", "c", "notes"))}`,
    ]);
    register("browser", ({ moves }) =>
      moves.map((one) => `a recent file moved to ${one.to}`),
    );

    expect(rewrite()).toEqual([
      `a tab in ${machine.path} opens on ${now}`,
      `a recent file moved to ${path.join(machine.path, "work")}`,
    ]);
  });

  it("runs one registered twice under a name once", () => {
    register("window", () => ["first"]);
    register("window", () => ["second"]);

    expect(rewrite()).toEqual(["second"]);
  });

  it("carries on past one that throws, and says which", () => {
    register("browser", () => {
      throw new Error("no history here");
    });
    register("window", () => ["the window's tabs are where they went"]);

    expect(rewrite()).toMatchInlineSnapshot(`
      [
        "left the app's browser store as it is (Error: no history here)",
        "the window's tabs are where they went",
      ]
    `);
  });

  it("is none outside the app, which leaves the package's own stores to rewrite", () => {
    const now = path.join(machine.path, "work", "c", "notes");
    fs.mkdirSync(now, { recursive: true });
    writePermissions(at("chats", "c", "notes"));

    expect(rewrite()).toEqual([
      `wrote 3 path(s) where they went in ${permissionsFile()}`,
    ]);
  });
});

describe("the record of moves an earlier build kept", () => {
  const movedPathsFile = () => path.join(machine.path, "moved-paths.json");

  function settle() {
    return settleMovedPaths({
      machineDir: machine.path,
      rootDir: workspace.path,
    });
  }

  it("is taken in, written into the files holding those paths, and goes", () => {
    const now = path.join(machine.path, "work", "c", "notes");
    fs.mkdirSync(now, { recursive: true });
    writePermissions(at("chats", "c", "notes"));
    write(movedPathsFile(), JSON.stringify({ moves: [move()] }));

    const done = settle();

    expect(permissions()).toMatchObject({ folders: [{ path: now }] });
    expect(fs.existsSync(movedPathsFile())).toBe(false);
    expect(done).toEqual([
      `wrote 3 path(s) where they went in ${permissionsFile()}`,
      `took in and removed ${movedPathsFile()}`,
    ]);
  });

  it("says nothing on the boot after, and on an install that never had one", () => {
    expect(settle()).toEqual([]);
  });

  it("goes when it cannot be read, since nothing can be followed through it", () => {
    write(movedPathsFile(), "{ not json");

    expect(settle()).toEqual([]);
    expect(fs.existsSync(movedPathsFile())).toBe(false);
  });
});
