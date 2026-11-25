import { folderLabel } from "@/client/lib/path-utils";
import { COMPUTER_ROOT } from "@/shared/computer-href";
import { expandHomePath } from "@instrument-org/shared";
import { type ChatId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";

import { chatListOptions } from "./chat-list-query";
import { Peek } from "./chat-row";
import { RECENTS_ROOT } from "./computer-page";
import { folderOf, joinHostPath, parentFolderOf } from "./host-path";
import { type StripTab } from "./tab-strip";
import { matchScreen } from "./window-href";

/**
 * What hovering a window tab says: its name over where it is, a line each.
 * A page's site, the name of the folder a file or folder is in, a chat's
 * latest line. A tab that says all it has (Chats, Apps, Browser, a new tab) keeps
 * the bare name.
 */
export function tabTooltip(
  href: string,
  presentation: { title: string; url?: string | undefined } | undefined,
): StripTab["tooltip"] {
  if (!presentation) {
    return undefined;
  }
  const { title, url } = presentation;
  if (url !== undefined) {
    return { detail: hostOf(url), title };
  }
  const screen = matchScreen(href);
  if (screen.kind === "chat") {
    return { detail: <ChatTabLine chat={screen.chat} />, title };
  }
  if (screen.kind !== "computer") {
    return undefined;
  }
  const home = window.api.homeDir;
  let folder: null | string;
  if (screen.file !== undefined) {
    folder = folderOf(expandHomePath(screen.file, home));
  } else if (screen.root === COMPUTER_ROOT || screen.root === RECENTS_ROOT) {
    // The computer and Recents are no folder, so they are in none.
    return undefined;
  } else {
    // The top of a disk is in no folder either.
    folder = parentFolderOf(
      expandHomePath(joinHostPath(screen.root, screen.path), home),
    );
  }
  if (folder === null) {
    return undefined;
  }
  return { detail: folderLabel(folder), title };
}

/** A page's site, or its whole address where it has none. */
function hostOf(url: string): string {
  return (
    (URL.canParse(url) && new URL(url).hostname.replace(/^www\./, "")) || url
  );
}

/** A chat's latest line, as its row in the inbox says it. */
function ChatTabLine({ chat }: { chat: ChatId }) {
  const { data: found } = useQuery({
    ...chatListOptions(),
    select: (chats) => chats.find((each) => each.id === chat),
  });
  return found ? <Peek chat={found} /> : null;
}
