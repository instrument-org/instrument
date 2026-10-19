import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fileJournal, identityOf, undoEntry } from "../file-journal";
import { executePlacing, fileSystemOps, type PlacingOps } from "./execute";
import { gatherPlaceRequest } from "./gather";
import { type Answer, planPlacing, type Step } from "./plan";

vi.mock("../mac-native", () => ({ finderEntries: () => Promise.resolve([]) }));

let root: string;
beforeEach(async () => {
  trashed = 0;
  root = await fs.mkdtemp(path.join(tmpdir(), "finder-placing-"));
  await fs.mkdir(path.join(root, "trash"));
  await fs.mkdir(path.join(root, "dest"));
});
afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

const at = (...parts: string[]) => path.join(root, ...parts);

/** A Trash in the test's own folder: what goes there is moved in and found by where it went. */
let trashed = 0;
async function testTrash(where: string) {
  const identity = await identityOf(where);
  if (!identity) return null;
  trashed += 1;
  const into = at("trash", `${trashed.toString()}-${path.basename(where)}`);
  await fs.rename(where, into);
  return { from: where, identity, trashed: into };
}

const ops = () => fileSystemOps({ trash: testTrash });

/** Fails the `n`th change it is asked to make, counting from 1, and counts them all. */
function failingAt(n: number, base: PlacingOps) {
  const made = { count: 0 };
  const change =
    <Args extends unknown[], Result>(run: (...args: Args) => Promise<Result>) =>
    async (...args: Args) => {
      made.count += 1;
      if (made.count === n) {
        throw new Error("injected");
      }
      return run(...args);
    };
  const failing: PlacingOps = {
    ...base,
    copy: change(base.copy),
    place: change(base.place),
    removeStaging: change(base.removeStaging),
    restore: change(base.restore),
    trash: change(base.trash),
  };
  return { made, ops: failing };
}

/** Every file under the test's folder, Trash included, by where it is and what it says or points at. */
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

/** Whether every file's contents in `before` are still somewhere: at their place, placed, or in the Trash. */
async function everyByteSurvives(before: Record<string, string>) {
  const now = new Set(Object.values(await tree({ trash: true })));
  return Object.values(before).filter((content) => !now.has(content));
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

/** A copy of three things, one replacing, one kept beside, one a folder with a link in it. */
async function copyScenario() {
  await write({
    "dest/a.txt": "old a",
    "dest/b.txt": "old b",
    "src/a.txt": "new a",
    "src/b.txt": "new b",
    "src/pics/x.jpg": "x",
  });
  await fs.symlink("x.jpg", at("src/pics/latest"));
  return {
    op: "copy" as const,
    steps: await planFor({
      answers: { "src/a.txt": "replace", "src/b.txt": "keepBoth" },
      op: "copy",
      sources: ["src/a.txt", "src/b.txt", "src/pics"],
    }),
  };
}

/** A move of a file over another on one disk, and of a folder over another onto "another disk". */
async function moveScenario() {
  await write({
    "dest/a.txt": "old a",
    "dest/pics/old.jpg": "old pics",
    "src/a.txt": "new a",
    "src/c.txt": "c",
    "src/pics/x.jpg": "x",
  });
  return {
    op: "move" as const,
    steps: await planFor({
      answers: { "src/a.txt": "replace", "src/pics": "replace" },
      offDisk: ["src/pics"],
      op: "move",
      sources: ["src/a.txt", "src/pics", "src/c.txt"],
    }),
  };
}

const SCENARIOS = { copy: copyScenario, move: moveScenario };

async function undo(
  journal: Awaited<ReturnType<typeof executePlacing>>["journal"],
) {
  if (!journal) return;
  await undoEntry(fileJournal.record(journal), {
    trash: async (where) => {
      await testTrash(where);
    },
  });
}

describe("carrying out a plan", () => {
  it.each(Object.keys(SCENARIOS) as (keyof typeof SCENARIOS)[])(
    "does all of a %s and one undo puts everything back",
    async (scenario) => {
      const { op, steps } = await SCENARIOS[scenario]();
      const before = await tree();

      const outcome = await executePlacing(op, steps, ops());

      expect(outcome.failure).toBeNull();
      expect(await tree()).toMatchSnapshot();
      await undo(outcome.journal);
      expect(await tree()).toEqual(before);
    },
  );

  // Every original byte is at its own path, placed, or in the Trash after a
  // failure at any step, and undoing what was done puts back the rest.
  it.each(Object.keys(SCENARIOS) as (keyof typeof SCENARIOS)[])(
    "loses nothing when any one step of a %s fails",
    async (scenario) => {
      const counting = failingAt(0, ops());
      {
        const { op, steps } = await SCENARIOS[scenario]();
        await executePlacing(op, steps, counting.ops);
      }
      const changes = counting.made.count;
      expect(changes).toBeGreaterThan(3);

      for (let n = 1; n <= changes; n += 1) {
        await fs.rm(root, { force: true, recursive: true });
        await fs.mkdir(at("trash"), { recursive: true });
        await fs.mkdir(at("dest"));
        const { op, steps } = await SCENARIOS[scenario]();
        const before = await tree();

        const outcome = await executePlacing(
          op,
          steps,
          failingAt(n, ops()).ops,
        );

        expect(outcome.failure, `step ${n.toString()}`).not.toBeNull();
        expect(await everyByteSurvives(before), `step ${n.toString()}`).toEqual(
          [],
        );
        await undo(outcome.journal);
        expect(await tree(), `undo after step ${n.toString()}`).toEqual(before);
      }
    },
  );

  // What is replaced goes to the Trash only once what takes its place is
  // whole: a copy that comes out different stops before anything is trashed.
  it("trashes nothing for a copy that did not come out whole", async () => {
    const { op, steps } = await copyScenario();
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
    const steps: Step[] = await planFor({
      answers: {},
      op: "move",
      sources: ["src/a.txt", "src/b.txt"],
    });
    await fs.rm(at("src/a.txt"));
    await write({ "src/a.txt": "a new a" });

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

  // Undo is all or nothing: anything changed since puts nothing back.
  it.each([
    [
      "what it replaced has left the Trash",
      async () => {
        const [first] = (await fs.readdir(at("trash"))).toSorted();
        if (first) await fs.rm(at("trash", first), { recursive: true });
      },
      /is no longer in the/,
    ],
    [
      "the name it replaced is taken by something else",
      async () => {
        await fs.rename(at("dest/a.txt"), at("dest/renamed.txt"));
        await write({ "dest/a.txt": "someone else's a" });
      },
      /“a\.txt” has been moved or replaced since it was copied/,
    ],
  ])(
    "refuses to undo a replace once %s, changing nothing",
    async (_case, change, reason) => {
      const { op, steps } = await copyScenario();
      const outcome = await executePlacing(op, steps, ops());
      await change();
      const after = await tree({ trash: true });

      await expect(undo(outcome.journal)).rejects.toThrow(reason);
      expect(await tree({ trash: true })).toEqual(after);
    },
  );
});
