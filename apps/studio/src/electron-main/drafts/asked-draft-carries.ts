import { asksPart } from "@/client/components/window/asks-part";
import { sentLinkOf } from "@/client/components/window/draft-links";
import { reachablePath } from "@/client/components/window/file-tabs";
import { nameOf } from "@/client/components/window/host-path";
import { type Draft, type DraftContextItem } from "@/shared/drafts";
import {
  type ChatId,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/electron";
import { draftsFolderDir } from "@instrument-org/workspace/drafts";
import fs from "node:fs";
import path from "node:path";

/** What a draft's message carries besides its words and its folder. */
export interface AskedDraftCarries {
  asks?: SessionMessageDataPart.AsksDataPart;
  viewing?: SessionMessageDataPart.ViewContextDataPart;
}

/**
 * What the message of a draft another device asked this one to send carries
 * besides its words and its folder: its asks, as a window sends them, and
 * everything its lines name, or nothing at all where some part of it can't
 * go from here, which leaves the draft for the person to send.
 *
 * Nothing here grants the chat anything. A window grants what the person put
 * on the message in that window; a line came from a file any device can
 * write, so a file or folder goes as `chosen`, which names it, and never as
 * a chip in `attached`, which opens it. Only one in the workspace, outside
 * its `.instrument/`, goes: the workspace is the same on every computer and
 * every chat reaches it. A place elsewhere on a disk may be another
 * computer's, and nobody here has said to share it, so it keeps its draft
 * unsent. So does a file that isn't on this computer, and a chat that is gone.
 *
 * Pages, apps and chats go by their addresses (`links`): a page a window
 * would open as a tab is named, and opened by nobody.
 */
export async function askedDraftCarries(
  draft: Draft,
  {
    chatTitle,
    folders,
    rootDir,
  }: {
    /** A chat's title, or nothing for one that is not there. */
    chatTitle: (chat: ChatId) => Promise<string | undefined>;
    /** The folders the agent reaches, by name. */
    folders: () => Promise<Record<string, { path: string }>>;
    /** The workspace's own folder. */
    rootDir: string;
  },
): Promise<AskedDraftCarries | undefined> {
  const inFolder = new Set((draft.inFolder ?? []).map((item) => item.path));
  // What a composer here was given from elsewhere, which its file writes as
  // lines, beside the lines themselves.
  const items: DraftContextItem[] = [
    ...(draft.attached ?? []).flatMap(({ kind, path: at }) =>
      inFolder.has(at) ? [] : [{ kind, path: at }],
    ),
    ...(draft.context ?? []),
  ];
  const draftAsks = draft.asks ?? [];
  if (items.length === 0 && draftAsks.length === 0) {
    return {};
  }
  if (draftAsks.some((ask) => !isInWorkspace(ask.path, rootDir))) {
    return undefined;
  }
  const reach = await folders();
  const chosen: NonNullable<
    SessionMessageDataPart.ViewContextDataPart["chosen"]
  > = [];
  const links: NonNullable<
    SessionMessageDataPart.ViewContextDataPart["links"]
  > = [];
  const attached: SessionMessageDataPart.SentChip[] = [];
  for (const item of items) {
    switch (item.kind) {
      case "chat": {
        const title = await chatTitle(item.chat);
        if (title === undefined) {
          return undefined;
        }
        const { chip, link } = sentLinkOf(item, () => title);
        links.push(link);
        attached.push(chip);
        break;
      }
      case "file":
      case "folder": {
        if (!isInWorkspace(item.path, rootDir)) {
          return undefined;
        }
        if (!chosen.some((held) => held.path === item.path)) {
          const mount = reachablePath(item.path, reach);
          chosen.push({
            kind: item.kind,
            ...(mount === undefined ? {} : { mount }),
            name: nameOf(item.path),
            path: item.path,
          });
        }
        break;
      }
      case "link": {
        // A file by its address is a place on a disk, whatever it is written as.
        if (item.url.toLowerCase().startsWith("file:")) {
          return undefined;
        }
        const { chip, link } = sentLinkOf(item, () => undefined);
        links.push(link);
        attached.push(chip);
        break;
      }
    }
  }
  const asks = asksPart(draftAsks, reach);
  return {
    ...(asks ? { asks } : {}),
    ...(items.length > 0
      ? {
          viewing: {
            ...(attached.length > 0 ? { attached } : {}),
            ...(chosen.length > 0 ? { chosen } : {}),
            ...(links.length > 0 ? { links } : {}),
            screen: draft.chatId === undefined ? "home" : "conversation",
          },
        }
      : {}),
  };
}

/**
 * Whether a path is something here in the workspace, outside the folder the
 * app keeps its own records in. Read through links, so one leading out of
 * the workspace is not in it.
 */
function isInWorkspace(target: string, rootDir: string): boolean {
  try {
    const at = fs.realpathSync(target);
    const root = fs.realpathSync(rootDir);
    // The folder holding the drafts' is the app's own (`.instrument/`).
    const own = path.join(
      root,
      path.relative(rootDir, path.dirname(draftsFolderDir(rootDir))),
    );
    return isUnder(at, root) && at !== own && !isUnder(at, own);
  } catch {
    return false;
  }
}

function isUnder(target: string, dir: string): boolean {
  const within = path.relative(dir, target);
  return (
    within !== "" &&
    within !== ".." &&
    !within.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(within)
  );
}
