import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { z } from "zod";

/**
 * The manifest the Agent SDK ships beside itself: the Claude Code release it
 * was built against, and each platform's binary with its checksum.
 */
const ManifestSchema = z.object({
  platforms: z.record(
    z.string(),
    z.object({
      binary: z.string(),
      checksum: z.string(),
      size: z.number(),
    }),
  ),
  version: z.string(),
});

/** One platform's Claude Code, as npm publishes it beside the Agent SDK. */
export interface ClaudeCodeRelease {
  /** The binary's file name inside the package: `claude`, or `claude.exe`. */
  binary: string;
  /** The npm package that carries it, at `packageVersion`. */
  packageName: string;
  packageVersion: string;
  /** Hex sha256 of the binary, as Anthropic's manifest gives it. */
  sha256: string;
  size: number;
  /** Claude Code's own version: `2.1.285`. */
  version: string;
}

/**
 * The Claude Code release that matches the Agent SDK this build drives, for
 * this computer, or undefined on a platform Anthropic does not build for.
 * Reading it from the SDK's own manifest keeps the CLI and the SDK in step
 * with no version written down here.
 */
export function claudeCodeRelease(): ClaudeCodeRelease | undefined {
  const require = createRequire(import.meta.url);
  const sdkDir = path.dirname(
    require.resolve("@anthropic-ai/claude-agent-sdk"),
  );
  const manifest = ManifestSchema.parse(
    JSON.parse(readFileSync(path.join(sdkDir, "manifest.json"), "utf8")),
  );
  const { version: packageVersion } = z
    .object({ version: z.string() })
    .parse(JSON.parse(readFileSync(path.join(sdkDir, "package.json"), "utf8")));
  const platform = platformKey();
  const entry = manifest.platforms[platform];
  if (!entry) {
    return undefined;
  }
  return {
    binary: entry.binary,
    packageName: `@anthropic-ai/claude-agent-sdk-${platform}`,
    packageVersion,
    sha256: entry.checksum,
    size: entry.size,
    version: manifest.version,
  };
}

/** `darwin-arm64`, `win32-x64`, `linux-x64-musl`: how the manifest names a platform. */
function platformKey() {
  const base = `${process.platform}-${process.arch}`;
  if (process.platform !== "linux") {
    return base;
  }
  // A glibc build reports its runtime version; musl reports none.
  const report: unknown = process.report.getReport();
  const glibc = JSON.stringify(report).includes('"glibcVersionRuntime"');
  return glibc ? base : `${base}-musl`;
}
