import { APP_BUNDLE_ID } from "@instrument-org/shared";
import { type ComputerUseHost } from "@instrument-org/workspace/electron";
import { getWorkspaceFeatures } from "@/electron-main/stores/workspace/preferences";
import { app, shell, systemPreferences } from "electron";
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { noop, sleep } from "radashi";
import { z } from "zod";

import { getUserDataDir } from "./get-workspace-folder";
import { getResourcePath } from "./resource-path";

const execFileAsync = promisify(execFile);

/**
 * The driver behind the agent's `instrument computer`: agent-desktop, run per
 * call as a plain child of this process. macOS holds the app responsible for a
 * child it spawns itself, so the person grants Instrument once and nothing
 * else appears in System Settings; launched through a shell, `open`, or Launch
 * Services, it would answer as someone else.
 *
 * Accessibility is all the agent needs to read and act. Screen Recording only
 * adds pictures of a window, so setup finishes without it.
 */

const PermissionsSchema = z.object({
  data: z.object({
    accessibility: z.object({ state: z.string() }),
    screen_recording: z.object({ state: z.string() }),
  }),
});

function binaryPath(): string {
  return getResourcePath("agent-desktop", "agent-desktop");
}

/** The driver's own folder, which it refuses unless only this user can read it. */
function stateDir(): string {
  const dir = path.join(getUserDataDir(), "agent-desktop");
  mkdirSync(dir, { recursive: true });
  chmodSync(dir, 0o700);
  return dir;
}

function isEnabled(): boolean {
  return getWorkspaceFeatures().computer_use;
}

function hasAccessibility(): boolean {
  return (
    process.platform === "darwin" &&
    systemPreferences.isTrustedAccessibilityClient(false)
  );
}

function isReady(): boolean {
  return isEnabled() && existsSync(binaryPath()) && hasAccessibility();
}

/** The host a workspace gets, on the one platform the driver is carried for. */
export function computerUseHost(): ComputerUseHost | undefined {
  return process.platform === "darwin"
    ? {
        binaryPath: binaryPath(),
        isEnabled,
        isReady,
        ownBundleId: APP_BUNDLE_ID,
        stateDir,
      }
    : undefined;
}

/**
 * Where setup stands, as the driver itself sees it: a child of this process
 * reading the grants is the proof that they reach what the agent runs.
 */
export async function computerUseStatus() {
  const installed = existsSync(binaryPath());
  const answer = installed
    ? await execFileAsync(binaryPath(), ["permissions"], {
        env: { ...process.env, AGENT_DESKTOP_HOME: stateDir() },
        timeout: 10_000,
      }).catch(() => undefined)
    : undefined;
  const read = PermissionsSchema.safeParse(parseJson(answer?.stdout));
  return {
    accessibility: read.success
      ? read.data.data.accessibility.state === "granted"
      : hasAccessibility(),
    appName: app.getName(),
    installed,
    macOSMajor: Number(process.getSystemVersion().split(".")[0]),
    ready: isReady(),
    screenRecording: read.success
      ? read.data.data.screen_recording.state === "granted"
      : false,
  };
}

function parseJson(text: unknown): unknown {
  try {
    return typeof text === "string" ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

const PANES = {
  accessibility:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  "screen-recording":
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
} as const;

export type ComputerPermission = keyof typeof PANES;

/** How long macOS gets to put its prompt up after being asked. */
const PROMPT_PATIENCE_MS = 500;

/** Whether one of these prompts is up: a process of its own runs them. */
async function promptIsUp(): Promise<boolean> {
  await sleep(PROMPT_PATIENCE_MS);
  return execFileAsync("/usr/bin/pgrep", [
    "-x",
    "universalAccessAuthWarn",
  ]).then(
    () => true,
    () => false,
  );
}

/**
 * The system's own ask, which is also what lists the app in the pane, so the
 * person finds a switch instead of having to add the app with the plus button.
 * Screen Recording is asked through the driver, since Electron's capture API
 * raises no prompt and lists nothing. The prompt has its own button to the
 * pane, so the pane opens here only when macOS asks nothing, as it does once
 * it has been answered.
 */
export async function requestComputerPermission(
  permission: ComputerPermission,
): Promise<void> {
  if (process.platform !== "darwin") {
    return;
  }
  if (permission === "accessibility") {
    systemPreferences.isTrustedAccessibilityClient(true);
  } else {
    // Not waited for: it stays until the prompt is answered.
    execFileAsync(binaryPath(), ["permissions", "--request"], {
      env: { ...process.env, AGENT_DESKTOP_HOME: stateDir() },
    }).catch(noop);
  }
  if (await promptIsUp()) {
    return;
  }
  await shell.openExternal(PANES[permission]);
}

/**
 * One capture, kept nowhere, for macOS's other question about the screen:
 * whether the app may go past the system's window picker. It asks at the first
 * capture, so this makes that the moment the person turned the grant on rather
 * than the middle of a task.
 */
export async function raiseCaptureConsent(): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "computer-use-"));
  await execFileAsync(
    binaryPath(),
    ["screenshot", "--screen", "0", path.join(dir, "capture.png")],
    {
      env: { ...process.env, AGENT_DESKTOP_HOME: stateDir() },
      timeout: 60_000,
    },
  )
    .catch(noop)
    .finally(() => rm(dir, { force: true, recursive: true }));
}

/** Brings the app back over System Settings once a switch has turned on. */
export function focusAfterGrant(): void {
  app.focus({ steal: true });
}
