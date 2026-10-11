import { devOnly } from "@/electron-main/rpc/base";
import { APP_NAME } from "@instrument-org/shared";
import {
  chatTitle,
  findAvailableName,
  getChatSettings,
  StoreId,
  chatDir,
  type ChatId,
  ChatIdSchema,
  workspaceRouter,
  type WorkspaceRPCContext,
} from "@instrument-org/workspace/electron";
import { call } from "@orpc/server";
import { app, clipboard } from "electron";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

/**
 * A session, rendered out of the app for a developer to hand to an agent:
 * saved to Downloads with its path on the clipboard, or copied whole. Both
 * are behind developer mode, since neither is how somebody else's run should
 * reach us.
 */

async function buildSystemFrontMatter(chatId: ChatId) {
  const platform = os.platform();
  const osName =
    platform === "darwin"
      ? "macOS"
      : platform === "win32"
        ? "Windows"
        : platform === "linux"
          ? "Linux"
          : platform;

  const env = app.isPackaged ? "production" : "development";

  const taskDirPath = chatDir(chatId);
  const settings = await getChatSettings(taskDirPath);

  return {
    appEnvironment: env,
    appName: APP_NAME,
    currentAppVersion: app.getVersion(),
    runtimeChromeVersion: process.versions.chrome,
    runtimeElectronVersion: process.versions.electron,
    runtimeLocale: app.getLocale(),
    runtimeNodeVersion: process.version,
    runtimeOs: `${osName} ${os.release()} / ${os.arch()}`,
    taskCreatedWithAppVersion: settings?.createdWithAppVersion ?? "unknown",
    taskName: (await chatTitle(chatId)) ?? "unknown",
    // Absolute path to the task's on-disk folder so an agent reading this
    // transcript can inspect its artifacts (screenshots, output, chat.db),
    // which is most of why a transcript gets handed to one. It names the
    // user's own machine in a file the user asked for and nothing sends it
    // anywhere, so where the file goes next is theirs to decide.
    chatDir: taskDirPath,
    transcriptGeneratedAt: new Date().toISOString(),
  };
}

const TranscriptFormatSchema = z.enum(["json", "markdown"]);

const TRANSCRIPT_EXTENSION = {
  json: "json",
  markdown: "md",
} as const satisfies Record<z.output<typeof TranscriptFormatSchema>, string>;

const transcriptInput = z.object({
  format: TranscriptFormatSchema,
  id: ChatIdSchema,
  /**
   * What the saved file is named after, when the record's own name is not
   * what the user knows it by: a chat is saved under its title.
   */
  label: z.string().optional(),
  sessionId: StoreId.SessionSchema,
});

// Both formats are rendered here rather than in the renderer: the JSON one is
// the session record verbatim, and shipping that across the RPC boundary as an
// object only to stringify it again doubles the cost of the largest thing this
// route ever returns.
async function renderTranscript({
  context,
  input,
  signal,
}: {
  context: WorkspaceRPCContext;
  input: z.output<typeof transcriptInput>;
  signal?: AbortSignal;
}) {
  if (input.format === "json") {
    const session = await call(
      workspaceRouter.session.byIdWithMessagesAndParts,
      { id: input.id, sessionId: input.sessionId },
      { context, signal },
    );
    return JSON.stringify(session, null, 2);
  }

  const frontMatter = await buildSystemFrontMatter(input.id);
  const { markdown } = await call(
    workspaceRouter.session.toMarkdown,
    { frontMatter, id: input.id, sessionId: input.sessionId },
    { context, signal },
  );
  return markdown;
}

// Copying happens here rather than in the renderer: a transcript is the largest
// thing this route produces, and the renderer would only be receiving it to hand
// it straight back to the OS.
const copy = devOnly
  .input(transcriptInput)
  .handler(async ({ context, input, signal }) => {
    await clipboard.writeText(
      await renderTranscript({ context, input, signal }),
    );
  });

const save = devOnly
  .input(transcriptInput)
  .output(z.object({ filepath: z.string() }))
  .handler(async ({ context, input, signal }) => {
    const markdown = await renderTranscript({ context, input, signal });

    const title = await chatTitle(input.id);
    const outputPath = app.getPath("downloads");
    const { name: filename } = await findAvailableName({
      isTaken: (candidate) =>
        fsSync.existsSync(path.join(outputPath, candidate)),
      name: `${transcriptFilenameStem(input.label ?? title ?? input.id)}.${TRANSCRIPT_EXTENSION[input.format]}`,
      splitExtension: true,
    });

    const filepath = path.join(outputPath, filename);
    await fs.writeFile(filepath, markdown, "utf8");

    // The transcript is usually saved on its way to an agent, and what an agent
    // needs is the path, not the bytes. Leaving it on the clipboard turns the
    // next step into a paste instead of a hunt through Downloads.
    await clipboard.writeText(filepath);

    return { filepath };
  });

// Names the file after the task it came from, so a Downloads folder holding a
// few of these still says which is which.
function transcriptFilenameStem(taskName: string) {
  const stem = taskName
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 50);
  return stem ? `${stem}-transcript` : "transcript";
}

export const transcript = {
  copy,
  save,
};
