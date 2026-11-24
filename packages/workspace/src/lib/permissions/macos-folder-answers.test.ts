import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createMacosFolderAnswers,
  macosMayAsk,
  macosMayAskBelow,
  resolveWithoutAsking,
} from "./macos-folder-answers";

const home = "/Users/mac-user";
const iCloud = `${home}/Library/Mobile Documents/com~apple~CloudDocs`;
const answered = new Set(
  [
    `${home}/Documents`,
    iCloud,
    "/Volumes/Work",
    `${home}/Downloads/Picked`,
    `${home}/Pictures`,
  ].map((folder) => folder.toLowerCase()),
);

describe("macosMayAsk", () => {
  it.each([
    // Guarded by nothing.
    [home, false],
    [`${home}/Projects/site`, false],
    ["/Applications", false],
    // One answer covers the folder whole.
    [`${home}/Documents`, false],
    [`${home}/documents/Taxes/2026`, false],
    [`/System/Volumes/Data${home}/Documents/Taxes`, false],
    [`${iCloud}/Notes/2026`, false],
    ["/Volumes/Work/Clients", false],
    // No answer on record.
    [`${home}/Desktop`, true],
    [`${home}/DESKTOP/Screenshots`, true],
    [`/System/Volumes/Data${home}/Desktop`, true],
    ["/Volumes/Backup", true],
    ["/Volumes/Backup/2026", true],
    // An answer for one folder inside is for that folder alone.
    [`${home}/Downloads/Picked`, false],
    [`${home}/Downloads/Picked/inner`, true],
    [`${home}/Downloads`, true],
    // Answered for folder by folder.
    [`${home}/Pictures`, false],
    [`${home}/Pictures/Trips`, true],
    [`${home}/Music`, true],
    [`${home}/Movies/Clips`, true],
    [`${home}/Library`, true],
    [`${home}/Library/Mobile Documents`, true],
    [`${home}/Library/Mobile Documents/iCloud~com~example~app`, true],
    // iCloud Drive's Desktop and Documents are the home folder's.
    [`${iCloud}/Documents/Taxes`, false],
    [`${iCloud}/Desktop`, true],
    // A name that only starts like a guarded one.
    [`${home}/Desktop notes`, false],
  ])("for %s is %s", (folder, expected) => {
    expect(macosMayAsk(folder, { answered, home })).toBe(expected);
  });
});

describe("macosMayAskBelow", () => {
  it.each([
    ["/", true],
    ["/Users", true],
    [home, true],
    ["/Volumes", true],
    ["/System/Volumes", true],
    [`${home}/Projects/site`, false],
    ["/Applications", false],
    [`${home}/Documents`, false],
    [`${home}/Documents/Code/site`, false],
    ["/Volumes/Work/Clients", false],
    [iCloud, true],
    [`${iCloud}/Notes`, false],
    [`${home}/Downloads/Picked`, true],
    [`${home}/Pictures`, true],
    ["/Volumes/Backup/2026", true],
  ])("for %s is %s", (folder, expected) => {
    expect(macosMayAskBelow(folder, { answered, home })).toBe(expected);
  });
});

describe.skipIf(process.platform === "win32")("with folders on disk", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "macos-answers-")),
    );
  });
  afterEach(async () => {
    await fs.rm(root, { force: true, recursive: true });
  });

  describe("resolveWithoutAsking", () => {
    it("follows links in any part of a path, relative or absolute", async () => {
      await fs.mkdir(path.join(root, "real", "inner"), { recursive: true });
      await fs.symlink("real", path.join(root, "relative"));
      await fs.symlink(path.join(root, "relative"), path.join(root, "chain"));
      expect(
        await resolveWithoutAsking(
          path.join(root, "chain", "inner"),
          () => false,
        ),
      ).toBe(path.join(root, "real", "inner"));
    });

    it("gives nothing for a link kept where it may not be read, a loop, or a missing path", async () => {
      await fs.mkdir(path.join(root, "real"));
      await fs.symlink("real", path.join(root, "link"));
      await fs.symlink("b", path.join(root, "a"));
      await fs.symlink("a", path.join(root, "b"));
      const resolve = (name: string, keepsOut = () => false) =>
        resolveWithoutAsking(path.join(root, name), keepsOut);
      expect(await resolve("link", () => true)).toBeUndefined();
      expect(await resolve("a")).toBeUndefined();
      expect(await resolve("missing")).toBeUndefined();
      // A path with no link in it reads no link, so nothing stops it.
      expect(await resolve("real", () => true)).toBe(path.join(root, "real"));
    });

    it("asks whether a link may be read by where the link really is", async () => {
      await fs.mkdir(path.join(root, "real", "Documents", "target"), {
        recursive: true,
      });
      await fs.symlink("real", path.join(root, "home"));
      await fs.symlink("target", path.join(root, "real", "Documents", "link"));
      const asked: string[] = [];
      await resolveWithoutAsking(
        path.join(root, "home", "Documents", "link"),
        (at) => {
          asked.push(path.relative(root, at));
          return false;
        },
      );
      expect(asked).toEqual(["home", "real/Documents/link"]);
    });
  });

  describe("createMacosFolderAnswers", () => {
    const file = () => path.join(root, "machine", "permissions.json");
    const record = () =>
      createMacosFolderAnswers({ file, home: root, platform: "darwin" });
    const spelled = (...names: string[]) =>
      path.join(root, ...names).toLowerCase();

    beforeEach(async () => {
      for (const name of ["Documents/Taxes", "Desktop", "Pictures/Trips"]) {
        await fs.mkdir(path.join(root, name), { recursive: true });
      }
      await fs.mkdir(path.join(root, "Projects"));
    });

    it("keeps a listed folder across launches, beside what the file already has", async () => {
      await fs.mkdir(path.dirname(file()));
      await fs.writeFile(file(), JSON.stringify({ places: { home: "ask" } }));
      const first = record();
      await first.note(path.join(root, "Documents", "Taxes"), "open");
      await first.note(path.join(root, "Pictures"), "open");
      expect([...(await record().answered())]).toEqual([
        spelled("Documents", "Taxes"),
        spelled("Pictures"),
      ]);
      expect(JSON.parse(await fs.readFile(file(), "utf8"))).toMatchObject({
        places: { home: "ask" },
      });
    });

    it("records a refusal only for a folder one answer covers whole", async () => {
      const answers = record();
      await answers.note(path.join(root, "Documents", "Taxes"), "system");
      await answers.note(path.join(root, "Pictures"), "system");
      expect([...(await answers.answered())]).toEqual([]);
      await answers.note(path.join(root, "Desktop"), "system");
      expect([...(await answers.answered())]).toEqual([spelled("Desktop")]);
    });

    it("records nothing for a folder macOS does not guard, or one an answer already covers", async () => {
      const answers = record();
      await answers.note(path.join(root, "Projects"), "open");
      await answers.note(path.join(root, "Documents"), "open");
      await answers.note(path.join(root, "Documents", "Taxes"), "open");
      expect([...(await answers.answered())]).toEqual([spelled("Documents")]);
    });

    it("records a folder reached through a link under where it really is", async () => {
      await fs.symlink(
        path.join("Documents", "Taxes"),
        path.join(root, "Taxes link"),
      );
      const answers = record();
      await answers.note(path.join(root, "Taxes link"), "open");
      expect([...(await answers.answered())]).toEqual([
        spelled("Documents", "Taxes"),
      ]);
    });

    it("records and answers nothing off macOS", async () => {
      const answers = createMacosFolderAnswers({
        file,
        home: root,
        platform: "linux",
      });
      await answers.note(path.join(root, "Documents"), "open");
      expect([...(await answers.answered())]).toEqual([]);
      await expect(fs.access(file())).rejects.toThrow();
    });
  });
});
