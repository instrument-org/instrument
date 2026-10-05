import { eventIterator } from "@orpc/server";
import { z } from "zod";

import { folderReach } from "../../lib/chat/folder-reach";
import {
  ensureOutputFolder,
  outputFolderPath,
} from "../../lib/chat/output-folder";
import { resolveChat } from "../../lib/record-folders";
import { ensureWindowDir, updateWindowState } from "../../lib/window-state";
import { FolderAttachment } from "../../schemas/folder-attachment";
import { WINDOW_ID } from "../../schemas/window-id";
import {
  WindowTabAnswerSchema,
  WindowTabRequestSchema,
} from "../../schemas/window-tab";
import { BrowserTargetIdSchema } from "../../types";
import { base } from "../base";
import { publisher } from "../publisher";

/**
 * Makes what the window opens on, its own folder and the workspace folder
 * every chat reaches, and answers with the folders the window reaches, by the
 * name each is mounted under.
 */
const ensure = base
  .output(
    z.object({
      attachedFolders: z.record(z.string(), FolderAttachment.Schema),
    }),
  )
  .handler(async ({ context }) => {
    await ensureWindowDir();
    await ensureOutputFolder();
    // Folder decoration must not prevent a conversation from opening.
    void context.workspaceConfig
      .ensureOutputFolderIcon?.(outputFolderPath())
      .catch((error: unknown) => {
        context.workspaceConfig.captureException(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    return { attachedFolders: await folderReach(WINDOW_ID) };
  });

/**
 * The tab the window's browser has in front, which is the tab the
 * chat's own `agent-browser` drives; null once no tab is open.
 */
const setActiveTab = base
  .input(z.object({ targetId: BrowserTargetIdSchema.nullable() }))
  .handler(async ({ input }) => {
    await updateWindowState(() => ({
      browserTargetId: input.targetId ?? undefined,
    }));
  });

/**
 * What the conversation and its tasks ask of the window's tabs, as they ask,
 * each with the chat it belongs to when there is one.
 */
const tab = base
  .output(eventIterator(WindowTabRequestSchema))
  .handler(async function* ({ signal }) {
    for await (const event of publisher.subscribe("window.tab", {
      signal,
    })) {
      // A chat's own asks, and those of any task asking among a chat's tabs,
      // go to the window.
      if (resolveChat(event.id) || event.chatId !== undefined) {
        const { id: _asker, ...request } = event;
        yield request;
      }
    }
  });

/** The window's answer to an ask of its tabs: the tab it acted on or made, or why it did nothing. */
const tabDone = base.input(WindowTabAnswerSchema).handler(({ input }) => {
  publisher.publish("window.tabDone", { ...input, id: WINDOW_ID });
});

export const window = {
  ensure,
  events: { tab },
  setActiveTab,
  tabDone,
};
