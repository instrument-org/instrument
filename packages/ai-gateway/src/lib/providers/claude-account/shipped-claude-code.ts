import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { claudeCodeRelease } from "./release";

/** Where the live suites keep the copies they download, one folder per version. */
const CACHE = fileURLToPath(
  new URL("../../../../node_modules/.cache/claude-code", import.meta.url),
);

/**
 * The Claude Code the app runs: the release the Agent SDK's manifest names,
 * downloaded from npm once and checked against Anthropic's checksum, so a live
 * suite probes what people run rather than whatever `claude` this computer has.
 * `CLAUDE_CODE_CLI` names another to run instead.
 */
export function shippedClaudeCode() {
  const asked = process.env.CLAUDE_CODE_CLI;
  if (asked !== undefined && asked !== "") {
    return asked;
  }
  const release = claudeCodeRelease();
  if (!release) {
    throw new Error(
      `Claude Code isn't built for ${process.platform}-${process.arch}.`,
    );
  }
  const folder = join(CACHE, release.version);
  const binary = join(folder, release.binary);
  if (existsSync(binary)) {
    return binary;
  }
  const staging = `${folder}.download`;
  rmSync(staging, { force: true, recursive: true });
  mkdirSync(staging, { recursive: true });
  try {
    const tarball = execFileSync(
      "npm",
      [
        "pack",
        `${release.packageName}@${release.packageVersion}`,
        "--pack-destination",
        staging,
        "--silent",
      ],
      { encoding: "utf8" },
    ).trim();
    execFileSync("tar", [
      "-xzf",
      join(staging, tarball),
      "-C",
      staging,
      `package/${release.binary}`,
    ]);
    const extracted = join(staging, "package", release.binary);
    const checksum = createHash("sha256")
      .update(readFileSync(extracted))
      .digest("hex");
    if (checksum !== release.sha256) {
      throw new Error(
        `Claude Code ${release.version} didn't match Anthropic's checksum.`,
      );
    }
    chmodSync(extracted, 0o755);
    rmSync(folder, { force: true, recursive: true });
    renameSync(join(staging, "package"), folder);
    return binary;
  } finally {
    rmSync(staging, { force: true, recursive: true });
  }
}
