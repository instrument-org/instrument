import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { AppConfig } from "./app-config/types";

import { APP_FOLDER_NAMES } from "../constants";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type ProjectSubdomain } from "../schemas/subdomains";
import { absolutePathJoin } from "./absolute-path-join";
import { getToolResultsDir } from "./app-dir-utils";
import { getCurrentDate } from "./get-current-date";

const screenshotPathsByPartIdByHash = new Map<
  StoreId.Part,
  Map<string, string>
>();

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
// a starting screenshot synchronously (the observation isn't created if
// that fails); returns a handle whose `complete` captures the ending
// screenshot and finalizes the record. Both writes share the same
// context-item id so the UI replaces the in-flight card in place rather
// than rendering two cards per command.
//
// Returns `undefined` when no observation could be opened (no live
// target, or the start-of-command capture failed). Callers should treat
// that as "this command happened without observation" and continue.
export async function beginBrowserCommandObservation({
  appConfig,
  partId,
  subcommand,
  subdomain,
  upsertContextItem,
}: {
  appConfig: AppConfig;
  partId: StoreId.Part;
  subcommand: string;
  subdomain: ProjectSubdomain;
  upsertContextItem: UpsertContextItem;
}): Promise<BrowserCommandObservation | undefined> {
  const startScreenshot = await captureBrowserScreenshot({
    appConfig,
    partId,
    subdomain,
  });
  if (!startScreenshot) {
    return undefined;
  }

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
          partId,
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
  partId,
  subdomain,
}: {
  appConfig: AppConfig;
  partId: StoreId.Part;
  subdomain: ProjectSubdomain;
}): Promise<SessionMessagePart.AgentBrowserScreenshot | undefined> {
  try {
    const { workspaceConfig } = appConfig;
    const targets = await workspaceConfig.browser.listTargets(subdomain);
    const target = targets[0];
    if (!target) {
      return undefined;
    }

    // Electron's WebContentsView is bootstrapped with `loadURL("about:blank")`
    // in BrowserViewManager.createTarget so CDP becomes responsive (Page.enable
    // hangs without an initial main frame). Capturing that blank page wastes a
    // CDP round-trip and produces a useless white JPEG that adds noise to the
    // observation timeline and the system note. Skip it.
    if (!target.url || target.url === "about:blank") {
      return undefined;
    }

    const screenshotResult = await workspaceConfig.browser.sendCommand(
      target.id,
      "Page.captureScreenshot",
      { captureBeyondViewport: false, format: "jpeg", quality: 70 },
    );
    const dataB64 = screenshotResult.data;
    if (!dataB64) {
      return undefined;
    }

    const buffer = Buffer.from(dataB64, "base64");
    // Truncated SHA-1: 12 hex chars = 48 bits. Per-tool-call namespace, so
    // collision risk among the handful of screenshots in one call is
    // negligible.
    const hash = createHash("sha1").update(buffer).digest("hex").slice(0, 12);

    let pathsByHash = screenshotPathsByPartIdByHash.get(partId);
    if (!pathsByHash) {
      pathsByHash = new Map();
      screenshotPathsByPartIdByHash.set(partId, pathsByHash);
    }

    // Dedupe by content hash within a tool call: we always *capture* a
    // screenshot at the start and end of every browser command, but only
    // the unique bytes are persisted to disk. Identical pre/post pairs
    // (typical for non-mutating commands like `get title`) end up sharing
    // a single JPEG file referenced by both the startScreenshot and
    // endScreenshot fields of the same observation.
    let relativePath = pathsByHash.get(hash);
    if (!relativePath) {
      const dir = getToolResultsDir(appConfig.appDir);
      await fs.mkdir(dir, { recursive: true });
      const fileName = `agent-browser-${hash}.jpg`;
      const fullPath = absolutePathJoin(dir, fileName);
      await fs.writeFile(fullPath, buffer);
      relativePath = path.posix.join(
        APP_FOLDER_NAMES.private,
        APP_FOLDER_NAMES.toolResults,
        fileName,
      );
      pathsByHash.set(hash, relativePath);
    }

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
