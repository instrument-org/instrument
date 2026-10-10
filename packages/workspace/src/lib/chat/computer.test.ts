import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { AbsolutePathSchema } from "../../schemas/paths";
import {
  accessIn,
  type AttachedRoot,
  describeComputerFiles,
  listComputerFolder,
} from "./computer";

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
    if (listing.kind !== "listing") {
      throw new Error(`refused: ${listing.reason}`);
    }

    expect(listing.truncated).toBe(true);
    expect(listing.entries).toHaveLength(2000);
    expect(listing.entries[0]).toMatchObject({ kind: "folder", name: "zzz" });
    expect(listing.entries[1]?.name).toBe("file 1");
    expect(listing.entries.at(-1)?.name).toBe("file 1999");
  });

  it("answers a folder its account cannot read with who refused", async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), "computer-listing-"));
    const shut = path.join(folder, "shut");
    await fs.mkdir(shut, { mode: 0o000 });

    try {
      expect(await listComputerFolder({ path: shut, taskId })).toMatchObject({
        kind: "refused",
        path: shut,
        reason: "account",
      });
    } finally {
      await fs.chmod(shut, 0o700);
    }
  });

  // The app folders iCloud Drive shows live in each app's own container; the
  // Mac helper is what names them, stood in for here by a script.
  it.runIf(process.platform === "darwin")(
    "shows iCloud Drive's app folders by name and reads one through its name",
    async () => {
      folder = await fs.mkdtemp(path.join(os.tmpdir(), "computer-icloud-"));
      vi.stubEnv("HOME", folder);
      const containers = path.join(folder, "Library", "Mobile Documents");
      const drive = path.join(containers, "com~apple~CloudDocs");
      const vault = path.join(containers, "iCloud~md~obsidian", "Documents");
      await fs.mkdir(path.join(drive, "Books"), { recursive: true });
      await fs.mkdir(path.join(vault, "Notes"), { recursive: true });
      const helper = path.join(folder, "instrument-mac");
      await fs.writeFile(
        helper,
        `#!/bin/sh\necho '${JSON.stringify({ access: "granted", folders: [{ name: "Obsidian", path: vault }] })}'\n`,
        { mode: 0o755 },
      );
      setWorkspaceConfig({
        ...getWorkspaceConfig(),
        macHelperBinPath: AbsolutePathSchema.parse(helper),
      });

      try {
        const top = await listComputerFolder({ path: drive, taskId });
        const inside = await listComputerFolder({
          path: path.join(drive, "Obsidian"),
          taskId,
        });
        if (top.kind !== "listing" || inside.kind !== "listing") {
          throw new Error("refused");
        }
        expect({
          inside: {
            entries: inside.entries.map((entry) => entry.name),
            path: inside.path,
          },
          top: top.entries.map((entry) => [entry.name, entry.path]),
        }).toEqual({
          inside: { entries: ["Notes"], path: vault },
          top: [
            ["Books", path.join(drive, "Books")],
            ["Obsidian", vault],
          ],
        });
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );

  it.runIf(process.platform === "darwin")(
    "lists iCloud Drive's own folders and says the app folders are locked when macOS refuses them",
    async () => {
      folder = await fs.mkdtemp(path.join(os.tmpdir(), "computer-icloud-"));
      vi.stubEnv("HOME", folder);
      const drive = path.join(
        folder,
        "Library",
        "Mobile Documents",
        "com~apple~CloudDocs",
      );
      await fs.mkdir(path.join(drive, "Books"), { recursive: true });
      const helper = path.join(folder, "instrument-mac-refused");
      await fs.writeFile(
        helper,
        `#!/bin/sh\necho '${JSON.stringify({ access: "refused", folders: [] })}'\n`,
        { mode: 0o755 },
      );
      setWorkspaceConfig({
        ...getWorkspaceConfig(),
        macHelperBinPath: AbsolutePathSchema.parse(helper),
      });

      try {
        expect(await listComputerFolder({ path: drive, taskId })).toMatchObject(
          {
            appFoldersLocked: true,
            entries: [{ name: "Books" }],
            kind: "listing",
          },
        );
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );
});

describe("describeComputerFiles", () => {
  const taskId = createMockTaskConfig(TaskIdSchema.parse("computer-describe"));
  let folder: string | undefined;

  afterEach(async () => {
    if (folder) {
      await fs.rm(folder, { force: true, recursive: true });
    }
  });

  it("keeps the order asked and leaves out what is gone or is a folder", async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), "computer-describe-"));
    const later = path.join(folder, "later.txt");
    const earlier = path.join(folder, "earlier.md");
    await fs.writeFile(later, "a");
    await fs.writeFile(earlier, "b");
    await fs.mkdir(path.join(folder, "sub"));

    const files = await describeComputerFiles({
      paths: [
        later,
        path.join(folder, "gone.txt"),
        path.join(folder, "sub"),
        earlier,
      ],
      taskId,
    });

    expect(files.map((file) => [file.name, file.kind])).toEqual([
      ["later.txt", "file"],
      ["earlier.md", "file"],
    ]);
  });
});
