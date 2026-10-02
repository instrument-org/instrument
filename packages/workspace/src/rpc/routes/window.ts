import { eventIterator } from "@orpc/server";
import { z } from "zod";

import { ensureWindowRecord } from "../../lib/chat/ensure";
import {
  ensureOutputFolder,
  outputFolderPath,
} from "../../lib/chat/output-folder";
import { isChatId } from "../../lib/record-folders";
import { taskDir } from "../../lib/task-dir-utils";
import { setTaskState } from "../../lib/task-record";
import { TaskIdSchema } from "../../schemas/task-id";
import {
  WindowTabAnswerSchema,
  WindowTabRequestSchema,
} from "../../schemas/window-tab";
import { BrowserTargetIdSchema } from "../../types";
import { base, toORPCError } from "../base";
import { publisher } from "../publisher";

/**
 * The window's own record, created on first use, and the workspace folder
 * every chat reaches.
 */
const ensure = base
  .output(z.object({ taskId: TaskIdSchema }))
  .handler(async ({ context, errors }) => {
    const result = await ensureWindowRecord();
    if (result.isErr()) {
      context.workspaceConfig.captureException(result.error);
      throw toORPCError(result.error, errors);
    }
    await ensureOutputFolder();
    // Folder decoration must not prevent a conversation from opening.
    void context.workspaceConfig
      .ensureOutputFolderIcon?.(outputFolderPath())
      .catch((error: unknown) => {
        context.workspaceConfig.captureException(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    return result.value;
  });

/**
 * The tab the window's browser has in front, which is the tab the
 * chat's own `agent-browser` drives; null once no tab is open.
 */
const setActiveTab = base
  .input(
    z.object({ id: TaskIdSchema, targetId: BrowserTargetIdSchema.nullable() }),
  )
  .handler(async ({ input }) => {
    await setTaskState(taskDir(input.id), {
      browserTargetId: input.targetId ?? undefined,
    });
  });

/**
 * What the conversation and its tasks ask of the window's tabs, as they ask,
 * each with the chat it belongs to when there is one.
 */
const tab = base
  .input(z.object({ id: TaskIdSchema }))
  .output(eventIterator(WindowTabRequestSchema))
  .handler(async function* ({ input, signal }) {
    for await (const event of publisher.subscribe("window.tab", {
      signal,
    })) {
      // A chat's own asks, the window record's, and those of any task asking
      // among a chat's tabs all go to the window.
      if (
        event.id === input.id ||
        isChatId(event.id) ||
        event.sessionId !== undefined
      ) {
        const { id: _asker, ...request } = event;
        yield request;
      }
    }
  });

/** The window's answer to an ask of its tabs: the tab it acted on or made, or why it did nothing. */
const tabDone = base
  .input(WindowTabAnswerSchema.extend({ id: TaskIdSchema }))
  .handler(({ input }) => {
    publisher.publish("window.tabDone", input);
  });

export const window = {
  ensure,
  events: { tab },
  setActiveTab,
  tabDone,
};
