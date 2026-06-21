import {
  APP_FOLDER_NAMES,
} from "../constants";

const OUTPUT_PREFIX = `${APP_FOLDER_NAMES.output}/`;

// Parses `git show --name-status` output into the output/ files a commit
// produced. Keeps added/modified/renamed entries (the destination path for
// renames), drops deletions, and returns them sorted for a deterministic
// "first artifact". Status codes: A=added, M=modified, R/C=renamed/copied,
// D=deleted.
export function parseOutputArtifactPaths(nameStatusOutput: string): string[] {
  const paths = new Set<string>();

  for (const line of nameStatusOutput.split("\n")) {
    const parts = line.split("\t").filter((part) => part !== "");
    if (parts.length < 2) {
      continue;
    }

    const status = parts[0]?.[0];
    if (status === undefined || status === "D") {
      continue;
    }

    // Renames/copies list the destination path last.
    const filePath = parts.at(-1);
    if (filePath?.startsWith(OUTPUT_PREFIX)) {
      paths.add(filePath);
    }
  }

  return [...paths].sort((a, b) => a.localeCompare(b));
}
