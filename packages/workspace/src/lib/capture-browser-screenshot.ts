import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { AppConfig } from "./app-config/types";

import { APP_FOLDER_NAMES } from "../constants";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { type StoreId } from "../schemas/store-id";
import { type ProjectSubdomain } from "../schemas/subdomains";
import { absolutePathJoin } from "./absolute-path-join";
import { getToolResultsDir } from "./app-dir-utils";
import { getCurrentDate } from "./get-current-date";

const screenshotPathsByPartIdByHash = new Map<
  StoreId.Part,
  Map<string, string>
>();

export type AppendContextItem = (
  item: SessionMessagePart.ToolPartContextItem,
) => Promise<void>;

export async function captureBrowserScreenshot({
  appConfig,
  appendContextItem,
  command,
  partId,
  subdomain,
}: {
  appConfig: AppConfig;
  appendContextItem: AppendContextItem;
  command: string;
  partId: StoreId.Part;
  subdomain: ProjectSubdomain;
}): Promise<void> {
  try {
    const { workspaceConfig } = appConfig;
    const targets = await workspaceConfig.browser.listTargets(subdomain);
    const target = targets[0];
    if (!target) {
      return;
    }

    const screenshotResult = (await workspaceConfig.browser.sendCommand(
      target.id,
      "Page.captureScreenshot",
      { captureBeyondViewport: false, format: "png" },
    )) as null | { data?: string };
    const dataB64 = screenshotResult?.data;
    if (!dataB64) {
      return;
    }

    const buffer = Buffer.from(dataB64, "base64");
    // Truncated SHA-1: 12 hex chars = 48 bits. Per-tool-call namespace, so
    // collision risk among the handful of screenshots in one call is negligible.
    const hash = createHash("sha1").update(buffer).digest("hex").slice(0, 12);

    let pathsByHash = screenshotPathsByPartIdByHash.get(partId);
    if (!pathsByHash) {
      pathsByHash = new Map();
      screenshotPathsByPartIdByHash.set(partId, pathsByHash);
    }

    // Skip duplicates: if we've already captured this exact image for this
    // tool call, don't write a new file *and* don't append a redundant
    // context item.
    if (pathsByHash.has(hash)) {
      return;
    }

    const dir = getToolResultsDir(appConfig.appDir);
    await fs.mkdir(dir, { recursive: true });
    const fileName = `agent-browser-${hash}.png`;
    const fullPath = absolutePathJoin(dir, fileName);
    await fs.writeFile(fullPath, buffer);
    const relativePath = path.posix.join(
      APP_FOLDER_NAMES.private,
      APP_FOLDER_NAMES.toolResults,
      fileName,
    );
    pathsByHash.set(hash, relativePath);

    await appendContextItem({
      command,
      createdAt: getCurrentDate(),
      kind: "agent-browser-screenshot",
      screenshotPath: relativePath,
      title: target.title || undefined,
      url: target.url,
    });
  } catch (error) {
    appConfig.workspaceConfig.captureException(error, {
      scopes: ["workspace"],
    });
  }
}
