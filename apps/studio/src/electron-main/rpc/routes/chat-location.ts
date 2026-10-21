import { devOnly } from "@/electron-main/rpc/base";
import {
  chatDir,
  ChatIdSchema,
  chatStartedWithApp,
  chatTitle,
  StoreId,
  workDir,
} from "@instrument-org/workspace/electron";
import { app, clipboard } from "electron";
import os from "node:os";
import { z } from "zod";

const OS_NAMES: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "macOS",
  linux: "Linux",
  win32: "Windows",
};

/**
 * Where a chat's session lives on this computer, as `key: value` lines for a
 * developer to paste to a coding agent: the agent reads the records and the
 * work folder itself, and `host` says which computer they are on. Behind
 * developer mode, since it names paths on the developer's own disk.
 */
const copy = devOnly
  .input(z.object({ id: ChatIdSchema, sessionId: StoreId.SessionSchema }))
  .handler(async ({ input }) => {
    const { id, sessionId } = input;
    const platform = os.platform();
    const lines = {
      title: (await chatTitle(id)) ?? "unknown",
      chat: id,
      session: sessionId,
      records: chatDir(id),
      work: workDir(id),
      app: `${app.getVersion()} (${app.isPackaged ? "packaged" : "development"})`,
      "started with": (await chatStartedWithApp(id)) ?? "unknown",
      os: `${OS_NAMES[platform] ?? platform} ${os.release()} / ${os.arch()}`,
      host: os.hostname(),
    };
    await clipboard.writeText(
      Object.entries(lines)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n"),
    );
  });

export const chatLocation = { copy };
