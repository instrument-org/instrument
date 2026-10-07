import type { EmbeddedCuaDriverHostLike } from "@trycua/cua-driver";

import { app, desktopCapturer, shell, systemPreferences } from "electron";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { noop, sleep } from "radashi";
import { z } from "zod";

import { logger } from "./electron-logger";
import { getAppUnpackedPath, getResourcePath } from "./resource-path";

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
  | {
      accessibility: boolean;
      screenRecording: ReturnType<
        typeof systemPreferences.getMediaAccessStatus
      >;
      supported: true;
    }
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

/**
 * Where the user stands on the two grants, without asking. Read through
 * Electron, which answers synchronously and for this app, so the agent's
 * command list can depend on it.
 */
export function computerPermissionStatus(): ComputerPermissionStatus {
  if (process.platform !== "darwin") {
    return { supported: false };
  }
  return {
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
    screenRecording: systemPreferences.getMediaAccessStatus("screen"),
    supported: true,
  };
}

/**
 * Whether the agent can be offered the `computer` command: this build carries
 * the driver, and on macOS both grants are in place. The driver's own checks
 * still run on every call; this decides only what the agent is told exists.
 */
export function isComputerUseReady(): boolean {
  if (!existsSync(cuaDriverBinPath())) {
    return false;
  }
  const status = computerPermissionStatus();
  return (
    !status.supported ||
    (status.accessibility && status.screenRecording === "granted")
  );
}

/**
 * The system's Accessibility prompt, which offers to open the pane with this
 * app listed. Shown only while the app is not yet trusted.
 */
export function requestAccessibility(): ComputerPermissionStatus {
  if (process.platform === "darwin") {
    systemPreferences.isTrustedAccessibilityClient(true);
  }
  return computerPermissionStatus();
}

/**
 * The system's Screen Recording prompt. macOS asks once per app; after an
 * answer only the pane can change it, and a grant made there reaches this
 * process only after it relaunches. Asking is also what lists the app in the
 * pane, so the person finds a switch to turn on rather than having to add the
 * app with its plus button. Electron reports a never-asked app as denied, so
 * this runs on every request rather than only the first.
 */
export async function requestScreenRecording(): Promise<ComputerPermissionStatus> {
  if (process.platform === "darwin") {
    await desktopCapturer
      .getSources({ thumbnailSize: { height: 1, width: 1 }, types: ["screen"] })
      .catch(noop);
  }
  return computerPermissionStatus();
}

export async function openComputerPermissionSettings(
  permission: ComputerPermission,
) {
  if (process.platform !== "darwin") {
    return;
  }
  if (permission === "screen-recording") {
    await requestScreenRecording();
  }
  // These anchors still resolve on macOS 27, where the Accessibility pane is
  // titled Device Control and Data Access.
  await shell.openExternal(
    permission === "accessibility"
      ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
      : "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  );
}

/**
 * Proof that setup worked, made with the driver the agent uses. The agent's
 * cursor sweeps across this app's own window, which moves only the drawn
 * overlay, never the real pointer, and clicks nothing; then one capture of
 * the screen comes back to show the person. That capture is also what raises
 * macOS's direct-capture consent ("bypass the private window picker"), so it
 * appears here, while the person is reading about it, rather than mid-task.
 * The image is handed to the page and kept nowhere.
 */
export async function verifyComputerUse(): Promise<
  { detail: string; ok: false } | { image: string; ok: true }
> {
  const access = await connectComputerDriver();
  if (access.status === "needs-permission") {
    return {
      detail: `Missing: ${access.missing.join(" and ")}.`,
      ok: false,
    };
  }
  if (access.status === "unavailable") {
    return { detail: access.reason, ok: false };
  }
  const mod = await loadSdk();
  const driver = mod.CuaDriver.connect(access.socketPath);
  const call = (tool: string, input: Record<string, unknown>) =>
    driver.callTool(tool, JSON.stringify(input));
  const session = `${app.getName()} setup`;
  try {
    await call("start_session", { session });
    await call("set_agent_cursor_enabled", { enabled: true, session });
    await sweepCursorOverOwnWindow(call, session).catch((error: unknown) => {
      logger.warn("[computer] cursor demo did not run", error);
    });
    const result = await call("get_desktop_state", {
      max_image_dimension: 640,
      session,
    });
    const [image] = result.images;
    return result.isError || image === undefined
      ? { detail: result.text || "The driver returned no image.", ok: false }
      : {
          image: `data:${image.mimeType};base64,${image.dataBase64}`,
          ok: true,
        };
  } catch (error) {
    return {
      detail: error instanceof Error ? error.message : String(error),
      ok: false,
    };
  } finally {
    await call("end_session", { session }).catch(noop);
    if (mod.CuaDriver.instanceOf(driver)) {
      driver.uniffiDestroy();
    }
  }
}

const WindowListSchema = z.object({
  windows: z.array(
    z.object({
      bounds: z.object({ height: z.number(), width: z.number() }),
      window_id: z.number(),
    }),
  ),
});

/** A few points across the largest window this process has on screen. */
async function sweepCursorOverOwnWindow(
  call: (
    tool: string,
    input: Record<string, unknown>,
  ) => Promise<{ structuredJson?: string; text: string }>,
  session: string,
) {
  const listed = await call("list_windows", {
    on_screen_only: true,
    pid: process.pid,
  });
  const parsed = WindowListSchema.safeParse(
    JSON.parse(listed.structuredJson ?? listed.text),
  );
  const window = parsed.success
    ? parsed.data.windows.toSorted(
        (a, b) =>
          b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height,
      )[0]
    : undefined;
  if (!window) {
    return;
  }
  const target = {
    kind: "window",
    pid: process.pid,
    window_id: window.window_id,
  };
  const { height, width } = window.bounds;
  for (const [fx, fy] of [
    [0.25, 0.3],
    [0.75, 0.3],
    [0.7, 0.75],
    [0.3, 0.7],
    [0.5, 0.5],
  ] as const) {
    await call("move_cursor", {
      session,
      target,
      x: Math.round(width * fx),
      y: Math.round(height * fy),
    });
    await sleep(450);
  }
}

const RESUME_MARKER = "computer-use-resume";

/**
 * Leaves word for the next launch to reopen the Computer Use setup screen, so
 * a relaunch made from it lands the person back where they were.
 */
export function markComputerUseSetupResume() {
  writeFileSync(path.join(app.getPath("userData"), RESUME_MARKER), "");
}

/** Whether this launch follows a relaunch from the setup screen, once. */
export function takeComputerUseSetupResume(): boolean {
  const marker = path.join(app.getPath("userData"), RESUME_MARKER);
  if (!existsSync(marker)) {
    return false;
  }
  rmSync(marker, { force: true });
  return true;
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
  const status = computerPermissionStatus();
  if (status.supported) {
    const missing: ComputerPermission[] = [];
    if (!status.accessibility) {
      missing.push("accessibility");
    }
    if (status.screenRecording !== "granted") {
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

/**
 * The SDK finds its Rust library beside the platform package it resolves from
 * its own module URL, then hands that path to dlopen, which cannot read an
 * asar. Imported by name, the URL is inside `app.asar` even for unpacked files,
 * so a packaged build imports it from `app.asar.unpacked` by path instead and
 * every path it derives is a real one.
 */
function loadSdk(): Promise<Sdk> {
  if (!app.isPackaged) {
    sdk ??= import("@trycua/cua-driver");
    return sdk;
  }
  const entry = pathToFileURL(
    getAppUnpackedPath(
      "node_modules",
      "@trycua",
      "cua-driver",
      "dist",
      "index.js",
    ),
  ).href;
  // A URL import is typed `any`; it is the same module the type names.
  sdk ??= import(entry) as Promise<Sdk>;
  return sdk;
}
