import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openOwnFileToRead, ownFolder, writeOwnFile } from "./own-file";

// The app writes as itself into folders the agent's programs can change, so a
// link planted anywhere on the way must stop it rather than be followed.
describe("own-file", () => {
  let root: string;
  let folder: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "own-file-")));
    folder = path.join(root, "work");
    fs.mkdirSync(folder);
  });
  afterEach(() => {
    fs.rmSync(root, { force: true, recursive: true });
  });

  it("refuses the folder's parent", () => {
    expect(() => {
      ownFolder({ dir: root, folder });
    }).toThrow(/is not in/);
  });

  // Such as `.instrument` beside `Apps`.
  it("refuses a sibling of the folder", () => {
    fs.mkdirSync(path.join(root, "keys"));
    expect(() => {
      ownFolder({ dir: path.join(root, "keys"), folder });
    }).toThrow(/is not in/);
  });

  it("refuses a link in the middle of the way, and a file posing as a folder", () => {
    const elsewhere = path.join(root, "elsewhere");
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, path.join(folder, "logs"));
    fs.writeFileSync(path.join(folder, "plain"), "");
    expect(() => {
      ownFolder({ dir: path.join(folder, "logs", "deep"), folder, make: true });
    }).toThrow(expect.objectContaining({ code: "ELOOP" }));
    expect(fs.existsSync(path.join(elsewhere, "deep"))).toBe(false);
    expect(() => {
      ownFolder({ dir: path.join(folder, "plain", "x"), folder, make: true });
    }).toThrow(expect.objectContaining({ code: "ENOTDIR" }));
  });

  it("refuses the folder itself when it is a link", () => {
    const real = path.join(root, "real");
    fs.mkdirSync(real);
    fs.rmSync(folder, { recursive: true });
    fs.symlinkSync(real, folder);
    expect(() => {
      writeOwnFile({ data: "x", file: path.join(folder, "a.log"), folder });
    }).toThrow(expect.objectContaining({ code: "ELOOP" }));
    expect(fs.readdirSync(real)).toEqual([]);
  });

  it("throws on a missing folder unless asked to make it", () => {
    const dir = path.join(folder, "a", "b");
    expect(() => {
      ownFolder({ dir, folder });
    }).toThrow(expect.objectContaining({ code: "ENOENT" }));
    ownFolder({ dir, folder, make: true });
    expect(fs.statSync(dir).isDirectory()).toBe(true);
  });

  it("writes whole, leaving no temp file, and replaces a link at the file's name", () => {
    const secret = path.join(root, "secret");
    fs.writeFileSync(secret, "keep");
    const file = path.join(folder, "sub", "app.json");
    fs.mkdirSync(path.dirname(file));
    fs.symlinkSync(secret, file);
    writeOwnFile({ data: "new", file, folder });
    expect(fs.readFileSync(secret, "utf8")).toBe("keep");
    expect(fs.lstatSync(file).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe("new");
    expect(fs.readdirSync(path.dirname(file))).toEqual(["app.json"]);
  });

  it("opens to read only a regular file, never through a link", async () => {
    const secret = path.join(root, "secret");
    fs.writeFileSync(secret, "keep");
    fs.symlinkSync(secret, path.join(folder, "link"));
    fs.mkdirSync(path.join(folder, "dir"));
    // Windows has no O_NOFOLLOW, so there a link at the file's own name is
    // opened through.
    if (process.platform !== "win32") {
      await expect(
        openOwnFileToRead({ file: path.join(folder, "link"), folder }),
      ).rejects.toMatchObject({ code: "ELOOP" });
    }
    await expect(
      openOwnFileToRead({ file: path.join(folder, "dir"), folder }),
    ).rejects.toMatchObject({ code: "EISDIR" });
  });
});
