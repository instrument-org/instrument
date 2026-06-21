import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { AppConfig } from "./app-config/types";

import { APP_FOLDER_NAMES } from "../constants";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type ProjectSubdomain } from "../schemas/subdomains";
import { encodeBrowserTargetId } from "../types";
import { absolutePathJoin } from "./absolute-path-join";
import { getAgentBrowserStateDir } from "./app-dir-utils";
import { getCurrentDate } from "./get-current-date";
import { getWorkspaceConfig } from "./workspace-config";

// Tail of stderr/stdout to attach as `error` on a failed observation. Sized
// to surface the actionable error message without flooding the array entry.
const MAX_ERROR_LENGTH = 500;

export type UpsertContextItem = (
  item: SessionMessagePart.ToolPartContextItem,
) => Promise<void>;

interface BrowserCommandObservation {
  // Pass `error` only when the command failed; its presence on the
  // resulting context item is what the UI and the system note treat as
  // "this command did not succeed". Omit it for successful runs.
  complete: (args: { error?: string }) => Promise<void>;
}

interface CapturedScreenshot {
  hash: string;
  screenshot: SessionMessagePart.AgentBrowserScreenshot;
}

// Records that the agent has started running a browser command. Captures
// a starting screenshot synchronously; returns a handle whose `complete`
// captures the ending screenshot and finalizes the record. Both writes
// share the same context-item id so the UI replaces the in-flight card
// in place rather than rendering two cards per command.
//
// The start screenshot may be absent (e.g. the page is still about:blank
// before an `open` command navigates). The observation is still created so
// the end screenshot after the command runs is always captured.
//
// Returns `undefined` only when there is no live browser target at all.
// Callers should treat that as "this command happened without observation".
export async function beginBrowserCommandObservation({
  appConfig,
  sessionId,
  subcommand,
  subdomain,
  upsertContextItem,
}: {
  appConfig: AppConfig;
  sessionId: StoreId.Session;
  subcommand: string;
  subdomain: ProjectSubdomain;
  upsertContextItem: UpsertContextItem;
}): Promise<BrowserCommandObservation | undefined> {
  const targetId = encodeBrowserTargetId(subdomain, sessionId);
  const meta = getWorkspaceConfig().browser.getTargetMeta(targetId);
  if (!meta) {
    return undefined;
  }

  const start = await captureBrowserScreenshot({
    appConfig,
    sessionId,
    subdomain,
  });
  const startScreenshot = start?.screenshot;

  const id = StoreId.newPartContextItemId();
  const startedAt = getCurrentDate();

  try {
    await upsertContextItem({
      createdAt: startedAt,
      id,
      kind: "agent-browser-command",
      startScreenshot,
      status: "pending",
      subcommand,
    });
  } catch (error) {
    getWorkspaceConfig().captureException(error, {
      scopes: ["workspace"],
    });
  }

  return {
    complete: async ({ error }) => {
      try {
        const end = await captureBrowserScreenshot({
          appConfig,
          sessionId,
          subdomain,
        });
        // Reuse the start screenshot when content is unchanged so the UI
        // collapses no-op commands (e.g. `get title`) into one frame.
        const endScreenshot =
          end && start && end.hash === start.hash
            ? start.screenshot
            : end?.screenshot;
        await upsertContextItem({
          createdAt: startedAt,
          ...(endScreenshot ? { endScreenshot } : {}),
          endedAt: getCurrentDate(),
          ...(error ? { error: truncateError(error) } : {}),
          id,
          kind: "agent-browser-command",
          startScreenshot,
          status: "complete",
          subcommand,
        });
      } catch (error_) {
        getWorkspaceConfig().captureException(error_, {
          scopes: ["workspace"],
        });
      }
    },
  };
}

async function captureBrowserScreenshot({
  appConfig,
  sessionId,
  subdomain,
}: {
  appConfig: AppConfig;
  sessionId: StoreId.Session;
  subdomain: ProjectSubdomain;
}): Promise<CapturedScreenshot | undefined> {
  try {
    const workspaceConfig = getWorkspaceConfig();
    const targetId = encodeBrowserTargetId(subdomain, sessionId);
    const targets = await workspaceConfig.browser.listTargets(subdomain);
    const target = targets.find((t) => t.id === targetId);
    if (!target) {
      return undefined;
    }

    // Electron's WebContentsView is bootstrapped with `loadURL("about:blank")`
    // in BrowserViewManager.createTarget so CDP becomes responsive (Page.enable
    // hangs without an initial main frame). Capturing that blank page produces
    // a useless white JPEG that adds noise to the observation timeline and the
    // system note. Skip it.
    if (!target.url || target.url === "about:blank") {
      return undefined;
    }

    const buffer = await workspaceConfig.browser.captureScreenshot(target.id);
    if (!buffer) {
      return undefined;
    }
    // Content hash: keys no-op dedupe and disambiguates filenames.
    const hash = createHash("sha1").update(buffer).digest("hex").slice(0, 12);

    // Descriptive filename so `ls -lt .state/agent-browser` is self-explanatory:
    // timestamp + host + title + hash, unique enough to be multi-agent safe.
    // The `.state/agent-browser/` dir is also surfaced to the agent in the
    // agent-browser skill (separate `skills` repo); keep that in sync if renamed.
    const dir = getAgentBrowserStateDir(appConfig.appDir);
    await fs.mkdir(dir, { recursive: true });
    const fileName = buildScreenshotFileName({
      hash,
      title: target.title,
      url: target.url,
    });
    const fullPath = absolutePathJoin(dir, fileName);
    await fs.writeFile(fullPath, buffer);
    const relativePath = path.posix.join(
      APP_FOLDER_NAMES.state,
      APP_FOLDER_NAMES.agentBrowserState,
      fileName,
    );

    return {
      hash,
      screenshot: {
        path: relativePath,
        ...(target.title ? { title: target.title } : {}),
        url: target.url,
      },
    };
  } catch (error) {
    getWorkspaceConfig().captureException(error, {
      scopes: ["workspace"],
    });
    return undefined;
  }
}

// Filenames are scanned by humans/agents via `ls -lt`, so keep them readable
// but safe across filesystems: lowercase, only [a-z0-9.-], bounded length.
const MAX_TITLE_SEGMENT_LENGTH = 40;

function buildScreenshotFileName({
  hash,
  title,
  url,
}: {
  hash: string;
  title?: string;
  url: string;
}): string {
  const timestamp = getCurrentDate().toISOString().replaceAll(/[:.]/g, "-");
  const host = hostnameFromUrl(url);
  const titleSegment = sanitizeSegment(title ?? "").slice(
    0,
    MAX_TITLE_SEGMENT_LENGTH,
  );
  const segments = [timestamp, host, titleSegment].filter(Boolean);
  return `${segments.join("--")}--${hash}.jpg`;
}

function hostnameFromUrl(url: string): string {
  try {
    return sanitizeSegment(new URL(url).hostname);
  } catch {
    return "";
  }
}

function sanitizeSegment(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

function truncateError(error: string): string {
  const trimmed = error.trim();
  if (trimmed.length <= MAX_ERROR_LENGTH) {
    return trimmed;
  }
  return `... (truncated ${trimmed.length - MAX_ERROR_LENGTH} characters)\n${trimmed.slice(-MAX_ERROR_LENGTH)}`;
}
