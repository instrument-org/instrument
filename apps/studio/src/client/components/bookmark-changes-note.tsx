import { undoBookmarkChanges } from "@/client/bookmarks/agent-changes";
import {
  applyBookmarkOpsAtom,
  bookmarksStateAtom,
} from "@/client/bookmarks/store";
import { rpcClient } from "@/client/rpc/client";
import {
  type BookmarkChange,
  type BookmarkSide,
} from "@instrument-org/workspace/client";
import { BookmarkSimpleIcon } from "@phosphor-icons/react/BookmarkSimple";
import { BookmarksSimpleIcon } from "@phosphor-icons/react/BookmarksSimple";
import { FolderSimpleIcon } from "@phosphor-icons/react/FolderSimple";
import { useAtomValue, useStore } from "jotai";
import { useState } from "react";

import {
  ChangeCard,
  ChangeRow,
  RowGlyph,
  SHOWN_ROWS,
  useChangeCardUndo,
} from "./change-card";
import { type ChangesCard } from "./project-changes-card";

/**
 * The bookmarks a turn added, moved, renamed, readdressed or removed, as a
 * card under the reply. Undo goes through this window's bookmarks, and puts
 * back whatever still stands as the turn left it.
 */
export function BookmarkChangesNote({
  card,
  changes,
  undone: undoneBefore = false,
}: {
  /** Where the card is, for its Undo to mark it undone on every device. */
  card?: ChangesCard;
  changes: BookmarkChange[];
  /** Undone already, by this device or another. */
  undone?: boolean;
}) {
  const store = useStore();
  const state = useAtomValue(bookmarksStateAtom);
  const [expanded, setExpanded] = useState(false);
  const { undo, undone, undoing } = useChangeCardUndo({
    call: async () => {
      const {
        ops,
        skipped,
        undone: count,
      } = undoBookmarkChanges(store.get(bookmarksStateAtom), changes);
      if (count > 0) {
        await store.set(applyBookmarkOpsAtom, ops);
        if (card) {
          await rpcClient.workspace.bookmarks.markUndone.call({
            card,
            skipped,
            undone: count,
          });
        }
      }
      return { skipped, undone: count };
    },
    said: {
      all: "Your bookmarks are back the way they were.",
      some: "Your bookmarks are back the way they were, except any that changed since.",
    },
    undoneBefore,
  });
  const standing = undoBookmarkChanges(state, changes).undone > 0;
  const shown = expanded ? changes : changes.slice(0, SHOWN_ROWS);

  return (
    <ChangeCard
      heading={headingOf(changes)}
      hidden={changes.length - shown.length}
      icon={BookmarksSimpleIcon}
      onShowMore={() => {
        setExpanded(true);
      }}
      slot="bookmark-changes"
      {...(standing && {
        undo: {
          busy: undoing,
          onUndo: () => {
            void undo();
          },
        },
      })}
      undone={undone}
    >
      {shown.map((change) => {
        const side = change.after ?? change.before;
        return (
          <ChangeRow
            key={change.id}
            lead={
              <RowGlyph
                icon={
                  side?.kind === "folder"
                    ? FolderSimpleIcon
                    : BookmarkSimpleIcon
                }
              />
            }
            lines={linesOf(change)}
            name={nameOf(side)}
            quiet={undone || change.after === null}
            struck={undone}
          />
        );
      })}
    </ChangeCard>
  );
}

function nameOf(side: BookmarkSide | null) {
  return side?.title || (side?.url ?? "");
}

/** What the changes come to, by what they are all to one another: `Removed a folder and 3 bookmarks`. */
function headingOf(changes: BookmarkChange[]): string {
  const verbs = new Set(changes.map(verbOf));
  const [only] = verbs;
  const verb = verbs.size === 1 && only !== undefined ? only : "Changed";
  const counted = (kind: BookmarkSide["kind"]) => {
    const count = changes.filter(
      (change) => (change.after ?? change.before)?.kind === kind,
    ).length;
    return count === 0
      ? []
      : [count === 1 ? `a ${kind}` : `${count.toString()} ${kind}s`];
  };
  return `${verb} ${[...counted("folder"), ...counted("bookmark")].join(" and ")}`;
}

function isMoved(after: BookmarkSide, before: BookmarkSide) {
  return (
    after.folder !== before.folder ||
    after.root !== before.root ||
    after.order !== before.order
  );
}

function verbOf({ after, before }: BookmarkChange) {
  if (!before) {
    return "Added";
  }
  if (!after) {
    return "Removed";
  }
  const what = [
    ...(isMoved(after, before) ? ["Moved"] : []),
    ...(after.title === before.title ? [] : ["Renamed"]),
    ...(after.url === before.url ? [] : ["Changed"]),
  ];
  return what.length === 1 ? (what[0] ?? "Changed") : "Changed";
}

function linesOf({ after, before }: BookmarkChange) {
  if (!before) {
    return [{ key: "added", words: `Added to ${after?.place ?? ""}` }];
  }
  if (!after) {
    return [{ key: "removed", words: `Removed from ${before.place}` }];
  }
  return [
    ...(after.title === before.title
      ? []
      : [{ key: "name", words: `${before.title} → ${after.title}` }]),
    ...(after.url === before.url
      ? []
      : [
          {
            key: "address",
            words: `${before.url ?? ""} → ${after.url ?? ""}`,
          },
        ]),
    ...(isMoved(after, before)
      ? [
          {
            key: "place",
            words:
              after.place === before.place
                ? `Moved in ${after.place}`
                : `${before.place} → ${after.place}`,
          },
        ]
      : []),
  ];
}
