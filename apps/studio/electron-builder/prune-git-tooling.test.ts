import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  pruneGitTooling,
  relinkGitBuiltins,
  verifyGitSurvived,
} from "./prune-git-tooling";

/** A trimmed sample of what dugite ships in `libexec/git-core` on macOS. */
const GIT_CORE_FILES = [
  "git",
  "git-credential",
  "git-credential-cache",
  "git-credential-cache--daemon",
  "git-credential-manager",
  "git-credential-manager.deps.json",
  "git-credential-manager.dll",
  "git-credential-manager.runtimeconfig.json",
  "git-credential-store",
  "git-http-fetch",
  "git-lfs",
  "git-remote-http",
  "libAvaloniaNative.dylib",
  "libHarfBuzzSharp.dylib",
  "libSkiaSharp.dylib",
  "libSystem.Native.dylib",
  "libSystem.Security.Cryptography.Native.Apple.dylib",
  "libclrgc.dylib",
  "libclrjit.dylib",
  "libcoreclr.dylib",
  "libhostfxr.dylib",
  "libhostpolicy.dylib",
  "libmscordaccore.dylib",
  "libmscordbi.dylib",
  "scalar",
];

const BIN_FILES = ["git", "git-cvsserver", "git-receive-pack", "scalar"];

function makeUnpackedFixture() {
  const unpackedDir = mkdtempSync(path.join(tmpdir(), "prune-git-"));
  const gitRoot = path.join(unpackedDir, "node_modules", "dugite", "git");

  const gitCore = path.join(gitRoot, "libexec", "git-core");
  mkdirSync(gitCore, { recursive: true });
  for (const name of GIT_CORE_FILES) {
    writeFileSync(path.join(gitCore, name), "binary");
  }

  const bin = path.join(gitRoot, "bin");
  mkdirSync(bin, { recursive: true });
  for (const name of BIN_FILES) {
    writeFileSync(path.join(bin, name), "binary");
  }

  return { bin, gitCore, unpackedDir };
}

describe("pruneGitTooling", () => {
  it("keeps git and its own credential helpers", () => {
    const { gitCore, unpackedDir } = makeUnpackedFixture();

    pruneGitTooling({ unpackedDir });

    expect(readdirSync(gitCore).sort()).toMatchInlineSnapshot(`
      [
        "git",
        "git-credential",
        "git-credential-cache",
        "git-credential-cache--daemon",
        "git-credential-store",
        "git-http-fetch",
        "git-remote-http",
      ]
    `);
  });

  it("removes scalar from bin without touching git's own commands", () => {
    const { bin, unpackedDir } = makeUnpackedFixture();

    pruneGitTooling({ unpackedDir });

    expect(readdirSync(bin).sort()).toMatchInlineSnapshot(`
      [
        "git",
        "git-cvsserver",
        "git-receive-pack",
      ]
    `);
  });

  it("returns every removed path relative to the git root", () => {
    const { unpackedDir } = makeUnpackedFixture();

    expect(pruneGitTooling({ unpackedDir }).sort()).toMatchInlineSnapshot(`
      [
        "bin/scalar",
        "libexec/git-core/git-credential-manager",
        "libexec/git-core/git-credential-manager.deps.json",
        "libexec/git-core/git-credential-manager.dll",
        "libexec/git-core/git-credential-manager.runtimeconfig.json",
        "libexec/git-core/git-lfs",
        "libexec/git-core/libAvaloniaNative.dylib",
        "libexec/git-core/libHarfBuzzSharp.dylib",
        "libexec/git-core/libSkiaSharp.dylib",
        "libexec/git-core/libSystem.Native.dylib",
        "libexec/git-core/libSystem.Security.Cryptography.Native.Apple.dylib",
        "libexec/git-core/libclrgc.dylib",
        "libexec/git-core/libclrjit.dylib",
        "libexec/git-core/libcoreclr.dylib",
        "libexec/git-core/libhostfxr.dylib",
        "libexec/git-core/libhostpolicy.dylib",
        "libexec/git-core/libmscordaccore.dylib",
        "libexec/git-core/libmscordbi.dylib",
        "libexec/git-core/scalar",
      ]
    `);
  });

  it("does nothing when dugite is not in the package", () => {
    const unpackedDir = mkdtempSync(path.join(tmpdir(), "prune-git-empty-"));

    expect(pruneGitTooling({ unpackedDir })).toStrictEqual([]);
  });
});

describe("relinkGitBuiltins", () => {
  it("turns copies of git and git-remote-http back into symlinks", () => {
    const unpackedDir = mkdtempSync(path.join(tmpdir(), "relink-git-"));
    const gitCore = path.join(
      unpackedDir,
      "node_modules",
      "dugite",
      "git",
      "libexec",
      "git-core",
    );
    mkdirSync(gitCore, { recursive: true });
    for (const name of ["git", "git-add", "git-commit"]) {
      writeFileSync(path.join(gitCore, name), "git binary");
    }
    for (const name of ["git-remote-http", "git-remote-https"]) {
      writeFileSync(path.join(gitCore, name), "remote helper");
    }
    writeFileSync(path.join(gitCore, "git-sh-setup"), "a shell script");

    expect(relinkGitBuiltins({ unpackedDir }).sort()).toMatchInlineSnapshot(`
      [
        "git-add",
        "git-commit",
        "git-remote-https",
      ]
    `);
    expect(
      readdirSync(gitCore)
        .sort()
        .map((name) => {
          const file = path.join(gitCore, name);
          return lstatSync(file).isSymbolicLink()
            ? `${name} -> ${readlinkSync(file)}`
            : name;
        }),
    ).toMatchInlineSnapshot(`
      [
        "git",
        "git-add -> git",
        "git-commit -> git",
        "git-remote-http",
        "git-remote-https -> git-remote-http",
        "git-sh-setup",
      ]
    `);
    expect(readFileSync(path.join(gitCore, "git-add"), "utf8")).toBe(
      "git binary",
    );
  });

  it("leaves symlinks that are already there alone", () => {
    const unpackedDir = mkdtempSync(path.join(tmpdir(), "relink-git-"));
    const gitCore = path.join(
      unpackedDir,
      "node_modules",
      "dugite",
      "git",
      "libexec",
      "git-core",
    );
    mkdirSync(gitCore, { recursive: true });
    writeFileSync(path.join(gitCore, "git"), "git binary");
    symlinkSync("git", path.join(gitCore, "git-add"));

    expect(relinkGitBuiltins({ unpackedDir })).toStrictEqual([]);
  });

  it("does nothing without a git-core folder, as on Windows", () => {
    const unpackedDir = mkdtempSync(path.join(tmpdir(), "relink-git-"));

    expect(relinkGitBuiltins({ unpackedDir })).toStrictEqual([]);
  });
});

describe("verifyGitSurvived", () => {
  it("accepts a package whose git binary is intact after pruning", () => {
    const { unpackedDir } = makeUnpackedFixture();

    pruneGitTooling({ unpackedDir });

    expect(() => {
      verifyGitSurvived({ unpackedDir });
    }).not.toThrow();
  });

  it("throws when the git binary was removed", () => {
    const { bin, unpackedDir } = makeUnpackedFixture();
    rmSync(path.join(bin, "git"));

    expect(() => {
      verifyGitSurvived({ unpackedDir });
    }).toThrowError(/left no git binary/);
  });

  it("throws when the git binary is empty", () => {
    const { bin, unpackedDir } = makeUnpackedFixture();
    writeFileSync(path.join(bin, "git"), "");

    expect(() => {
      verifyGitSurvived({ unpackedDir });
    }).toThrowError(/is empty/);
  });
});
