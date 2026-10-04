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

    execSync("git add package.json", { stdio: "inherit" });

    const tagName = `v${newVersion}`;
    const commitMessage = `release: ${tagName}`;
    execSync(`git commit -m "${commitMessage}"`, { stdio: "inherit" });

    // The tag's message is the release notes: the release workflow posts their
    // summary to Slack and publishes them as the release body. With none, it
    // falls back to the commits grouped by scope.
    execFileSync(
      "git",
      notesPath
        ? ["tag", "--cleanup=verbatim", "-F", notesPath, tagName]
        : ["tag", "-m", "", tagName],
      { stdio: "inherit" },
    );

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

function syncReleaseTags() {
  console.log("Fetching release tags from origin...");
  execSync("git fetch origin --tags", { stdio: "inherit" });
  console.log("✅ Release tags are up to date");
}

await main();
