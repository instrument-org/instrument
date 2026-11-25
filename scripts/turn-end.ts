// What a session's edits leave wrong that nothing importing them would show,
// so it is fixed while the session still has the change in hand. The Stop hook
// (.claude/hooks/turn-end.mjs) runs it over the files a turn edited.
//
//   node scripts/turn-end.ts --regenerate <file>...
//   node scripts/turn-end.ts <file>...
//
// Prints what is left to fix, and nothing when that is nothing.
//
// A test file says which edits it answers for on a line of its own, and runs
// when an edited file matches, and contains the pattern where one is given:
//
//   // turn end: <glob>[ with <pattern>][, ...]
//
// These are tests that read source as text, which `vitest related` cannot
// trace. `// turn end, regenerating:` is one that holds a file equal to its
// source: --regenerate runs those with -u, as `pnpm fix` does, and rewrites the
// docs/ indexes after an edit under docs/. It goes first, so that no other test
// reads the stale file. Without the flag the rest run, and the React Compiler
// says what it skips in the edited client files.
//
// A test run past the deadline says nothing: landing and CI run it again.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEADLINE_MS = 25_000;

type Claim = { glob: string; pattern: RegExp | undefined };
export type TurnEndTest = {
  claims: Claim[];
  file: string;
  regenerates: boolean;
};

const MARK = /^\/\/ turn end(, regenerating)?: (.+)$/m;

/** The test files that answer for edits, read from their own first lines. */
export function turnEndTests(root: string): TurnEndTest[] {
  const found = spawnSync(
    "git",
    [
      "grep",
      "--untracked",
      "-lE",
      "^// turn end(, regenerating)?: ",
      "--",
      "*.test.ts",
      "*.test.tsx",
    ],
    { cwd: root, encoding: "utf8" },
  );
  return found.stdout
    .split("\n")
    .filter(Boolean)
    .flatMap((file) => {
      const [, regenerates, claims] =
        MARK.exec(readFileSync(path.join(root, file), "utf8")) ?? [];
      return claims
        ? [
            {
              claims: claims.split(", ").map((claim) => {
                const [glob = "", pattern] = claim.split(" with ");
                return {
                  glob,
                  pattern: pattern ? new RegExp(pattern) : undefined,
                };
              }),
              file,
              regenerates: regenerates !== undefined,
            },
          ]
        : [];
    });
}

/** Whether any edited file is one the test answers for. */
export function answersFor(
  test: TurnEndTest,
  edited: string[],
  read: (file: string) => string,
) {
  return edited.some((file) =>
    test.claims.some(
      ({ glob, pattern }) =>
        path.matchesGlob(file, glob) && (!pattern || pattern.test(read(file))),
    ),
  );
}

type Report = {
  testResults?: {
    assertionResults?: {
      failureMessages?: string[];
      fullName: string;
      status: string;
    }[];
    message?: string;
    name: string;
    status: string;
  }[];
};

/** The nearest folder at or above a file with a vitest config, from the root. */
function packageOf(root: string, file: string) {
  let folder = path.posix.dirname(file);
  while (
    folder !== "." &&
    !existsSync(path.join(root, folder, "vitest.config.ts"))
  ) {
    folder = path.posix.dirname(folder);
  }
  return folder;
}

const opening = (message: string | undefined) =>
  (message ?? "").trim().split("\n").slice(0, 6).join("\n    ");

function runTests(
  root: string,
  folder: string,
  files: string[],
  update: boolean,
  deadline: number,
) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    return [];
  }
  const scratch = mkdtempSync(path.join(os.tmpdir(), "turn-end-"));
  const outputFile = path.join(scratch, "report.json");
  try {
    spawnSync(
      path.join(root, folder, "node_modules/.bin/vitest"),
      [
        "run",
        ...files.map((file) => path.posix.relative(folder, file)),
        "--maxWorkers=2",
        // Studio's browser project would start Chromium to match these names.
        ...(folder === "apps/studio"
          ? ["--project", "node", "--project", "dom"]
          : []),
        "--reporter=json",
        `--outputFile=${outputFile}`,
        ...(update ? ["-u"] : []),
      ],
      {
        cwd: path.join(root, folder),
        env: { ...process.env, CI: "true" },
        stdio: "ignore",
        timeout: remaining,
      },
    );
    // `as`: vitest's own report; these are the fields read.
    const report = JSON.parse(readFileSync(outputFile, "utf8")) as Report;
    return (report.testResults ?? []).flatMap((result) => {
      const name = path.relative(root, result.name);
      const failed = (result.assertionResults ?? []).filter(
        ({ status }) => status === "failed",
      );
      return failed.length === 0 && result.status === "failed"
        ? [`${name}\n    ${opening(result.message)}`]
        : failed.map(
            (each) =>
              `${name} > ${each.fullName}\n    ${opening(each.failureMessages?.[0])}`,
          );
    });
  } catch {
    // Killed at the deadline, or crashed on its own config, so no report.
    return [];
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
}

/** Each changed file's content hash, so a file written again by the run shows. */
function changedFiles(root: string) {
  const names = execFileSync(
    "git",
    ["diff", "--name-only", "HEAD", "--", "docs", "packages/*/system-skills/*"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\n")
    .filter((file) => file && existsSync(path.join(root, file)));
  return new Map(
    names.map((file) => [file, readFileSync(path.join(root, file), "utf8")]),
  );
}

if (import.meta.main) {
  const root = path.join(import.meta.dirname, "..");
  const deadline = Date.now() + DEADLINE_MS;
  const update = process.argv[2] === "--regenerate";
  const edited = process.argv
    .slice(update ? 3 : 2)
    .map((file) =>
      path.relative(root, path.resolve(file)).split(path.sep).join("/"),
    )
    .filter(
      (file) => !file.startsWith("..") && existsSync(path.join(root, file)),
    );
  const read = (file: string) => readFileSync(path.join(root, file), "utf8");
  const problems: string[] = [];
  const before = changedFiles(root);

  const byPackage = new Map<string, string[]>();
  for (const test of turnEndTests(root)) {
    if (test.regenerates === update && answersFor(test, edited, read)) {
      const folder = packageOf(root, test.file);
      byPackage.set(folder, [...(byPackage.get(folder) ?? []), test.file]);
    }
  }
  for (const [folder, files] of byPackage) {
    problems.push(...runTests(root, folder, files, update, deadline));
  }

  if (update && edited.some((file) => file.startsWith("docs/"))) {
    const docs = spawnSync(process.execPath, ["scripts/docs.ts", "--write"], {
      cwd: root,
      encoding: "utf8",
    });
    if (docs.status !== 0) {
      problems.push(`docs/: ${(docs.stderr + docs.stdout).trim()}`);
    }
  }

  const client = edited.filter((file) =>
    file.startsWith("apps/studio/src/client/"),
  );
  if (!update && client.length > 0) {
    const skips = spawnSync(
      process.execPath,
      [
        path.join(root, "apps/studio/scripts/react-compiler-skips.ts"),
        ...client.map((file) => path.join(root, file)),
      ],
      { cwd: root, encoding: "utf8", timeout: 20_000 },
    );
    if (skips.stdout) {
      problems.push(...skips.stdout.trim().split("\n"));
    }
  }

  const rewritten = [...changedFiles(root)]
    .filter(
      ([file, text]) => !edited.includes(file) && before.get(file) !== text,
    )
    .map(([file]) => file);
  if (update && rewritten.length > 0) {
    problems.push(
      `Regenerated from what you edited, and part of your change (commit it with the rest): ${rewritten.join(", ")}`,
    );
  }
  if (problems.length > 0) {
    console.log(problems.join("\n"));
  }
}
