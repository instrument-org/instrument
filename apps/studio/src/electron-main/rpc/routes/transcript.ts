import { base, devOnly } from "@/electron-main/rpc/base";
import { APP_NAME } from "@instrument-org/shared";
import {
  findAvailableName,
  getTaskSettings,
  StoreId,
  taskDir,
  type TaskId,
  TaskIdSchema,
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
 * A session, rendered out of the app.
 *
 * Saving one is the product's, not the developer menu's: handing a transcript
 * to somebody, or to an agent, is an ordinary thing to want, and a person who
 * has to turn developer mode on to get their own conversation out of the app
 * cannot have it at all. Reading one back into the app and putting one on the
 * clipboard stay behind developer mode: the first is a debugging screen, and
 * the second replaces whatever the user was holding with a whole conversation.
 */

async function buildSystemFrontMatter(taskId: TaskId) {
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

  const taskDirPath = taskDir(taskId);
  const settings = await getTaskSettings(taskDirPath);

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
    taskName: settings?.name ?? "unknown",
    // Absolute path to the task's on-disk folder so an agent reading this
    // transcript can inspect its artifacts (screenshots, output, task.db),
    // which is most of why a transcript gets handed to one. It names the
    // user's own machine in a file the user asked for and nothing sends it
    // anywhere, so where the file goes next is theirs to decide.
    taskDir: taskDirPath,
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
  id: TaskIdSchema,
  /**
   * What the saved file is named after, when the task's own name is not what
   * the user asked for: a conversation holds one session per channel, and every
   * one of them would otherwise land in Downloads under the conversation's name.
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

/** The rendered transcript itself, for the viewer that shows one in the app. */
const content = devOnly
  .input(transcriptInput)
  .output(z.object({ content: z.string() }))
  .handler(async ({ context, input, signal }) => ({
    content: await renderTranscript({ context, input, signal }),
  }));

// Copying happens here rather than in the renderer: a transcript is the largest
// thing this route produces, and the renderer would only be receiving it to hand
// it straight back to the OS.
const copy = devOnly
  .input(transcriptInput)
  .handler(async ({ context, input, signal }) => {
    clipboard.writeText(await renderTranscript({ context, input, signal }));
  });

const save = base
  .input(transcriptInput)
  .output(z.object({ filepath: z.string() }))
  .handler(async ({ context, input, signal }) => {
    const markdown = await renderTranscript({ context, input, signal });

    const settings = await getTaskSettings(taskDir(input.id));
    const outputPath = app.getPath("downloads");
    const { name: filename } = await findAvailableName({
      isTaken: (candidate) =>
        fsSync.existsSync(path.join(outputPath, candidate)),
      name: `${transcriptFilenameStem(input.label ?? settings?.name ?? input.id)}.${TRANSCRIPT_EXTENSION[input.format]}`,
      splitExtension: true,
    });

    const filepath = path.join(outputPath, filename);
    await fs.writeFile(filepath, markdown, "utf8");

    // The transcript is usually saved on its way to an agent, and what an agent
    // needs is the path, not the bytes. Leaving it on the clipboard turns the
    // next step into a paste instead of a hunt through Downloads.
    clipboard.writeText(filepath);

    return { filepath };
  });

// Names the file after the task it came from, the way the zip export does, so a
// Downloads folder holding a few of these still says which is which.
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
  content,
  copy,
  save,
};
