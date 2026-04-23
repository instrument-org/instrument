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

// Tail of stderr/stdout to attach as `error` on a failed observation. Sized
// to surface the actionable error message without flooding the array entry
// or the system note that the agent reads.
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
  const meta = appConfig.workspaceConfig.browser.getTargetMeta(targetId);
  if (!meta) {
    return undefined;
  }

  const startScreenshot = await captureBrowserScreenshot({
    appConfig,
    sessionId,
    subdomain,
  });

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
    appConfig.workspaceConfig.captureException(error, {
      scopes: ["workspace"],
    });
  }

  return {
    complete: async ({ error }) => {
      try {
        const endScreenshot = await captureBrowserScreenshot({
          appConfig,
          sessionId,
          subdomain,
        });
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
        appConfig.workspaceConfig.captureException(error_, {
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
}): Promise<SessionMessagePart.AgentBrowserScreenshot | undefined> {
  try {
    const { workspaceConfig } = appConfig;
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
    // Truncated SHA-1: 12 hex chars = 48 bits. The namespace is the
    // project's on-disk screenshot folder; a collision would mean two
    // screenshots with different content land at the same path. At 48
    // bits the birthday bound is ~16M files before a 50% chance, well
    // beyond any realistic per-project volume.
    const hash = createHash("sha1").update(buffer).digest("hex").slice(0, 12);

    // Filename is the content hash, so identical pre/post pairs (typical
    // for non-mutating commands like `get title`) naturally collapse to a
    // single file on disk that both startScreenshot and endScreenshot
    // reference. Re-writing the same bytes to the same path on a hash
    // collision within a session is idempotent and cheaper than tracking
    // a process-lifetime cache.
    const dir = getAgentBrowserStateDir(appConfig.appDir);
    await fs.mkdir(dir, { recursive: true });
    const fileName = `${hash}.jpg`;
    const fullPath = absolutePathJoin(dir, fileName);
    await fs.writeFile(fullPath, buffer);
    const relativePath = path.posix.join(
      APP_FOLDER_NAMES.state,
      APP_FOLDER_NAMES.agentBrowserState,
      fileName,
    );

    return {
      path: relativePath,
      ...(target.title ? { title: target.title } : {}),
      url: target.url,
    };
  } catch (error) {
    appConfig.workspaceConfig.captureException(error, {
      scopes: ["workspace"],
    });
    return undefined;
  }
}

function truncateError(error: string): string {
  const trimmed = error.trim();
  if (trimmed.length <= MAX_ERROR_LENGTH) {
    return trimmed;
  }
  return `... (truncated ${trimmed.length - MAX_ERROR_LENGTH} characters)\n${trimmed.slice(-MAX_ERROR_LENGTH)}`;
}
