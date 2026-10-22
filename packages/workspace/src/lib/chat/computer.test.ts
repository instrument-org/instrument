import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { shellPath } from "../workspace-fs-layout";
import { AbsolutePathSchema } from "../../schemas/paths";
import {
  accessIn,
  describeComputerFiles,
  type FolderRoot,
  listComputerFolder,
} from "./computer";

// Host paths in the running platform's own separators, which is what the
// listing and the grants both carry: a Windows grant is `C:\Users\casey\Documents`
// and its children are spelled the same way.
const home = path.resolve(path.sep, "Users", "casey");
const documents = path.join(home, "Documents");
const roots: FolderRoot[] = [
  { grant: "read-only", root: home, shellRoot: shellPath(home) },
  { grant: "read-only", root: documents, shellRoot: shellPath(documents) },
];

describe("accessIn", () => {
  it("is the granted folder itself", () => {
    expect(accessIn(roots, documents)).toEqual({
      access: "read-only",
      root: documents,
      shellPath: shellPath(documents),
    });
  });

  it("reaches a file under the grant through it, in the agent's separators", () => {
    expect(accessIn(roots, path.join(documents, "reports", "q3.pdf"))).toEqual({
      access: "read-only",
      root: documents,
      shellPath: `${shellPath(documents)}/reports/q3.pdf`,
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
      root: home,
      shellPath: `${shellPath(home)}/Documents-old/a.txt`,
    });
    expect(
      accessIn(
        [
          {
            grant: "read-only",
            root: documents,
            shellRoot: shellPath(documents),
          },
        ],
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
  const chatId = createMockChatConfig(ChatIdSchema.parse("computer-listing"));
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

    const listing = await listComputerFolder({ path: folder, chatId });
    if (listing.kind !== "listing") {
      throw new Error(`refused: ${listing.reason}`);
    }

    expect(listing.truncated).toBe(true);
    expect(listing.entries).toHaveLength(2000);
    expect(listing.entries[0]).toMatchObject({ kind: "folder", name: "zzz" });
    expect(listing.entries[1]?.name).toBe("file 1");
    expect(listing.entries.at(-1)?.name).toBe("file 1999");
  });

  // Windows ignores a folder's POSIX mode bits, so 0o000 shuts nothing there.
  it.skipIf(process.platform === "win32")(
    "answers a folder its account cannot read with who refused",
    async () => {
      folder = await fs.mkdtemp(path.join(os.tmpdir(), "computer-listing-"));
      const shut = path.join(folder, "shut");
      await fs.mkdir(shut, { mode: 0o000 });

      try {
        const refusal = await listComputerFolder({ path: shut, chatId });
        expect(refusal).toMatchObject({
          kind: "refused",
          path: shut,
          reason: "account",
        });
        expect(refusal).not.toHaveProperty("refusedBy");
      } finally {
        await fs.chmod(shut, 0o700);
      }
    },
  );

  // A folder the account cannot pass through refuses everything under it,
  // there or not, so the refusal names that folder rather than the name
  // asked for.
  // Windows has no mode to take away: chmod there only sets the read-only
  // flag, so the folder stays open and there is nothing to refuse.
  it.skipIf(process.platform === "win32")(
    "names the folder above that kept the account out",
    async () => {
      folder = await fs.mkdtemp(path.join(os.tmpdir(), "computer-listing-"));
      const shut = path.join(folder, "shut");
      await fs.mkdir(path.join(shut, "inner"), { recursive: true });
      await fs.chmod(shut, 0o000);

      try {
        for (const asked of [
          path.join(shut, "inner"),
          path.join(shut, "nothing", "here"),
        ]) {
          expect(
            await listComputerFolder({ path: asked, chatId }),
          ).toMatchObject({
            kind: "refused",
            path: asked,
            reason: "account",
            refusedBy: shut,
          });
        }
      } finally {
        await fs.chmod(shut, 0o700);
      }
    },
  );

  // macOS refuses everything in a folder it guards once the person said no,
  // so a chat's folder in a workspace kept in Documents is refused by
  // Documents. Stood in for here by a home whose Documents answers as macOS
  // does after a no.
  it.runIf(process.platform === "darwin").each([
    ["refused too", true, { refusedBy: "Documents" }],
    ["open", false, {}],
  ] as const)(
    "names the guarded folder above when macOS refuses it %s",
    async (_label, isGuardedRefused, expected) => {
      folder = await fs.mkdtemp(path.join(os.tmpdir(), "computer-guarded-"));
      const documentsHere = path.join(folder, "Documents");
      const chatFolder = path.join(
        documentsHere,
        "Instrument",
        "Chats",
        "Hello World",
      );
      await fs.mkdir(chatFolder, { recursive: true });
      vi.spyOn(os, "homedir").mockReturnValue(folder);
      const refused = new Set([
        chatFolder,
        ...(isGuardedRefused ? [documentsHere] : []),
      ]);
      const eperm = () =>
        Object.assign(new Error("operation not permitted"), { code: "EPERM" });
      const { opendir, readdir } = fs;
      vi.spyOn(fs, "readdir").mockImplementation(((
        ...args: Parameters<typeof readdir>
      ) =>
        refused.has(String(args[0]))
          ? Promise.reject(eperm())
          : readdir(...args)) as typeof readdir);
      vi.spyOn(fs, "opendir").mockImplementation(((
        ...args: Parameters<typeof opendir>
      ) =>
        refused.has(String(args[0]))
          ? Promise.reject(eperm())
          : opendir(...args)) as typeof opendir);

      try {
        const refusal = await listComputerFolder({ path: chatFolder, chatId });
        expect(refusal).toMatchObject({
          kind: "refused",
          path: chatFolder,
          reason: "system",
        });
        expect(
          refusal.kind === "refused" && refusal.refusedBy !== undefined
            ? { refusedBy: path.basename(refusal.refusedBy) }
            : {},
        ).toEqual(expected);
      } finally {
        vi.restoreAllMocks();
      }
    },
  );

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
        const top = await listComputerFolder({ path: drive, chatId });
        const inside = await listComputerFolder({
          path: path.join(drive, "Obsidian"),
          chatId,
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
        expect(await listComputerFolder({ path: drive, chatId })).toMatchObject(
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

// The app's own data, which Studio rules on (`refused-files.ts`), stood in
// for by one folder and one file beside it.
describe("the app's own data", () => {
  const chatId = createMockChatConfig(ChatIdSchema.parse("computer-closed"));
  let folder = "";
  const at = (...names: string[]) => path.join(folder, ...names);

  beforeEach(async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), "computer-closed-"));
    await fs.mkdir(at("machine", "keys"), { recursive: true });
    await fs.mkdir(at("machine", "work"));
    await fs.writeFile(at("machine", "keys", "session.json"), "secret");
    await fs.writeFile(at("machine", "state.json"), "{}");
    await fs.writeFile(at("machine", "work", "notes.md"), "notes");
    const closed = [at("machine", "keys"), at("machine", "state.json")];
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      isRefusedFile: (hostPath) =>
        Promise.resolve(
          closed.some(
            (entry) =>
              hostPath === entry || hostPath.startsWith(`${entry}${path.sep}`),
          ),
        ),
    });
  });

  afterEach(async () => {
    const { isRefusedFile: _, ...config } = getWorkspaceConfig();
    setWorkspaceConfig(config);
    await fs.rm(folder, { force: true, recursive: true });
  });

  it.each([
    {
      expected: () => ({ kind: "listing", names: ["work"] }),
      label: "lists a folder holding it without it",
      listed: () => at("machine"),
    },
    {
      expected: () => ({
        kind: "refused",
        path: at("machine", "keys"),
        reason: "app",
      }),
      label: "refuses a folder of it as the app's",
      listed: () => at("machine", "keys"),
    },
    {
      expected: () => ({ kind: "listing", names: ["notes.md"] }),
      label: "lists a folder beside it as it is",
      listed: () => at("machine", "work"),
    },
  ])("$label", async ({ expected, listed }) => {
    const listing = await listComputerFolder({ path: listed(), chatId });
    expect(
      listing.kind === "listing"
        ? {
            kind: listing.kind,
            names: listing.entries.map((entry) => entry.name),
          }
        : { kind: listing.kind, path: listing.path, reason: listing.reason },
    ).toEqual(expected());
  });

  it("leaves it out of the files named by path", async () => {
    const files = await describeComputerFiles({
      chatId,
      paths: [
        at("machine", "keys", "session.json"),
        at("machine", "work", "notes.md"),
      ],
    });
    expect(files.map((file) => file.name)).toEqual(["notes.md"]);
  });
});

describe("describeComputerFiles", () => {
  const chatId = createMockChatConfig(ChatIdSchema.parse("computer-describe"));
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
      chatId,
    });

    expect(files.map((file) => [file.name, file.kind])).toEqual([
      ["later.txt", "file"],
      ["earlier.md", "file"],
    ]);
  });
});
