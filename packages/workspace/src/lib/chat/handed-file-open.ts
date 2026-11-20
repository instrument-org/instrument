import fs from "node:fs/promises";

import { publisher } from "../../rpc/publisher";
import { type ChatId } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { type StoreId } from "../../schemas/store-id";
import { ChatReads } from "../chat-reads";
import { filesNamedIn } from "../parse-files-block";
import { resolveWorkspaceFilePaths } from "../resolve-workspace-file-path";
import { getWorkspaceConfig } from "../workspace-config";
import { sessionRole } from "./children";
import { askWindow } from "./window-tab";

/**
 * The files a reply hands over that open beside the chat as the turn ends,
 * by extension: what the window's viewers draw whole and a card in the reply
 * cannot. A page or app (HTML), a spreadsheet, and a document of several
 * pages. Pictures, video and audio draw whole in the reply; text, Markdown,
 * code and folders are a card the person opens if they want. iWork files are
 * left out, since the viewer shows only the preview picture inside one,
 * which the card already shows; `.doc` has no viewer.
 */
const OPENS_BESIDE_CHAT: ReadonlySet<string> = new Set([
  "htm",
  "html",
  "csv",
  "tsv",
  "xls",
  "xlsm",
  "xlsx",
  "pdf",
  "docm",
  "docx",
  "ppt",
  "pptm",
  "pptx",
]);

function extensionOf(path: string): string {
  const name = path.split("/").at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Whether a path a files fence names opens beside the chat (`OPENS_BESIDE_CHAT`); never a folder. */
export function opensBesideChat(path: string): boolean {
  return !path.endsWith("/") && OPENS_BESIDE_CHAT.has(extensionOf(path));
}

/** A step of the agent's that ran: not a failed one, nor one the harness wrote. */
function isStep(message: SessionMessage.WithParts): boolean {
  return (
    message.role === "assistant" &&
    message.metadata.error === undefined &&
    !message.metadata.synthetic
  );
}

/**
 * The paths the latest turn's files fences name, in order, and the turn's
 * last step, which names the reply; undefined for a turn with no step.
 */
export function handedFilesOf(
  messages: readonly SessionMessage.WithParts[],
): undefined | { paths: string[]; replyId: StoreId.Message } {
  const start = messages.findLastIndex((message) => message.role === "user");
  const steps = messages.slice(start + 1).filter(isStep);
  const last = steps.at(-1);
  if (last === undefined) {
    return undefined;
  }
  const text = steps
    .flatMap((step) =>
      step.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])),
    )
    .join("\n\n");
  return { paths: filesNamedIn(text), replyId: last.id };
}

/**
 * Replies already handled, by session and reply, so a second delivery of
 * the same finished turn opens nothing. The oldest go once there are more
 * than a process could still be finishing.
 */
const handled = new Set<string>();
const MOST_KEPT = 200;

function markHandled(key: string): boolean {
  if (handled.has(key)) {
    return false;
  }
  handled.add(key);
  for (const each of handled) {
    if (handled.size <= MOST_KEPT) {
      break;
    }
    handled.delete(each);
  }
  return true;
}

/** Whether a path the chat wrote is a file on this computer. */
async function isFileHere(chatId: ChatId, path: string): Promise<boolean> {
  const hostPath = (
    await resolveWorkspaceFilePaths({ chatId, filePaths: [path] })
  ).get(path);
  if (!hostPath) {
    return false;
  }
  const stats = await fs.stat(hostPath).catch(() => undefined);
  return stats?.isFile() === true;
}

/**
 * Opens beside the chat the first file its finished turn handed over that
 * opens there (`OPENS_BESIDE_CHAT`), as its own tab under the chat's agent,
 * or brings forward the chat's tab already showing it. Only a chat's own
 * turn, one that ended without a stop, and once per reply. Answers the path
 * it asked the window for, or undefined.
 */
export async function openHandedFile({
  chatId,
  notice,
  readMessages = async () => {
    const read = await ChatReads.transcript({
      chatId,
      live: false,
      sessionId,
    });
    return read.isOk() ? read.value : [];
  },
  sessionId,
  isFile = isFileHere,
}: {
  chatId: ChatId;
  isFile?: (chatId: ChatId, path: string) => Promise<boolean>;
  notice?: unknown;
  readMessages?: () => Promise<readonly SessionMessage.WithParts[]>;
  sessionId: StoreId.Session;
}): Promise<string | undefined> {
  if (notice !== undefined || sessionRole(chatId, sessionId) !== "chat") {
    return undefined;
  }
  const handed = handedFilesOf(await readMessages());
  if (handed === undefined) {
    return undefined;
  }
  if (!markHandled(`${sessionId}:${handed.replyId}`)) {
    return undefined;
  }
  for (const path of handed.paths.filter(opensBesideChat)) {
    if (await isFile(chatId, path)) {
      await askWindow({
        action: { kind: "handOver", path },
        askedBy: chatId,
        group: chatId,
      });
      return path;
    }
  }
  return undefined;
}

/**
 * Hears each turn end in this process, which is the computer that ran it,
 * and opens what its reply handed over (`openHandedFile`). Nothing that
 * reads a chat reaches here: only the live end of a turn does.
 */
export function startHandedFileOpens(): void {
  publisher.subscribe("session.done", ({ id, notice, sessionId }) => {
    void openHandedFile({
      chatId: id,
      ...(notice === undefined ? {} : { notice }),
      sessionId,
    }).catch((error: unknown) => {
      getWorkspaceConfig().captureException(error, {
        area: "handed-file-open",
      });
    });
  });
}
