import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readPackage } from "read-pkg";
import semver from "semver";
import { updatePackage } from "write-package";

const REGISTRY_DIR_PATH = path.join(process.cwd(), "..", "..", "registry");

function checkRegistrySubmodule() {
  try {
    console.log("Checking if registry submodule is up to date...");

    execSync(`cd ${REGISTRY_DIR_PATH} && git fetch origin`, { stdio: "pipe" });

    const result = execSync(
      `cd ${REGISTRY_DIR_PATH} && git log HEAD..origin/main --oneline`,
      {
        encoding: "utf8",
        stdio: "pipe",
      },
    );

    if (result.trim()) {
      console.error("❌ Registry submodule is not up to date!");
      console.error("There are new commits available on the remote:");
      console.error(result);
      console.error(
        "Please update the registry submodule before tagging a release:",
      );
      console.error("  pnpm run scripts:update-registry");
      throw new Error("Registry submodule is not up to date");
    }

    console.log("✅ Registry submodule is up to date");
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Registry submodule is not up to date"
    ) {
      throw error;
    }
    console.error("Error checking registry submodule:", error);
    throw new Error("Failed to check registry submodule");
  }
}

function getNextBetaVersion(
  baseVersion: string,
  releaseType: "minor" | "patch",
): string {
  const nextVersion = semver.inc(baseVersion, releaseType);
  if (!nextVersion) {
    throw new Error(`Failed to increment version from ${baseVersion}`);
  }

  try {
    const existingTags = execSync("git tag -l", { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter((tag) => tag.startsWith("v"))
      .map((tag) => tag.slice(1));

    const betaTags = existingTags
      .map((tag) => semver.parse(tag))
      .filter((parsed): parsed is semver.SemVer => {
        if (!parsed) {
          return false;
        }
        return (
          parsed.prerelease.length > 0 &&
          parsed.prerelease[0] === "beta" &&
          parsed.major === semver.major(nextVersion) &&
          parsed.minor === semver.minor(nextVersion) &&
          parsed.patch === semver.patch(nextVersion)
        );
      })
      .sort((a, b) => {
        const aBeta = (a.prerelease[1] as number) || 0;
        const bBeta = (b.prerelease[1] as number) || 0;
        return bBeta - aBeta;
      });

    if (betaTags.length === 0) {
      return `${nextVersion}-beta.0`;
    }

    const latestBeta = betaTags[0];
    if (!latestBeta) {
      return `${nextVersion}-beta.0`;
    }

    const latestBetaNumber = (latestBeta.prerelease[1] as number) || 0;
    return `${nextVersion}-beta.${latestBetaNumber + 1}`;
  } catch {
    return `${nextVersion}-beta.0`;
  }
}

async function main() {
  try {
    const versionType = process.argv[2] as "minor" | "patch" | undefined;
    const isBeta = process.argv[3] === "beta";
    const releaseType = versionType || "patch";

    if (versionType && !["minor", "patch"].includes(versionType)) {
      throw new Error(
        `Invalid version type: ${versionType}. Must be "patch" or "minor"`,
      );
    }

    const notesPath = releaseNotesPath();

    checkRegistrySubmodule();
    syncReleaseTags();
    const branch = currentBranch();
    syncBranch(branch);

    const packageJsonPath = path.join(process.cwd(), "package.json");

    const packageJson = await readPackage();

    const currentVersion = packageJson.version;
    const newVersion = isBeta
      ? getNextBetaVersion(currentVersion, releaseType)
      : semver.inc(currentVersion, releaseType);

    if (!newVersion) {
      throw new Error(`Failed to increment version from ${currentVersion}`);
    }

    if (!semver.gt(newVersion, currentVersion)) {
      throw new Error(
        `Next version ${newVersion} is not greater than package.json version ${currentVersion}. ` +
          "If you recently pulled main, run: git fetch origin --tags",
      );
    }

    const versionLabel = isBeta ? `${releaseType} beta` : releaseType;
    console.log(
      `Updating ${versionLabel} version from ${currentVersion} to ${newVersion}`,
    );

    await updatePackage(packageJsonPath, { version: newVersion });

    const tagName = `v${newVersion}`;
    const commitMessage = `release: ${tagName}`;
    // By path, so whatever another agent has staged stays out of the commit.
    git(["commit", "-m", commitMessage, "--", "package.json"]);
    createTag(tagName, notesPath);

    if (process.argv.includes("--no-push")) {
      console.log(
        `Not pushed. Push both at once: git push --atomic origin HEAD:refs/heads/${branch} refs/tags/${tagName}`,
      );
    } else {
      pushRelease(branch, tagName, notesPath);
    }

    console.log(`Successfully released version ${newVersion}`);
    console.log(`Commit: ${commitMessage}`);
    console.log(`Tag: ${tagName}`);
  } catch (error) {
    console.error("Error during release:", error);
    process.exit(1);
  }
}

/**
 * The release notes file named by `--notes`. A release cut without one still
 * tags, and says what it gives up.
 */
function releaseNotesPath(): string | undefined {
  const index = process.argv.indexOf("--notes");
  const file = index === -1 ? undefined : process.argv[index + 1];
  if (!file) {
    console.warn(
      "⚠️  No --notes: Slack and the release page will list commits grouped by scope instead of release notes.",
    );
    return undefined;
  }
  // pnpm runs this from apps/studio, so a relative path resolves from there.
  const resolved = path.resolve(file);
  if (!readFileSync(resolved, "utf8").trim()) {
    throw new Error(`Release notes file is empty: ${resolved}`);
  }
  return resolved;
}

function git(args: string[]) {
  execFileSync("git", args, { stdio: "inherit" });
}

function gitOutput(args: string[]) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function currentBranch() {
  const branch = gitOutput(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "HEAD") {
    throw new Error("HEAD is detached. Check out the branch to release from.");
  }
  return branch;
}

/**
 * Rebases the branch onto origin's before anything is committed, so the
 * release commit sits on top of everything already pushed and the push that
 * follows is a fast-forward rather than a merge.
 */
function syncBranch(branch: string) {
  console.log(`Fetching ${branch} from origin...`);
  git(["fetch", "origin", branch]);
  const behind = gitOutput(["log", "--oneline", `HEAD..origin/${branch}`]);
  if (!behind) {
    console.log(`✅ ${branch} has everything on origin`);
    return;
  }
  console.log(
    `Rebasing onto origin/${branch}, which brings in commits the release will include:`,
  );
  console.log(behind);
  try {
    rebaseOnto(branch);
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} Nothing was committed. Bring ${branch} up to date by hand, then run this again.`,
    );
  }
}

function rebaseOnto(branch: string) {
  try {
    git(["pull", "--rebase", "--autostash", "origin", branch]);
  } catch {
    try {
      execFileSync("git", ["rebase", "--abort"], { stdio: "ignore" });
    } catch {
      // The pull failed before a rebase started.
    }
    throw new Error(`Rebasing onto origin/${branch} failed and was undone.`);
  }
}

/**
 * The tag's message is the release notes: the release workflow posts their
 * summary to Slack and publishes them as the release body. With none, it falls
 * back to the commits grouped by scope.
 */
function createTag(tagName: string, notesPath: string | undefined) {
  git(
    notesPath
      ? ["tag", "--cleanup=verbatim", "-F", notesPath, tagName]
      : ["tag", "-m", "", tagName],
  );
}

const PUSH_ATTEMPTS = 3;

/**
 * Pushes the branch and the tag in one atomic push, so the tag never lands
 * without the branch that contains it. When origin moved since the fetch, the
 * unpushed tag is deleted, the release commit is rebased onto origin, and the
 * tag is made again on the rebased commit. Merging origin in instead would
 * keep the tag but leave a merge commit on the branch.
 */
function pushRelease(
  branch: string,
  tagName: string,
  notesPath: string | undefined,
) {
  for (let attempt = 1; ; attempt++) {
    console.log(`Pushing ${branch} and ${tagName}...`);
    try {
      git([
        "push",
        "--atomic",
        "origin",
        `HEAD:refs/heads/${branch}`,
        `refs/tags/${tagName}`,
      ]);
      console.log(
        `✅ Pushed ${branch} and ${tagName}; the release build starts from the tag`,
      );
      return;
    } catch {
      if (attempt === PUSH_ATTEMPTS) {
        throw new Error(
          `Push was rejected ${PUSH_ATTEMPTS} times. ${tagName} exists locally on HEAD and nothing was pushed.`,
        );
      }
      console.log(
        `Push rejected. Rebasing onto origin/${branch} and tagging again.`,
      );
      git(["tag", "-d", tagName]);
      git(["fetch", "origin", branch]);
      try {
        rebaseOnto(branch);
      } catch (error) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)} HEAD is the untagged release commit. Rebase it onto origin/${branch} by hand, then tag and push it rather than rerunning this script, which would bump the version again: git tag ${notesPath ? `--cleanup=verbatim -F ${notesPath}` : '-m ""'} ${tagName} && git push --atomic origin HEAD:refs/heads/${branch} refs/tags/${tagName}`,
        );
      }
      createTag(tagName, notesPath);
    }
  }
}

function syncReleaseTags() {
  console.log("Fetching release tags from origin...");
  execSync("git fetch origin --tags", { stdio: "inherit" });
  console.log("✅ Release tags are up to date");
}

await main();
