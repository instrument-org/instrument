/**
 * Rebuild `patches/just-bash@<version>.patch` from source.
 *
 * The patch pnpm applies edits just-bash's published, minified bundle. Rather
 * than editing that bundle by hand, this builds the package from its release
 * tag with every carried change applied, and turns the difference into the
 * patch. `patches/just-bash-sources/sources.json` lists what is carried: an
 * upstream pull request pinned to a commit, or a local diff where a pull
 * request has to be adapted to the version we install.
 *
 * The method rests on the release building byte-for-byte reproducibly from
 * its tag, so that is checked first, and the run stops if it fails. A changed
 * module lands in a chunk with a new content-hashed name, and so does every
 * chunk that imports it. The script pairs each rebuilt file with its published
 * counterpart by walking the two builds' import lists in step from the files
 * whose names did not change, maps the names back, and carries only the files
 * whose content still differs, under their published names.
 *
 *   node scripts/rebuild-just-bash-patch.ts             # rebuild the patch
 *   node scripts/rebuild-just-bash-patch.ts --dry-run   # report, write nothing
 *   node scripts/rebuild-just-bash-patch.ts --test      # also run just-bash's
 *                                                       # tests for what changed
 *
 * The upstream checkout and its install live outside this repository, in
 * `~/.cache/instrument-just-bash-patch`, and are reused between runs.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface Manifest {
  package: string;
  parts: Part[];
  repository: string;
  skip: string[];
  tag: string;
  version: string;
}

interface Part {
  diff?: string;
  name: string;
  ports?: number[];
  pulls?: Pull[];
}

interface Pull {
  commit: string;
  number: number;
}

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCES_DIR = path.join(ROOT, "patches", "just-bash-sources");
const WORK_DIR = path.join(
  os.homedir(),
  ".cache",
  "instrument-just-bash-patch",
);
const REPO_DIR = path.join(WORK_DIR, "repo");
const BUILD_DIR = path.join(WORK_DIR, "build");
const PUBLISHED_DIR = path.join(WORK_DIR, "published");

const dryRun = process.argv.includes("--dry-run");
const runTests = process.argv.includes("--test");

function applySources(manifest: Manifest) {
  const touched = new Set<string>();
  for (const part of manifest.parts) {
    const diffs: [string, string][] = [
      ...(part.pulls ?? []).map((pull): [string, string] => [
        `#${pull.number}`,
        pullDiff(pull, manifest),
      ]),
      ...(part.diff
        ? [
            [
              part.diff,
              fs.readFileSync(path.join(SOURCES_DIR, part.diff), "utf8"),
            ] satisfies [string, string],
          ]
        : []),
    ];
    for (const [label, diff] of diffs) {
      try {
        run("git", ["apply", "--whitespace=nowarn", "-"], BUILD_DIR, diff);
      } catch (error) {
        const stderr = (error as { stderr?: string }).stderr ?? String(error);
        fail(
          `${part.name}: ${label} does not apply to ${manifest.tag}.\n${stderr.trim()}\nRefresh the pin, or adapt it as a local diff under patches/just-bash-sources/.`,
        );
      }
      for (const [, file] of diff.matchAll(/^\+\+\+ b\/(.+)$/gm)) {
        if (file) {
          touched.add(path.posix.dirname(file));
        }
      }
    }
    console.log(`  ${part.name}: applied`);
  }
  return touched;
}

function build(manifest: Manifest) {
  run("pnpm", ["run", "build"], packageDir(manifest));
}

/** The published files whose content the rebuild changes, with that content. */
function changedFiles(manifest: Manifest, publishedPackage: string) {
  const builtBundle = path.join(packageDir(manifest), "dist", "bundle");
  const publishedBundle = path.join(publishedPackage, "dist", "bundle");
  const mapping = mapBundleNames(builtBundle, publishedBundle);
  const renames = new Map(
    [...mapping]
      .filter(([from, to]) => from !== to)
      .map(([from, to]): [string, string] => [
        path.posix.basename(from, ".js"),
        path.posix.basename(to, ".js"),
      ]),
  );
  const skip = new Set(manifest.skip);
  const changed = new Map<string, string>();

  for (const [builtFile, publishedFile] of mapping) {
    const relative = `dist/bundle/${publishedFile}`;
    if (skip.has(relative)) continue;
    const content = renameAll(
      fs.readFileSync(path.join(builtBundle, builtFile), "utf8"),
      renames,
    );
    if (
      content !==
      fs.readFileSync(path.join(publishedBundle, publishedFile), "utf8")
    ) {
      changed.set(relative, content);
    }
  }

  // Declarations are not content-hashed; a changed signature (a new field on
  // the command context, say) shows up under the same name. Only the ones the
  // package ships count: the build also declares its test helpers.
  for (const file of publishedDeclarations(publishedPackage)) {
    const content = fs.readFileSync(
      path.join(packageDir(manifest), "dist", file),
      "utf8",
    );
    if (
      content !==
      fs.readFileSync(path.join(publishedPackage, "dist", file), "utf8")
    ) {
      changed.set(`dist/${file}`, content);
    }
  }
  return changed;
}

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
  process.exit(1);
}

/** The first difference between two trees, or null when they are identical. */
function firstDifference(a: string, b: string): null | string {
  const filesA = listFiles(a);
  const filesB = new Set(listFiles(b));
  for (const file of filesA) {
    if (!filesB.has(file)) return `${file} exists only in the build`;
    if (
      !fs
        .readFileSync(path.join(a, file))
        .equals(fs.readFileSync(path.join(b, file)))
    ) {
      return `${file} differs`;
    }
    filesB.delete(file);
  }
  const [extra] = filesB;
  return extra === undefined ? null : `${extra} exists only in the package`;
}

/** Relative module specifiers a bundle file imports, in source order. */
function importsOf(file: string, content: string): string[] {
  const specifiers = content.matchAll(
    /(?:\bfrom|\bimport)\s*(?:\(\s*)?["'](\.{1,2}\/[^"']+\.js)["']/g,
  );
  return [...specifiers].flatMap(([, specifier]) =>
    specifier
      ? [
          path.posix.normalize(
            path.posix.join(path.posix.dirname(file), specifier),
          ),
        ]
      : [],
  );
}

/** Every file under `dir`, as POSIX paths relative to it. */
function listFiles(dir: string, prefix = ""): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(path.join(dir, prefix), {
    withFileTypes: true,
  })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...listFiles(dir, relative));
    } else {
      files.push(relative);
    }
  }
  return files;
}

function loadManifest(): Manifest {
  return JSON.parse(
    fs.readFileSync(path.join(SOURCES_DIR, "sources.json"), "utf8"),
  ) as Manifest;
}

function main() {
  const manifest = loadManifest();
  prepareCheckout(manifest);

  step(`Checking that ${manifest.tag} builds to the published package`);
  build(manifest);
  const publishedPackage = unpackPublished(manifest);
  const difference = firstDifference(
    path.join(packageDir(manifest), "dist", "bundle"),
    path.join(publishedPackage, "dist", "bundle"),
  );
  const declaration = publishedDeclarations(publishedPackage).find(
    (file) =>
      !fs.existsSync(path.join(packageDir(manifest), "dist", file)) ||
      !fs
        .readFileSync(path.join(packageDir(manifest), "dist", file))
        .equals(fs.readFileSync(path.join(publishedPackage, "dist", file))),
  );
  const mismatch =
    difference ??
    (declaration === undefined ? null : `dist/${declaration} differs`);
  if (mismatch !== null) {
    fail(
      `${manifest.tag} does not rebuild to the published package (${mismatch}), so a rebuilt file cannot stand in for a published one.`,
    );
  }
  console.log("  identical");

  step("Applying the carried changes");
  const touched = applySources(manifest);

  if (runTests) {
    const prefix = `packages/${manifest.package}/`;
    const dirs = [...touched]
      .filter((dir) => dir.startsWith(`${prefix}src/`))
      .map((dir) => dir.slice(prefix.length));
    step(`Running just-bash's tests for ${dirs.length} changed directories`);
    run("pnpm", ["exec", "vitest", "run", ...dirs], packageDir(manifest));
    console.log("  passed");
  }

  step("Building with the changes");
  build(manifest);
  const changed = changedFiles(manifest, publishedPackage);
  console.log(`  ${changed.size} published files change:`);
  for (const file of [...changed.keys()].toSorted()) {
    console.log(`    ${file}`);
  }

  if (dryRun) {
    console.log("\nDry run: patch not written.");
    return;
  }
  step(`Writing patches/${manifest.package}@${manifest.version}.patch`);
  writePatch(manifest, changed);
  console.log("  done; pnpm-lock.yaml carries the new patch hash");
}

/**
 * Pair every rebuilt bundle file with the published file it replaces.
 *
 * Seeded with the files present under the same name in both builds, which a
 * content hash guarantees are the same module. Then, for each pair, the
 * imports already paired are set aside on both sides -- a change can add an
 * import of an existing module or drop one -- and what remains on each side is
 * paired in order. When the remainders differ in length, the change added or
 * removed a module outright, and the run stops rather than guess.
 */
function mapBundleNames(builtBundle: string, publishedBundle: string) {
  const built = new Set(
    listFiles(builtBundle).filter((f) => f.endsWith(".js")),
  );
  const published = new Set(
    listFiles(publishedBundle).filter((f) => f.endsWith(".js")),
  );
  const mapping = new Map<string, string>();
  const claimed = new Set<string>();
  const queue: string[] = [];
  for (const file of built) {
    if (published.has(file)) {
      mapping.set(file, file);
      claimed.add(file);
      queue.push(file);
    }
  }
  while (queue.length > 0) {
    const file = queue.shift() ?? "";
    const target = mapping.get(file) ?? "";
    const unpairedBuilt = importsOf(
      file,
      fs.readFileSync(path.join(builtBundle, file), "utf8"),
    ).filter((imported) => !mapping.has(imported));
    const unpairedPublished = importsOf(
      target,
      fs.readFileSync(path.join(publishedBundle, target), "utf8"),
    ).filter((imported) => !claimed.has(imported));
    if (unpairedBuilt.length !== unpairedPublished.length) {
      fail(
        `${file} imports ${unpairedBuilt.length} modules with no published counterpart (${unpairedBuilt.join(", ")}) where ${target} has ${unpairedPublished.length} (${unpairedPublished.join(", ")}); a module was added or removed, so no mapping is safe.`,
      );
    }
    for (const [index, imported] of unpairedBuilt.entries()) {
      const counterpart = unpairedPublished[index] ?? "";
      mapping.set(imported, counterpart);
      claimed.add(counterpart);
      queue.push(imported);
    }
  }
  const unmapped = [...built].filter((file) => !mapping.has(file));
  if (unmapped.length > 0) {
    fail(`No published counterpart for: ${unmapped.join(", ")}`);
  }
  return mapping;
}

function packageDir(manifest: Manifest) {
  return path.join(BUILD_DIR, "packages", manifest.package);
}

function prepareCheckout(manifest: Manifest) {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  if (!fs.existsSync(REPO_DIR)) {
    step(`Cloning ${manifest.repository}`);
    run(
      "git",
      [
        "clone",
        "--filter=blob:none",
        "--no-checkout",
        manifest.repository,
        REPO_DIR,
      ],
      WORK_DIR,
    );
  }
  step(`Fetching ${manifest.tag}, main, and the pinned pull requests`);
  run("git", ["fetch", "--quiet", "--tags", "origin", "main"], REPO_DIR);
  for (const part of manifest.parts) {
    for (const pull of part.pulls ?? []) {
      run(
        "git",
        ["fetch", "--quiet", "origin", `pull/${pull.number}/head`],
        REPO_DIR,
      );
      const head = run("git", ["rev-parse", "FETCH_HEAD"], REPO_DIR).trim();
      if (head !== pull.commit) {
        console.log(
          `  #${pull.number} has moved to ${head.slice(0, 10)}; building the pinned ${pull.commit.slice(0, 10)}`,
        );
      }
    }
  }

  step(`Checking out ${manifest.tag}`);
  if (fs.existsSync(BUILD_DIR)) {
    run("git", ["worktree", "remove", "--force", BUILD_DIR], REPO_DIR);
  }
  run("git", ["worktree", "prune"], REPO_DIR);
  run(
    "git",
    ["worktree", "add", "--detach", "--force", BUILD_DIR, manifest.tag],
    REPO_DIR,
  );
  step("Installing");
  run("pnpm", ["install", "--frozen-lockfile"], BUILD_DIR);
}

/** The `.d.ts` files the published package ships, relative to its `dist`. */
function publishedDeclarations(publishedPackage: string) {
  return listFiles(path.join(publishedPackage, "dist")).filter((file) =>
    file.endsWith(".d.ts"),
  );
}

function pullDiff(pull: Pull, manifest: Manifest) {
  const base = run(
    "git",
    ["merge-base", "origin/main", pull.commit],
    REPO_DIR,
  ).trim();
  return run(
    "git",
    ["diff", base, pull.commit, "--", `packages/${manifest.package}/src`],
    REPO_DIR,
  );
}

/**
 * Replace every rebuilt chunk name with its published one in a single pass, so
 * one rename can never feed another.
 */
function renameAll(content: string, renames: Map<string, string>) {
  if (renames.size === 0) return content;
  const pattern = new RegExp(
    [...renames.keys()]
      .map((name) => name.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`))
      .join("|"),
    "g",
  );
  return content.replaceAll(pattern, (name) => renames.get(name) ?? name);
}

function run(command: string, args: string[], cwd: string, input?: string) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    input,
    maxBuffer: 256 * 1024 * 1024,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
}

function step(message: string) {
  console.log(`\n• ${message}`);
}

function unpackPublished(manifest: Manifest) {
  fs.rmSync(PUBLISHED_DIR, { force: true, recursive: true });
  fs.mkdirSync(PUBLISHED_DIR, { recursive: true });
  const tarball = run(
    "npm",
    [
      "pack",
      `${manifest.package}@${manifest.version}`,
      "--pack-destination",
      PUBLISHED_DIR,
      "--silent",
    ],
    PUBLISHED_DIR,
  ).trim();
  run("tar", ["-xzf", tarball], PUBLISHED_DIR);
  return path.join(PUBLISHED_DIR, "package");
}

function writePatch(manifest: Manifest, changed: Map<string, string>) {
  const editDir = fs.mkdtempSync(path.join(os.tmpdir(), "just-bash-patch-"));
  fs.rmSync(editDir, { force: true, recursive: true });
  run(
    "pnpm",
    [
      "patch",
      `${manifest.package}@${manifest.version}`,
      "--edit-dir",
      editDir,
      "--ignore-existing",
    ],
    ROOT,
  );
  for (const [file, content] of changed) {
    fs.mkdirSync(path.dirname(path.join(editDir, file)), { recursive: true });
    fs.writeFileSync(path.join(editDir, file), content);
  }
  run("pnpm", ["patch-commit", editDir], ROOT);
  fs.rmSync(editDir, { force: true, recursive: true });
}

main();
