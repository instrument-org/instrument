import { execSync } from "node:child_process";

const DEFAULT_TAG_PATTERN = /^v1\.0\.0-beta\./;

function deleteRelease(tag: string) {
  execSync(`gh release delete ${tag} -y`, { stdio: "inherit" });
}

function listReleaseTags(pattern: RegExp) {
  const output = execSync(
    "gh release list --limit 500 --json tagName --jq '.[].tagName'",
    { encoding: "utf8", stdio: "pipe" },
  );

  return output
    .trim()
    .split("\n")
    .filter((tag) => tag.length > 0 && pattern.test(tag))
    .sort();
}

function main() {
  const { execute, pattern } = parseArgs();
  const tags = listReleaseTags(pattern);

  if (tags.length === 0) {
    console.log(`No releases match /${pattern.source}/`);
    return;
  }

  console.log(
    `${execute ? "Deleting" : "Would delete"} ${tags.length} release(s) (git tags kept):\n`,
  );
  for (const tag of tags) {
    console.log(`  ${tag}`);
  }

  if (!execute) {
    console.log("\nDry run only. Pass --execute to delete these releases.");
    return;
  }

  console.log("");
  for (const tag of tags) {
    console.log(`Deleting release ${tag}...`);
    deleteRelease(tag);
  }

  console.log(
    `\nDeleted ${tags.length} release(s). Git tags were not removed.`,
  );
}

function parseArgs() {
  const execute = process.argv.includes("--execute");
  const patternArg = process.argv.find((arg) => arg.startsWith("--pattern="));
  const pattern = patternArg
    ? new RegExp(patternArg.slice("--pattern=".length))
    : DEFAULT_TAG_PATTERN;

  return { execute, pattern };
}

main();
