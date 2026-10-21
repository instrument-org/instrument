import { type RPCOutput } from "@/client/rpc/client";

type Verdict = RPCOutput["workspaces"]["checkFolder"];
type Summary = RPCOutput["workspaces"]["summary"];

/**
 * What Continue does with the folder on screen, from what the check of it
 * answered and what is in it:
 *
 * - `move`: make it if it isn't there (`create`), then move the Instrument
 *   folder in, which restarts the app.
 * - `exists`: it has things in it already (frame 08); say so first, and the
 *   next Continue moves in beside them.
 * - `earlier`: it is an Instrument folder with chats (frame 09); say so
 *   first, and the next Continue opens it.
 * - `denied`: the system refused it, which in Documents means the person
 *   said no to the prompt (frame 07); fall back to the home folder.
 * - `unfinished`: the folder is still being updated from an earlier build,
 *   so it can't move this launch; the page offers to leave it where it is.
 * - `refused`: somewhere the folder can't go, with why.
 *
 * `seen` is the note already shown for this folder, so the second Continue
 * goes on.
 */
export type FolderAction =
  | { create: boolean; type: "move" }
  | { chats: number; type: "earlier" }
  | { items: number; type: "exists" }
  | { reason: Extract<Verdict, { kind: "refused" }>["reason"]; type: "refused" }
  | { type: "denied" }
  | { type: "open" }
  | { type: "unfinished" };

export function folderAction({
  seen,
  summary,
  verdict,
}: {
  seen: "earlier" | "exists" | null;
  summary: Summary;
  verdict: Verdict;
}): FolderAction {
  switch (verdict.kind) {
    case "workspace": {
      return seen === "earlier"
        ? { type: "open" }
        : { chats: summary?.chats ?? 0, type: "earlier" };
    }
    case "movable": {
      const items = summary?.items ?? 0;
      return items > 0 && seen !== "exists"
        ? { items, type: "exists" }
        : { create: false, type: "move" };
    }
    case "refused": {
      if (verdict.reason === "missing") {
        return { create: true, type: "move" };
      }
      if (verdict.reason === "unwritable") {
        return { type: "denied" };
      }
      if (verdict.reason === "unfinished") {
        return { type: "unfinished" };
      }
      return { reason: verdict.reason, type: "refused" };
    }
  }
}

/** "1 item", "214 items". */
export function count(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? "" : "s"}`;
}
