import type { EmbeddedCuaDriverHostLike } from "@trycua/cua-driver";

import { shell } from "electron";
import { existsSync } from "node:fs";

import { logger } from "./electron-logger";
import { getResourcePath } from "./resource-path";

/**
 * Cua Driver, embedded: the `cua-driver` daemon behind the agent's `computer`
 * command, started on first use as a direct child of this process.
 *
 * Whose identity macOS checks decides the shape. A child the app spawns
 * itself works under the app's Accessibility and Screen Recording grants, so
 * the user grants Instrument once and nothing else; launched through a shell,
 * `open`, or Launch Services, it would answer as someone else. The SDK's
 * permission calls run here for the same reason: the prompts name the app.
 *
 * The daemon starts only once macOS reports both grants, and restarts when
 * they change, since a running process keeps the grants it started with.
 * Elsewhere there are no grants to wait for: Windows needs an interactive
 * session and Linux a live X11 or XWayland desktop with AT-SPI, which the
 * driver reports through its own `health_report`.
 */

export type ComputerAccess =
  | { binaryPath: string; socketPath: string; status: "ready" }
  | { missing: ComputerPermission[]; status: "needs-permission" }
  | { reason: string; status: "unavailable" };

export type ComputerPermission = "accessibility" | "screen-recording";

export type ComputerPermissionStatus =
  | { accessibility: boolean; screenRecording: boolean; supported: true }
  | { supported: false };

type Sdk = typeof import("@trycua/cua-driver");

// Advisory: the driver echoes it in `check_permissions`; macOS attributes the
// grants by process ancestry, not by this string.
const HOST_BUNDLE_ID = "com.instrument.studio";

let sdk: Promise<Sdk> | undefined;
let host: EmbeddedCuaDriverHostLike | undefined;
// The grants the running daemon started under, to notice a change.
let startedWith: string | undefined;

export function cuaDriverBinPath(): string {
  return getResourcePath(
    "cua-driver",
    process.platform === "win32" ? "cua-driver.exe" : "cua-driver",
  );
}

/** Where the user stands on the two grants, without asking. */
export async function computerPermissionStatus(): Promise<ComputerPermissionStatus> {
  if (process.platform !== "darwin") {
    return { supported: false };
  }
  const { currentMacOsPermissionStatus } = await loadSdk();
  return { ...currentMacOsPermissionStatus(), supported: true };
}

/**
 * The system's prompts for whichever grant is missing. Accessibility opens
 * its Settings pane with Instrument listed; Screen Recording asks once, then
 * only its pane can change the answer.
 */
export async function requestComputerPermissions(): Promise<ComputerPermissionStatus> {
  if (process.platform !== "darwin") {
    return { supported: false };
  }
  const { requestMacOsPermissions } = await loadSdk();
  return { ...requestMacOsPermissions(), supported: true };
}

export async function openComputerPermissionSettings(
  permission: ComputerPermission,
) {
  if (process.platform !== "darwin") {
    return;
  }
  await shell.openExternal(
    permission === "accessibility"
      ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
      : "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  );
}

/**
 * The daemon's private endpoint, starting it if it is not running. Answers
 * `needs-permission` rather than starting it without the grants, which
 * would leave every call failing in the driver instead of here.
 */
export async function connectComputerDriver(): Promise<ComputerAccess> {
  const binaryPath = cuaDriverBinPath();
  if (!existsSync(binaryPath)) {
    return {
      reason: `This build does not include cua-driver (looked for ${binaryPath}).`,
      status: "unavailable",
    };
  }

  let mod: Sdk;
  try {
    mod = await loadSdk();
  } catch (error) {
    logger.error("[computer] could not load the Cua Driver SDK", error);
    return {
      reason: `The Cua Driver SDK could not load: ${error instanceof Error ? error.message : String(error)}`,
      status: "unavailable",
    };
  }

  let grants = "n/a";
  if (process.platform === "darwin") {
    const status = mod.currentMacOsPermissionStatus();
    const missing: ComputerPermission[] = [];
    if (!status.accessibility) {
      missing.push("accessibility");
    }
    if (!status.screenRecording) {
      missing.push("screen-recording");
    }
    if (missing.length > 0) {
      return { missing, status: "needs-permission" };
    }
    grants = JSON.stringify(status);
  }

  try {
    if (host && startedWith !== grants) {
      logger.info("[computer] grants changed; restarting cua-driver");
      const connection = await host.restart();
      startedWith = grants;
      return { binaryPath, socketPath: connection.socketPath, status: "ready" };
    }
    host ??= mod.EmbeddedCuaDriverHost.withOptions(
      mod.EmbeddedDriverHostOptions.create({
        approveSessionPolicy: false,
        binaryPath,
        dangerouslyBypassApprovals: false,
        // The driver reports usage unless told not to, and this app sends no
        // telemetry. The host refuses any variable outside its allowlist.
        environment: [
          { name: "CUA_DRIVER_RS_TELEMETRY_ENABLED", value: "false" },
        ],
        hostBundleId: HOST_BUNDLE_ID,
        inheritStderr: false,
      }),
    );
    // Coalesces concurrent callers and returns the live connection when the
    // daemon is already up.
    const connection = await host.start();
    startedWith = grants;
    return { binaryPath, socketPath: connection.socketPath, status: "ready" };
  } catch (error) {
    logger.error("[computer] cua-driver did not start", error);
    return {
      reason: `cua-driver did not start: ${error instanceof Error ? error.message : String(error)}`,
      status: "unavailable",
    };
  }
}

export async function stopComputerDriver() {
  const current = host;
  host = undefined;
  startedWith = undefined;
  if (!current) {
    return;
  }
  try {
    await current.stop();
  } catch (error) {
    logger.warn("[computer] cua-driver did not stop cleanly", error);
  } finally {
    const { EmbeddedCuaDriverHost } = await loadSdk();
    if (EmbeddedCuaDriverHost.instanceOf(current)) {
      current.uniffiDestroy();
    }
  }
}

function loadSdk(): Promise<Sdk> {
  sdk ??= import("@trycua/cua-driver");
  return sdk;
}
