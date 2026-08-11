import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { pruneGitTooling, verifyGitSurvived } from "./prune-git-tooling";

// cspell:ignore Avalonia HarfBuzz Skia Sharp clrgc clrjit coreclr hostfxr hostpolicy mscor libclrgc libclrjit libcoreclr libexec libhostfxr libhostpolicy libmscor runtimeconfig libmscordaccore libmscordbi
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

// cspell:ignore cvsserver
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
