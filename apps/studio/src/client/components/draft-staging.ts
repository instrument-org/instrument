import { type Draft, type DraftAttachment } from "@/client/atoms/drafts";
import { rpcClient } from "@/client/rpc/client";
import type { FileUpload } from "@instrument-org/workspace/client";
import { isEqual } from "radashi";
import { useRef } from "react";
import { ulid } from "ulid";

import { type AttachedItem } from "./prompt-input";

/**
 * The name at the end of a path this computer wrote, whichever way it
 * writes one. `node:path` is the main process's; a renderer has the path as
 * a string and nothing to read it with.
 */
function writtenName(at: string): string {
  return at.split(/[/\\]/).pop() ?? at;
}

/** What a composer hands over to be sent: the files among it are what this is about. */
interface Sending {
  files?: FileUpload.Input[];
}

/**
 * What a box holds besides its words, kept with its draft.
 *
 * A file or folder from disk is kept by its path. Bytes with no file behind
 * them (a pasted image, a long paste made a file) are written into the
 * draft's own folder as they arrive and kept by that path, so they outlast a
 * relaunch, and the one copy in the draft's folder is the copy that goes to
 * the chat when the draft is sent.
 */
export function useDraftStaging({
  draftFor,
  onChange,
}: {
  /**
   * The draft what is pasted belongs to, made if there is not one yet: a
   * paste is on disk the moment it arrives, so it needs a folder of its own
   * before the words have settled into a draft.
   */
  draftFor: () => string;
  /** Changes that draft, by its id. */
  onChange: (draftId: string, update: (draft: Draft) => Draft) => void;
}) {
  const staged = useRef(new Map<string, DraftAttachment | null>());
  const latestItems = useRef<AttachedItem[]>([]);

  const keepAttached = (draftId: string, items: AttachedItem[]) => {
    latestItems.current = items;
    const kept = items.flatMap((item) => {
      if (item.type === "file" && "content" in item) {
        const written = staged.current.get(item.id);
        return written ? [written] : [];
      }
      return attachmentOf(item);
    });
    onChange(draftId, (current) => {
      if (isEqual(current.attached ?? [], kept)) {
        return current;
      }
      const { attached: _was, ...rest } = current;
      return kept.length > 0 ? { ...rest, attached: kept } : rest;
    });
  };

  return {
    /**
     * The send with every pasted file as the copy in the draft's own folder
     * rather than as its bytes again. A paste whose write has not landed yet
     * still goes as bytes, so a quick press sends everything either way.
     *
     * Matched by name, each staged file taken once, since the box hands over
     * what it holds without the ids it holds them under and two pastes can
     * carry one name. Only what the box still holds is matched: a paste the
     * person took out again is still written in the draft's folder under the
     * name they both carry, and matching every written file by name would
     * send the one they removed.
     */
    asStaged: <T extends Sending>(send: T): T => {
      if (!send.files) {
        return send;
      }
      const spare = latestItems.current.flatMap((item) => {
        const written = staged.current.get(item.id);
        return written?.kind === "file" ? [written] : [];
      });
      return {
        ...send,
        files: send.files.map((file) => {
          if (!("content" in file)) {
            return file;
          }
          const at = spare.findIndex((item) => item.name === file.filename);
          const [item] = at === -1 ? [] : spare.splice(at, 1);
          return item
            ? {
                // The name it was written under, which is numbered where the
                // folder already held one of that name. The check on the way
                // in reads the name off the path and refuses a send whose
                // name says otherwise.
                filename: writtenName(item.path),
                mimeType: item.mimeType,
                path: item.path,
                size: item.size,
              }
            : file;
        }),
      };
    },

    /** Everything the box holds now, with what has no file behind it written one. */
    keepItems: (items: AttachedItem[]) => {
      const draftId = draftFor();
      for (const item of items) {
        if (
          item.type !== "file" ||
          !("content" in item) ||
          staged.current.has(item.id)
        ) {
          continue;
        }
        staged.current.set(item.id, null);
        void rpcClient.drafts.stage
          .call({
            content: item.content,
            draftId,
            itemId: item.id,
            name: item.name,
          })
          .then(({ path, size }) => {
            staged.current.set(item.id, {
              kind: "file",
              mimeType: item.mimeType,
              name: item.name,
              path,
              size,
            });
            keepAttached(draftId, latestItems.current);
          })
          .catch(() => {
            staged.current.delete(item.id);
          });
      }
      keepAttached(draftId, items);
    },
  };
}

/** What a draft holds, back in a composer, drawn by its icon until it is given again. */
export function itemsOf(draft: Draft | undefined): AttachedItem[] {
  return (draft?.attached ?? []).map((attachment) =>
    attachment.kind === "folder"
      ? { id: ulid(), path: attachment.path, type: "folder" as const }
      : {
          id: ulid(),
          mimeType: attachment.mimeType,
          name: attachment.name,
          path: attachment.path,
          size: attachment.size,
          type: "file" as const,
        },
  );
}

/** What of an item in the composer is kept with the draft: its path, for one that has a place on disk. */
function attachmentOf(item: AttachedItem): DraftAttachment[] {
  if (item.type === "folder") {
    return [{ kind: "folder", path: item.path }];
  }
  if (!("path" in item)) {
    return [];
  }
  const { mimeType, name, path, size } = item;
  return [{ kind: "file", mimeType, name, path, size }];
}
