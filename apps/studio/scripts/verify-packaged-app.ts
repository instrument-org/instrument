import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Check that the packaged macOS app can actually start.
//
// Signing and notarization do not answer this. `codesign --verify --deep
// --strict` says the bits are intact and signed by who they claim, and `spctl`
// says Apple scanned them; neither asks whether the system will grant the
// entitlements the binary carries. An app claiming a team-scoped entitlement
// with no provisioning profile to grant it passes both and is then killed on
// exec, which shipped once as a build that installed and never came back --
// see docs/findings/an-entitlement-that-notarizes-and-will-not-launch.md.
//
// The check is to run the real binary. `ELECTRON_RUN_AS_NODE` makes it exec as
// Node and exit rather than opening a window, so this needs no display and
// finishes in under a second, while still crossing the kernel's signature and
// entitlement check -- which is the part that fails. A refusal arrives as
// SIGKILL with no output, so the exit signal is the whole diagnosis.
//
// This runs against the signed artifact in the release job, because the smoke
// test builds its own unsigned copy: an unsigned app carries no entitlements,
// so it cannot reproduce an entitlement being refused.

const MAC_DIST_DIRS = ["mac-arm64", "mac-x64", "mac"];

function main(): void {
  if (process.platform !== "darwin") {
    console.log("Not macOS; nothing to verify.");
    return;
  }
  const appPath = resolveApp(process.argv[2]);
  const binary = resolveBinary(appPath);
  if (!fs.existsSync(binary)) {
    throw new Error(`No executable at ${binary}`);
  }

  console.log(`Verifying ${appPath} can start...`);
  const result = spawnSync(binary, ["-e", "process.exit(0)"], {
    encoding: "utf8",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    timeout: 60_000,
  });

  if (result.status === 0) {
    console.log("✅ The packaged app starts.");
    return;
  }

  // A signature or entitlement the system refuses is a kill, not an error: the
  // process never runs, so there is no message and no crash report. Say what
  // that means here rather than leaving a bare signal in the log.
  const detail =
    result.signal === "SIGKILL"
      ? 'The kernel killed it on exec. That is what a signature or entitlement the system will not grant looks like: no output, no crash report, and `open` reporting only "Launchd job spawn failed". Check the entitlements against what an embedded provisioning profile actually grants, and that no app-scoped entitlement leaked into entitlementsInherit and onto the helpers.'
      : `Exited with status ${String(result.status)} signal ${String(result.signal)}.`;
  const stderr = result.stderr.trim();
  throw new Error(
    `The packaged app could not start.\n${detail}${stderr.length > 0 ? `\n\nstderr:\n${stderr}` : ""}`,
  );
}

// The bundle rather than a name: the product name varies by build flavor, and
// this has to check whichever app the packaging step actually produced.
function resolveApp(explicit: string | undefined): string {
  if (explicit != null && explicit.length > 0) {
    return explicit;
  }
  const dist = path.join(import.meta.dirname, "..", "dist");
  for (const dir of MAC_DIST_DIRS) {
    const distDir = path.join(dist, dir);
    if (!fs.existsSync(distDir)) {
      continue;
    }
    const bundle = fs
      .readdirSync(distDir)
      .find((entry) => entry.endsWith(".app"));
    if (bundle != null) {
      return path.join(distDir, bundle);
    }
  }
  throw new Error(
    `No packaged app under ${dist} (looked in ${MAC_DIST_DIRS.join(", ")}).`,
  );
}

// Info.plist names the executable, which is not always the bundle name.
function resolveBinary(appPath: string): string {
  const plist = path.join(appPath, "Contents", "Info.plist");
  const read = spawnSync(
    "plutil",
    ["-extract", "CFBundleExecutable", "raw", "-o", "-", plist],
    { encoding: "utf8" },
  );
  const name = read.stdout.trim();
  if (read.status !== 0 || name.length === 0) {
    throw new Error(`Could not read CFBundleExecutable from ${plist}`);
  }
  return path.join(appPath, "Contents", "MacOS", name);
}

main();
