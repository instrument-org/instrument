import { stageIntoDraft, trashFromDraft } from "@/client/drafts/store";
import { toast } from "@/client/lib/toast";
import { type Draft, type DraftAttachment } from "@/shared/drafts";
import type { FileUpload } from "@instrument-org/workspace/client";
import { isEqual, unique } from "radashi";
import { type RefObject, useEffect, useRef } from "react";
import { ulid } from "ulid";

import { type AttachedItem, type PromptInputRef } from "./prompt-input";

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
 * the chat when the draft is sent. Taking an item out of the box takes it out
 * of the draft's folder too, to the Trash, since everything in the folder
 * goes with the message.
 */
export function useDraftStaging({
  draftFor,
  onChange,
}: {
  /**
   * The draft what the box holds belongs to. Made if there is not one yet
   * where `make` says so, which is when there is something to keep: a paste
   * is on disk the moment it arrives, so it needs a folder of its own before
   * the words have settled into a draft.
   */
  draftFor: (make: boolean) => string | undefined;
  /** Changes that draft, by its id. */
  onChange: (draftId: string, update: (draft: Draft) => Draft) => void;
}) {
  const staged = useRef(new Map<string, DraftAttachment | null>());
  const latestItems = useRef<AttachedItem[]>([]);
  /** Pastes taken out of the box before their write landed, by item id, with the draft they were for. */
  const takenOut = useRef(new Map<string, string>());

  const trash = (draftId: string, path: string) => {
    trashFromDraft({ draftId, path }).catch((error: unknown) => {
      toast.error("Couldn't move that file to the Trash", { cause: error });
    });
  };

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
                mimeType: item.mediaType,
                path: item.path,
                size: item.size,
              }
            : file;
        }),
      };
    },

    /** Everything the box holds now, with what has no file behind it written one. */
    keepItems: (items: AttachedItem[]) => {
      const draftId = draftFor(items.length > 0);
      if (draftId === undefined) {
        latestItems.current = items;
        return;
      }
      for (const item of items) {
        if (
          item.type !== "file" ||
          !("content" in item) ||
          staged.current.has(item.id)
        ) {
          continue;
        }
        staged.current.set(item.id, null);
        void stageIntoDraft({
          content: item.content,
          draftId,
          itemId: item.id,
          name: item.name,
        })
          .then(({ path, size }) => {
            const outOf = takenOut.current.get(item.id);
            if (outOf !== undefined) {
              takenOut.current.delete(item.id);
              staged.current.delete(item.id);
              trash(outOf, path);
              return;
            }
            staged.current.set(item.id, {
              kind: "file",
              mediaType: item.mimeType,
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

    /** Whether a path is a paste this box wrote, which the box already shows by its bytes. */
    knows: (path: string) =>
      [...staged.current.values()].some((written) => written?.path === path),

    /**
     * An item the person took out of the box, out of the draft's folder too,
     * where it is in it: main moves it to the Trash and leaves a file the
     * draft names where it lies alone. A paste still being written is moved
     * once its write lands.
     */
    removeItem: (item: AttachedItem) => {
      const draftId = draftFor(false);
      if (draftId === undefined) {
        return;
      }
      if ("path" in item) {
        trash(draftId, item.path);
        return;
      }
      const written = staged.current.get(item.id);
      if (written === null) {
        takenOut.current.set(item.id, draftId);
      } else if (written !== undefined) {
        staged.current.delete(item.id);
        trash(draftId, written.path);
      }
    },
  };
}

/**
 * Keeps an open box in step with its draft's folder: a file put into the
 * folder from outside the app turns up in the box, and one taken out of it
 * goes. Only changes count, so what the box showed as it opened, and what
 * the person took out since, stay as they are.
 */
export function useFolderItems({
  draft,
  input,
  knows,
}: {
  draft: Draft | undefined;
  input: RefObject<null | Pick<PromptInputRef, "mergeItems">>;
  /** Whether the box already shows the file at a path some other way: a paste it wrote. */
  knows: (path: string) => boolean;
}) {
  const seen = useRef<{ id: string; paths: Set<string> } | undefined>(
    undefined,
  );
  const inFolder = draft?.inFolder;
  const id = draft?.id;
  useEffect(() => {
    const was = seen.current;
    const now = inFolder ?? [];
    seen.current =
      id === undefined
        ? undefined
        : { id, paths: new Set(now.map((item) => item.path)) };
    if (was === undefined || was.id !== id) {
      return;
    }
    const added = now.filter(
      (item) => !was.paths.has(item.path) && !knows(item.path),
    );
    const gone = [...was.paths].filter(
      (path) => !now.some((item) => item.path === path),
    );
    if (added.length > 0 || gone.length > 0) {
      input.current?.mergeItems({ added: added.map(itemOf), gone });
    }
    // Each time main reads the folder anew; `knows` and the box are read as they are then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, inFolder]);
}

/**
 * What a draft holds, back in a composer, drawn by its icon until it is
 * given again: what its composer was given, and whatever else its folder has.
 */
export function itemsOf(draft: Draft | undefined): AttachedItem[] {
  return unique(
    [...(draft?.attached ?? []), ...(draft?.inFolder ?? [])],
    (item) => item.path,
  ).map(itemOf);
}

/** A kept attachment back in a composer. */
function itemOf(attachment: DraftAttachment): AttachedItem {
  return attachment.kind === "folder"
    ? { id: ulid(), path: attachment.path, type: "folder" }
    : {
        id: ulid(),
        mimeType: attachment.mediaType,
        name: attachment.name,
        path: attachment.path,
        size: attachment.size,
        type: "file",
      };
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
  return [{ kind: "file", mediaType: mimeType, name, path, size }];
}
