import { base, devOnly } from "@/electron-main/rpc/base";
import {
  ChatIdSchema,
  chatDeveloperDetailsText,
  chatForAgentText,
  chatPlaces,
  chatStartedWithApp,
  StoreId,
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
 * Copies what another agent needs to pick up from a chat: what the app is,
 * and each of the chat's folders with what it has. The main process puts the
 * text together and copies it, so a menu item calls this with nothing fetched.
 */
const forAgent = base
  .input(z.object({ id: ChatIdSchema }))
  .handler(async ({ input }) => {
    await clipboard.writeText(chatForAgentText(await chatPlaces(input.id)));
  });

/**
 * Copies where a chat's session lives on this computer for a developer to
 * paste to a coding agent: its folders and records, its main thread, the
 * build, and which computer they are on. Behind developer mode, since it
 * names the app's own data.
 */
const developerDetails = devOnly
  .input(z.object({ id: ChatIdSchema, sessionId: StoreId.SessionSchema }))
  .handler(async ({ input }) => {
    const { id, sessionId } = input;
    const platform = os.platform();
    await clipboard.writeText(
      chatDeveloperDetailsText(await chatPlaces(id), {
        app: `${app.getVersion()} (${app.isPackaged ? "packaged" : "development"})`,
        computer: `${OS_NAMES[platform] ?? platform} ${os.release()} (${os.arch()}), named ${os.hostname()}`,
        mainThread: sessionId,
        startedWith: await chatStartedWithApp(id),
      }),
    );
  });

export const chatLocation = { developerDetails, forAgent };
