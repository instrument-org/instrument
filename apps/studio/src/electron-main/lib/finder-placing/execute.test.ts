import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fileJournal, type UndoOps, undoEntry } from "../file-journal";
import { executePlacing, fileSystemOps, type PlacingOps } from "./execute";
import { gatherPlaceRequest } from "./gather";
import { createLeftovers, type Leftover } from "./leftovers";
import { type Answer, clashesOf, planPlacing } from "./plan";

// No bridge: placing goes the way it does off the Mac, by hard link and
// checked rename, which the Mac module's own test covers the rest of.
vi.mock("../mac-native", () => ({
  caseSensitivity: () => Promise.resolve(undefined),
  finderEntries: () => Promise.resolve([]),
  renameExclusive: () => Promise.resolve(false),
}));

let root: string;
let trashed = 0;
let leftoverRecords: readonly Leftover[] = [];
beforeEach(async () => {
  trashed = 0;
  leftoverRecords = [];
  // Resolved, since placing works from the destination's real path.
  root = await fs.realpath(
    await fs.mkdtemp(path.join(tmpdir(), "finder-placing-")),
  );
  await fs.mkdir(path.join(root, "trash"));
  await fs.mkdir(path.join(root, "dest"));
});
afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

const at = (...parts: string[]) => path.join(root, ...parts);

/** A Trash in the test's own folder, which says where each thing landed. */
async function testTrash(where: string) {
  trashed += 1;
  const into = at("trash", `${trashed.toString()}-${path.basename(where)}`);
  await fs.rename(where, into);
  return { inTrash: into };
}

const leftovers = createLeftovers({
  read: () => leftoverRecords,
  write: (next) => {
    leftoverRecords = next;
  },
});

const ops = () => fileSystemOps({ leftovers, trash: testTrash });

/**
 * Fails the `n`th change it is asked to make, counting from 1, and counts
 * them all. `midway` changes fail after they have done their work instead
 * of before: a copy written and then a throw, a placement made and then one.
 */
function failingAt(n: number, base: PlacingOps, { midway = false } = {}) {
  const made = { count: 0 };
  const change =
    <Args extends unknown[], Result>(run: (...args: Args) => Promise<Result>) =>
    async (...args: Args) => {
      made.count += 1;
      if (made.count === n && !midway) {
        throw new Error("injected");
      }
      const result = await run(...args);
      if (made.count === n) {
        throw new Error("injected after");
      }
      return result;
    };
  const failing: PlacingOps = {
    ...base,
    copy: change(base.copy),
    place: change(base.place),
    removeStaging: change(base.removeStaging),
    trash: change(base.trash),
  };
  return { made, ops: failing };
}

/** Every file under the test's folder, Trash included unless left out, by where it is and what it says or points at. */
async function tree(options: { trash?: boolean } = {}) {
  const found: Record<string, string> = {};
  const visit = async (here: string) => {
    for (const name of (await fs.readdir(here)).toSorted()) {
      const where = path.join(here, name);
      const relative = path.relative(root, where);
      if (!options.trash && relative === "trash") continue;
      const stats = await fs.lstat(where);
      if (stats.isSymbolicLink()) {
        found[relative] = `-> ${await fs.readlink(where)}`;
      } else if (stats.isDirectory()) {
        found[`${relative}/`] = "";
        await visit(where);
      } else {
        found[relative] = await fs.readFile(where, "utf8");
      }
    }
  };
  await visit(root);
  return found;
}

/**
 * The original files whose contents are now in fewer places than before,
 * each content counted as often as it appears: every original byte must be
 * at its own path, placed, or in the Trash.
 */
async function lostContents(before: Record<string, string>) {
  const count = (files: Record<string, string>) => {
    const counts = new Map<string, number>();
    for (const [where, content] of Object.entries(files)) {
      if (!where.endsWith("/")) {
        counts.set(content, (counts.get(content) ?? 0) + 1);
      }
    }
    return counts;
  };
  const was = count(before);
  const now = count(await tree({ trash: true }));
  return [...was].filter(([content, n]) => (now.get(content) ?? 0) < n);
}

async function write(files: Record<string, string>) {
  for (const [where, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(at(where)), { recursive: true });
    await fs.writeFile(at(where), content);
  }
}

/** Plans a request the way the app does, with a disk the source can be said to be off. */
async function planFor({
  answers,
  offDisk = [],
  op,
  sources,
}: {
  answers: Record<string, Answer>;
  offDisk?: string[];
  op: "copy" | "move";
  sources: string[];
}) {
  const request = await gatherPlaceRequest(
    {
      answers: Object.fromEntries(
        Object.entries(answers).map(([source, answer]) => [at(source), answer]),
      ),
      folder: at("dest"),
      op,
      paths: sources.map((source) => at(source)),
    },
    { packagesIn: () => Promise.resolve(new Set()) },
  );
  const plan = planPlacing({
    ...request,
    // What the dialog would have shown in each Replace's way.
    replacing: Object.fromEntries(
      clashesOf(request).flatMap((clash) =>
        request.answers[clash.path] === "replace"
          ? [[clash.path, clash.with.identity]]
          : [],
      ),
    ),
    sources: request.sources.map((source) => ({
      ...source,
      onDestinationDisk:
        source.onDestinationDisk &&
        !offDisk.includes(path.relative(root, source.path)),
    })),
  });
  if ("refusal" in plan) throw new Error(plan.refusal);
  return plan.steps;
}

/** A copy of three things, one kept beside a taken name, one a folder with a link in it. */
async function copyScenario() {
  await write({
    "dest/b.txt": "old b",
    "src/a.txt": "new a",
    "src/b.txt": "new b",
    "src/pics/x.jpg": "x",
  });
  await fs.symlink("x.jpg", at("src/pics/latest"));
  return {
    op: "copy" as const,
    steps: await planFor({
      answers: { "src/b.txt": "keepBoth" },
      op: "copy",
      sources: ["src/a.txt", "src/b.txt", "src/pics"],
    }),
  };
}

/** A move of two files on one disk, and of a folder onto "another disk", which copies. */
async function moveScenario() {
  await write({
    "src/a.txt": "new a",
    "src/c.txt": "c",
    "src/pics/x.jpg": "x",
  });
  return {
    op: "move" as const,
    steps: await planFor({
      answers: {},
      offDisk: ["src/pics"],
      op: "move",
      sources: ["src/a.txt", "src/pics", "src/c.txt"],
    }),
  };
}

/** A copy over a file and a move over a folder, both replacing. */
async function replaceScenario() {
  await write({
    "dest/a.txt": "old a",
    "dest/pics/old.jpg": "old pics",
    "other/pics/x.jpg": "x",
    "src/a.txt": "new a",
  });
  const copy = await planFor({
    answers: { "src/a.txt": "replace" },
    op: "copy",
    sources: ["src/a.txt"],
  });
  const move = await planFor({
    answers: { "other/pics": "replace" },
    op: "move",
    sources: ["other/pics"],
  });
  return { op: "copy" as const, steps: [...copy, ...move] };
}

const UNDOABLE = { copy: copyScenario, move: moveScenario };
const ALL = { ...UNDOABLE, replace: replaceScenario };

async function undo(
  journal: Awaited<ReturnType<typeof executePlacing>>["journal"],
  options: Pick<Partial<UndoOps>, "rename"> = {},
) {
  if (!journal) return;
  await undoEntry(fileJournal.record(journal), {
    leftovers,
    trash: async (where) => {
      await testTrash(where);
    },
    ...options,
  });
}

describe("carrying out a plan", () => {
  it.each(Object.keys(UNDOABLE) as (keyof typeof UNDOABLE)[])(
    "does all of a %s and one undo puts everything back",
    async (scenario) => {
      const { op, steps } = await UNDOABLE[scenario]();
      const before = await tree();

      const outcome = await executePlacing(op, steps, ops());

      expect(outcome.failure).toBeNull();
      expect(await tree()).toMatchSnapshot();
      await undo(outcome.journal);
      expect(await tree()).toEqual(before);
      expect(leftoverRecords).toEqual([]);
    },
  );

  // What a Replace displaces goes to the Trash once what takes its place is
  // whole, and stays there: nothing is journaled, so there is no undo.
  it("sends what a replace displaces to the Trash, says where, and journals nothing", async () => {
    const { op, steps } = await replaceScenario();

    const outcome = await executePlacing(op, steps, ops());

    expect(outcome.failure).toBeNull();
    expect(outcome.journal).toBeNull();
    expect(
      outcome.trashed.map((each) => [
        path.relative(root, each.from),
        each.inTrash && path.relative(root, each.inTrash),
      ]),
    ).toEqual([
      ["dest/a.txt", "trash/1-a.txt"],
      ["dest/pics", "trash/2-pics"],
    ]);
    expect(await tree({ trash: true })).toMatchSnapshot();
  });

  // Every original byte is at its own path, placed, or in the Trash after a
  // failure at any step, before or midway through it; and where nothing was
  // replaced, undoing what was done puts back the rest.
  it.each(
    (Object.keys(ALL) as (keyof typeof ALL)[]).flatMap((scenario) => [
      [scenario, "before"] as const,
      [scenario, "midway"] as const,
    ]),
  )(
    "loses nothing when any one step of a %s fails %s it",
    async (scenario, when) => {
      const counting = failingAt(0, ops());
      {
        const { op, steps } = await ALL[scenario]();
        await executePlacing(op, steps, counting.ops);
      }
      const changes = counting.made.count;
      expect(changes).toBeGreaterThan(2);

      for (let n = 1; n <= changes; n += 1) {
        await fs.rm(root, { force: true, recursive: true });
        await fs.mkdir(at("trash"), { recursive: true });
        await fs.mkdir(at("dest"));
        leftoverRecords = [];
        const { op, steps } = await ALL[scenario]();
        const before = await tree();

        const outcome = await executePlacing(
          op,
          steps,
          failingAt(n, ops(), { midway: when === "midway" }).ops,
        );

        const label = `${when} step ${n.toString()}`;
        // The step goes with what is checked, so a failure names it.
        expect({
          failed: outcome.failure !== null,
          lost: await lostContents(before),
          step: label,
        }).toEqual({ failed: true, lost: [], step: label });
        if (scenario !== "replace") {
          await undo(outcome.journal);
          // A placement that failed only after it was made is in place but
          // not journaled; everything else is back.
          const now = await tree();
          if (outcome.placed.length === 0 && when === "before") {
            expect({ step: label, tree: now }).toEqual({
              step: label,
              tree: before,
            });
          }
        }
      }
    },
  );

  // The incoming copy is whole and the old one in the Trash when the last
  // step fails: nothing comes out of the Trash, the copy stays staged, and
  // the failure says where each is.
  it("leaves things as they are, and says so, when placing fails after a replace", async () => {
    const { op, steps } = await replaceScenario();
    const base = ops();

    const outcome = await executePlacing(op, steps, {
      ...base,
      place: () => Promise.reject(new Error("the disk is full")),
    });

    expect(outcome.failure).toMatch(
      /^“a\.txt” is in the Trash, but “a\.txt” couldn’t be put in its place, so its copy is still at “\.instrument-placing-.+”: the disk is full$/,
    );
    expect(outcome.journal).toBeNull();
    expect(await fs.readFile(at("trash/1-a.txt"), "utf8")).toBe("old a");
    expect(await fs.readFile(at("src/a.txt"), "utf8")).toBe("new a");
    expect(leftoverRecords.map((each) => each.kind)).toEqual(["staging"]);
  });

  // Undo is all or nothing however far it gets: a rename failing at any
  // step puts back the ones before it, so the tree is as the drop left it.
  it.each(Object.keys(UNDOABLE) as (keyof typeof UNDOABLE)[])(
    "takes back nothing of a %s when any step of its undo fails",
    async (scenario) => {
      let renames = 0;
      {
        const { op, steps } = await UNDOABLE[scenario]();
        const outcome = await executePlacing(op, steps, ops());
        await undo(outcome.journal, {
          rename: async (from, to) => {
            renames += 1;
            await fs.rename(from, to);
          },
        });
      }
      expect(renames).toBeGreaterThan(1);

      for (let n = 1; n <= renames; n += 1) {
        await fs.rm(root, { force: true, recursive: true });
        await fs.mkdir(at("trash"), { recursive: true });
        await fs.mkdir(at("dest"));
        const { op, steps } = await UNDOABLE[scenario]();
        const outcome = await executePlacing(op, steps, ops());
        const after = await tree({ trash: true });
        let count = 0;

        const refusal = await undo(outcome.journal, {
          rename: async (from, to) => {
            count += 1;
            if (count === n) throw new Error("injected");
            await fs.rename(from, to);
          },
        }).then(
          () => "undid it",
          (error: unknown) =>
            error instanceof Error ? error.message : String(error),
        );
        const step = `step ${n.toString()}`;
        expect({ refusal, step, tree: await tree({ trash: true }) }).toEqual({
          refusal: expect.stringContaining(
            "so everything was put back as it was",
          ),
          step,
          tree: after,
        });
      }
    },
  );

  // What is replaced goes to the Trash only once what takes its place is
  // whole: a copy that comes out different stops before anything is trashed.
  it("trashes nothing for a copy that did not come out whole", async () => {
    const { op, steps } = await replaceScenario();
    const before = await tree();
    const base = ops();
    let measured = 0;

    const outcome = await executePlacing(op, steps, {
      ...base,
      measure: async (where) => {
        measured += 1;
        const isTheCopy = measured === 2;
        const real = await base.measure(where);
        return isTheCopy ? { ...real, bytes: real.bytes - 1 } : real;
      },
    });

    expect(outcome.failure).toBe(
      "The copy of “a.txt” came out different from it.",
    );
    expect(await tree()).toEqual(before);
    expect(await fs.readdir(at("trash"))).toEqual([]);
    expect(leftoverRecords).toEqual([]);
  });

  // A name taken after the plan is never written over: that item stops, and
  // what was done before it stays done, journaled.
  it("never writes over a name taken since the plan", async () => {
    await write({ "src/a.txt": "a", "src/b.txt": "b" });
    const steps = await planFor({
      answers: {},
      op: "move",
      sources: ["src/a.txt", "src/b.txt"],
    });
    await write({ "dest/b.txt": "someone else's b" });

    const outcome = await executePlacing("move", steps, ops());

    expect(outcome.failure).toMatch(/b\.txt/);
    expect(await tree()).toMatchInlineSnapshot(`
      {
        "dest/": "",
        "dest/a.txt": "a",
        "dest/b.txt": "someone else's b",
        "src/": "",
        "src/b.txt": "b",
      }
    `);
    await undo(outcome.journal);
    expect(await fs.readFile(at("src/a.txt"), "utf8")).toBe("a");
  });

  it("leaves a source that changed since the plan where it is, and says so", async () => {
    await write({ "src/a.txt": "a", "src/b.txt": "b" });
    const steps = await planFor({
      answers: {},
      op: "move",
      sources: ["src/a.txt", "src/b.txt"],
    });
    // Saved over as an editor does, a new file renamed onto the name: a
    // delete then a write can get the freed inode back on Linux.
    await write({ "src/a.txt.new": "a new a" });
    await fs.rename(at("src/a.txt.new"), at("src/a.txt"));

    const outcome = await executePlacing("move", steps, ops());

    expect(outcome.skipped).toEqual([
      { source: at("src/a.txt"), why: "changed" },
    ]);
    expect(await tree()).toMatchInlineSnapshot(`
      {
        "dest/": "",
        "dest/b.txt": "b",
        "src/": "",
        "src/a.txt": "a new a",
      }
    `);
  });

  // A hard link already in the destination is the same file there already:
  // nothing moves, and the person is told rather than left to wonder.
  it("says a source is already in the destination under another name", async () => {
    await write({ "src/a.txt": "a" });
    await fs.link(at("src/a.txt"), at("dest/A copy.txt"));
    const steps = await planFor({
      answers: {},
      op: "move",
      sources: ["src/a.txt"],
    });

    const outcome = await executePlacing("move", steps, ops());

    expect(outcome.skipped).toEqual([
      { source: at("src/a.txt"), why: "already-there" },
    ]);
    expect(outcome.journal).toBeNull();
  });

  it("copies a link as a link, and replaces a link without touching what it points at", async () => {
    await write({ "dest/target.txt": "target", "src/real.txt": "real" });
    await fs.symlink("real.txt", at("src/latest"));
    await fs.symlink("target.txt", at("dest/latest"));
    const steps = await planFor({
      answers: { "src/latest": "replace" },
      op: "copy",
      sources: ["src/latest"],
    });

    await executePlacing("copy", steps, ops());

    expect(await tree({ trash: true })).toMatchInlineSnapshot(`
      {
        "dest/": "",
        "dest/latest": "-> real.txt",
        "dest/target.txt": "target",
        "src/": "",
        "src/latest": "-> real.txt",
        "src/real.txt": "real",
        "trash/": "",
        "trash/1-latest": "-> target.txt",
      }
    `);
  });

  // A file placed by a hard link whose old name cannot be let go of (its
  // folder is read only) is taken back out of the destination, so it is
  // never in two places and the plan sees it not placed.
  it.skipIf(process.getuid?.() === 0)(
    "takes its link back when the old name cannot be let go of",
    async () => {
      await write({ "src/a.txt": "a" });
      await fs.chmod(at("src"), 0o555);
      try {
        await expect(
          ops().place(at("src/a.txt"), at("dest/a.txt")),
        ).rejects.toMatchObject({ code: "EACCES" });
        expect(await fs.readdir(at("dest"))).toEqual([]);
        expect(await fs.readFile(at("src/a.txt"), "utf8")).toBe("a");
      } finally {
        await fs.chmod(at("src"), 0o755);
      }
    },
  );
});
