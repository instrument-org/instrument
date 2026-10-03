import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { accessIn, type AttachedRoot, listComputerFolder } from "./computer";

// Host paths in the running platform's own separators, which is what the
// listing and the grants both carry: a Windows grant is `C:\Users\casey\Documents`
// and its children are spelled the same way.
const home = path.resolve(path.sep, "Users", "casey");
const documents = path.join(home, "Documents");
const roots: AttachedRoot[] = [
  { grant: "read-only", mountPoint: "/mnt/Home", root: home },
  { grant: "read-only", mountPoint: "/mnt/Documents", root: documents },
];

describe("accessIn", () => {
  it("is the granted folder itself", () => {
    expect(accessIn(roots, documents)).toEqual({
      access: "read-only",
      mountPath: "/mnt/Documents",
      root: documents,
    });
  });

  it("reaches a file under the grant through it, in the agent's separators", () => {
    expect(accessIn(roots, path.join(documents, "reports", "q3.pdf"))).toEqual({
      access: "read-only",
      mountPath: "/mnt/Documents/reports/q3.pdf",
      root: documents,
    });
  });

  it("picks the deepest grant when two cover the path", () => {
    expect(accessIn(roots, path.join(documents, "a.txt"))?.root).toBe(
      documents,
    );
    expect(accessIn(roots, path.join(home, "Desktop", "a.txt"))?.root).toBe(
      home,
    );
  });

  it("does not read a sibling sharing the grant's name as a prefix as inside it", () => {
    expect(accessIn(roots, path.join(home, "Documents-old", "a.txt"))).toEqual({
      access: "read-only",
      mountPath: "/mnt/Home/Documents-old/a.txt",
      root: home,
    });
    expect(
      accessIn(
        [{ grant: "read-only", mountPoint: "/mnt/Documents", root: documents }],
        path.join(home, "Documents-old", "a.txt"),
      ),
    ).toBeUndefined();
  });

  it("is nothing outside every grant", () => {
    expect(
      accessIn(roots, path.resolve(path.sep, "Users", "other", "a.txt")),
    ).toBeUndefined();
  });
});

describe("listComputerFolder", () => {
  const taskId = createMockTaskConfig(TaskIdSchema.parse("computer-listing"));
  let folder: string | undefined;

  afterEach(async () => {
    if (folder) {
      await fs.rm(folder, { force: true, recursive: true });
    }
  });

  it("cuts a folder past the cap at the end of the order it is shown in", async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), "computer-listing-"));
    // One past the cap, named so the filesystem's own order is no help: a
    // folder that sorts to the front by kind and to the back by name, and files
    // whose numeric order is not their character order.
    await fs.mkdir(path.join(folder, "zzz"));
    await Promise.all(
      Array.from({ length: 2000 }, (_, index) =>
        fs.writeFile(path.join(folder ?? "", `file ${index + 1}`), ""),
      ),
    );

    const listing = await listComputerFolder({ path: folder, taskId });

    expect(listing.truncated).toBe(true);
    expect(listing.entries).toHaveLength(2000);
    expect(listing.entries[0]).toMatchObject({ kind: "folder", name: "zzz" });
    expect(listing.entries[1]?.name).toBe("file 1");
    expect(listing.entries.at(-1)?.name).toBe("file 1999");
  });
});
