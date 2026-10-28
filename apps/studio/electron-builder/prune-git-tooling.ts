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
//   - git-http-fetch and git-http-push, the dumb-HTTP walkers. A dumb-HTTP
//     fetch runs inside git-remote-http, which links the walker itself;
//     `http-push` is only started to push to a WebDAV remote, and pushing
//     needs credentials the agent's git never has. `http-fetch` is otherwise
//     only started for packfile URIs, which git asks a server for only when
//     `fetch.uriProtocols` is set.
//   - On Windows, msys `file` and its 9.9 MB magic database. Git never runs
//     `file`, and the agent's `file` is the shell's builtin there
//     (shell-commands/native-text.ts routes it to a system program only on
//     macOS and Linux).
//
// Loaded as TS directly: electron-builder runs configs through jiti, so no
// separate compile step is needed.

import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";

/**
 * The programs dugite's macOS and Linux archives link the rest of
 * `libexec/git-core` to: 142 builtins are symlinks to `git`, and the remote
 * helpers for https, ftp and ftps are symlinks to `git-remote-http`.
 */
const GIT_CORE_LINK_TARGETS = ["git", "git-remote-http"];

/** Standalone tools that ship beside git but are never invoked. */
const UNREACHABLE_TOOLS = new Set([
  "git-http-fetch",
  "git-http-fetch.exe",
  "git-http-push",
  "git-http-push.exe",
  "git-lfs",
  "git-lfs.exe",
  "scalar",
  "scalar.exe",
]);

/** Unreachable files and folders outside the program folders, by path from the git root. */
const UNREACHABLE_PATHS = [
  "mingw64/doc/git-credential-manager",
  "usr/bin/file.exe",
  "usr/bin/msys-magic-1.dll",
  "usr/share/misc/magic.mgc",
];

/**
 * Prefixes of the .NET Framework assemblies and native libraries the
 * Windows credential manager ships beside git in `mingw64/bin`, and of the
 * helper that picks a credential helper. Git and its own libraries are named
 * `git*`, `lib*` and `zlib1.dll`, so none of these is git's.
 */
const WINDOWS_CREDENTIAL_MANAGER_PREFIXES = [
  "Atlassian.",
  "Avalonia.",
  "GitHub.",
  "GitLab.",
  "HarfBuzzSharp.",
  "MicroCom.",
  "Microsoft.",
  "SkiaSharp.",
  "System.",
  "av_libglesv2.",
  "gcmcore.",
  "git-credential-helper-selector.",
  "msalruntime.",
];

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
  for (const relative of UNREACHABLE_PATHS) {
    const target = path.join(gitRoot, ...relative.split("/"));
    if (!existsSync(target)) {
      continue;
    }
    rmSync(target, { force: true, recursive: true });
    removed.push(path.relative(gitRoot, target));
  }
  return removed;
}

/**
 * Turn copies in `libexec/git-core` back into the symlinks dugite's archive
 * shipped. A `node_modules` filled from a cache can hold each builtin as a
 * full copy of git, about 3.4 MB apiece, which takes the packaged app from
 * 261 MB to 502 MB zipped; once signed, each copy carries its own signature and
 * no longer matches the others. Runs before signing, while copies are still
 * byte-identical to their target. Windows' minGit has no symlinks and is left
 * alone. Returns the names it relinked.
 */
export function relinkGitBuiltins({ unpackedDir }: { unpackedDir: string }) {
  const gitCore = path.join(
    unpackedDir,
    "node_modules",
    "dugite",
    "git",
    "libexec",
    "git-core",
  );
  if (!existsSync(gitCore)) {
    return [];
  }

  const targets = GIT_CORE_LINK_TARGETS.flatMap((name) => {
    const file = path.join(gitCore, name);
    return existsSync(file) && lstatSync(file).isFile()
      ? [{ contents: readFileSync(file), name }]
      : [];
  });

  const relinked: string[] = [];
  for (const name of readdirSync(gitCore)) {
    const file = path.join(gitCore, name);
    const stat = lstatSync(file);
    if (!stat.isFile() || targets.some((target) => target.name === name)) {
      continue;
    }
    const target = targets.find(
      (candidate) =>
        candidate.contents.length === stat.size &&
        candidate.contents.equals(readFileSync(file)),
    );
    if (!target) {
      continue;
    }
    rmSync(file);
    symlinkSync(target.name, file);
    relinked.push(name);
  }
  return relinked;
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
    DOTNET_RUNTIME_PREFIXES.some((prefix) => name.startsWith(prefix)) ||
    WINDOWS_CREDENTIAL_MANAGER_PREFIXES.some((prefix) =>
      name.startsWith(prefix),
    )
  );
}
