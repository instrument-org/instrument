// Trims the parts of dugite's bundled git distribution that nothing in Studio
// can invoke. Unlike `prune-foreign-binaries`, none of this is about the build
// target: these files are unreachable on every platform.
//
//   - git-credential-manager, and the .NET runtime that exists only to host it.
//     `gitArgs` in packages/workspace/src/lib/shell-commands/git.ts passes
//     `credential.helper=`, which resets the helper list built from config, so
//     no helper runs at all. On macOS and Linux the manager is already inert
//     for a second reason: electron-builder drops `.dll` files on non-Windows
//     targets, so its managed assemblies never ship and only the native
//     runtime does.
//   - git-lfs. Reachable in principle, since dugite puts it on GIT_EXEC_PATH,
//     but nothing configures an lfs filter: dugite's bundled system gitconfig
//     sets only an Azure DevOps credential option.
//   - scalar, a clone helper for very large repositories, which has no path
//     from the agent's git command.
//
// Loaded as TS directly: electron-builder runs configs through jiti, so no
// separate compile step is needed.

import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

/** Standalone tools that ship beside git but are never invoked. */
const UNREACHABLE_TOOLS = new Set([
  "git-lfs",
  "git-lfs.exe",
  "scalar",
  "scalar.exe",
]);

/**
 * Prefixes of the self-contained .NET runtime that git-credential-manager
 * ships with. Git itself is a C program and contributes no shared library to
 * these directories, so nothing outside the credential manager loads these.
 */
const DOTNET_RUNTIME_PREFIXES = [
  "libAvaloniaNative",
  "libHarfBuzzSharp",
  "libSkiaSharp",
  "libSystem.",
  "libclrgc",
  "libclrjit",
  "libcoreclr",
  "libhostfxr",
  "libhostpolicy",
  "libmscor",
];

/**
 * Remove unreachable git tooling from a packaged `app.asar.unpacked`
 * directory. Returns the removed paths relative to the dugite git root, so the
 * caller can log what was trimmed.
 *
 * Directories that do not exist are skipped, which is what makes this work
 * across dugite's two layouts: macOS and Linux use `git/`, while Windows ships
 * minGit under `git/mingw64/`.
 */
export function pruneGitTooling({ unpackedDir }: { unpackedDir: string }) {
  const gitRoot = path.join(unpackedDir, "node_modules", "dugite", "git");
  if (!existsSync(gitRoot)) {
    return [];
  }

  const searchDirs = [
    path.join(gitRoot, "bin"),
    path.join(gitRoot, "libexec", "git-core"),
    path.join(gitRoot, "mingw64", "bin"),
    path.join(gitRoot, "mingw64", "libexec", "git-core"),
  ];

  const removed: string[] = [];
  for (const dir of searchDirs) {
    if (!existsSync(dir)) {
      continue;
    }
    for (const name of readdirSync(dir)) {
      if (!isUnreachable(name)) {
        continue;
      }
      rmSync(path.join(dir, name), { force: true, recursive: true });
      removed.push(path.relative(gitRoot, path.join(dir, name)));
    }
  }
  return removed;
}

/**
 * The binaries the agent's git command actually resolves. Pruning by name
 * pattern is only safe if it is paired with a check that the essentials
 * survived, so `afterPack` fails the build rather than shipping a git that
 * cannot run.
 */
export function verifyGitSurvived({ unpackedDir }: { unpackedDir: string }) {
  const gitRoot = path.join(unpackedDir, "node_modules", "dugite", "git");
  if (!existsSync(gitRoot)) {
    return;
  }

  const required = [
    path.join(gitRoot, "bin", "git"),
    path.join(gitRoot, "bin", "git.exe"),
    path.join(gitRoot, "mingw64", "bin", "git.exe"),
  ].filter((candidate) => existsSync(candidate));

  if (required.length === 0) {
    throw new Error(
      `Pruning unreachable git tooling left no git binary under ${gitRoot}.`,
    );
  }

  for (const binary of required) {
    if (statSync(binary).size === 0) {
      throw new Error(`Packaged git binary at ${binary} is empty.`);
    }
  }
}

/**
 * Git's own credential helpers are C programs named `git-credential`,
 * `git-credential-cache`, `git-credential-cache--daemon` and
 * `git-credential-store`. Only the `-manager` family belongs to the .NET app,
 * so match it exactly rather than by a `git-credential` prefix.
 */
function isCredentialManagerFile(name: string) {
  return (
    name === "git-credential-manager" ||
    name === "git-credential-manager.exe" ||
    name.startsWith("git-credential-manager.")
  );
}

function isUnreachable(name: string) {
  return (
    UNREACHABLE_TOOLS.has(name) ||
    isCredentialManagerFile(name) ||
    DOTNET_RUNTIME_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}
