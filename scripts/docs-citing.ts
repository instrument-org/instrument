// Lists the architecture docs that cite a file a range of commits changed and
// that the range left alone, so a change to what a doc describes brings the
// doc into view before landing. Shown, never enforced: most changes leave a
// doc true.
//
//   node scripts/docs-citing.ts <base>...HEAD
//
// A doc cites a file by its path from the repo root, by a relative link, or by
// its tail (`lib/apps/store.ts`), in a code span or a link. Tests and
// snapshots are not what a doc describes, so changing them cites nothing. A
// file three or more docs cite is a hub each names in passing, and a change
// under 20 lines to what a doc cites is rarely what it describes, so neither
// brings a doc into view.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const range = process.argv[2];
if (range === undefined) {
  console.error("usage: node scripts/docs-citing.ts <base>...HEAD");
  process.exit(2);
}

const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });

const changed = git("diff", "--name-only", range).split("\n").filter(Boolean);
const edited = new Set(changed.filter((file) => file.endsWith(".md")));
const described = changed.filter(
  (file) =>
    /\.(ts|tsx|mjs|cjs|js|rs|swift)$/.test(file) &&
    !/\.(test|browser\.test|spec)\.[a-z]+$/.test(file) &&
    !file.includes("__snapshots__") &&
    !file.includes("/evals/"),
);

const docs = git("ls-files", "docs/architecture/*.md")
  .split("\n")
  .filter((file) => file && path.basename(file) !== "README.md");

/** The paths a doc names: code spans and link targets with a slash in them. */
function citations(doc: string): string[] {
  const text = readFileSync(doc, "utf8");
  const cited = new Set<string>();
  for (const [, span = ""] of text.matchAll(/`([^`\s]+\/[^`\s]+)`/g)) {
    cited.add(span.replace(/[.,:;)]+$/, "").replace(/:\d+(-\d+)?$/, ""));
  }
  for (const [, target = ""] of text.matchAll(/\]\(<?([^)\s>#]+)/g)) {
    if (!/^[a-z][a-z+.-]*:/i.test(target)) {
      cited.add(path.normalize(path.join(path.dirname(doc), target)));
    }
  }
  return [...cited];
}

/** Lines added and removed in each file the range changed. */
const churn = new Map<string, number>();
for (const line of git("diff", "--numstat", range).split("\n")) {
  const [added = "", removed = "", file = ""] = line.split("\t");
  churn.set(file, (Number(added) || 0) + (Number(removed) || 0));
}

const citedBy = new Map(
  docs.map((doc) => {
    const cited = citations(doc);
    return [
      doc,
      described.filter((file) =>
        cited.some((name) => file === name || file.endsWith(`/${name}`)),
      ),
    ] as const;
  }),
);
const docsCiting = (file: string) =>
  [...citedBy.values()].filter((files) => files.includes(file)).length;

const found: string[] = [];
for (const [doc, cited] of citedBy) {
  if (edited.has(doc)) {
    continue;
  }
  const files = cited.filter((file) => docsCiting(file) < 3);
  const lines = files.reduce((sum, file) => sum + (churn.get(file) ?? 0), 0);
  if (lines >= 20) {
    found.push(`  ${doc}: ${files.join(", ")}`);
  }
}
if (found.length > 0) {
  console.log(
    "land: these docs describe files this branch changes and it left them as they were; check each still holds:\n" +
      found.join("\n"),
  );
}
