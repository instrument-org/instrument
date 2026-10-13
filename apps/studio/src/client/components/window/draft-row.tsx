import { type Draft, draftGroupOf } from "@/client/atoms/window";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import { CircleDashedIcon } from "@phosphor-icons/react/CircleDashed";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { fileHref, folderHref } from "@/shared/computer-href";
import { unique } from "radashi";
import { type ReactNode } from "react";

import { useAppsBySlug } from "./apps-by-slug";

import { TopicPill } from "./chat-row";
import { activityLabel, draftTitle, type Topic } from "./chats";
import { HeldMark } from "./context-chip";
import { screenPresentation } from "./screen-presentation";
import { isHomeTab } from "./tab-model";
import { useWindowTabs } from "./window-tabs";
import { RowActionBar } from "./row-action-bar";
import { type RowAction, rowClassName } from "./row-shell";

/**
 * One draft in the Drafts place, laid out the way a chat's row is so the
 * list reads the same whichever it holds: a dashed circle in the gutter
 * where a chat wears its state, the topic it will be filed under as a pill,
 * the first line of its words as the title, "Draft" in muted where a chat's
 * latest line goes with the marks of what it holds beside it, and when it
 * was last touched at the far right. A plain
 * click, or Enter, opens the draft to go on writing; deleting it is the one
 * action at the row's edge and on its menu, and takes no confirming, since
 * the caller says what was deleted and offers it back.
 */
export function DraftRow({
  draft,
  now,
  onDelete,
  onOpen,
  topics,
}: {
  draft: Draft;
  /** The moment the time at the row's end is read against. */
  now: Date;
  onDelete: () => void;
  onOpen: () => void;
  topics: Topic[];
}) {
  const topic = topics.find((entry) => entry.id === draft.topicId);
  const actions: RowAction[] = [
    {
      icon: <TrashIcon className="size-3.5" />,
      id: "delete",
      label: "Delete draft",
      run: onDelete,
    },
  ];
  const pill = topic && <TopicPill topic={topic} />;
  const title = (
    <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/90">
      {draftTitle(draft.words)}
    </span>
  );
  const standing = (
    <span className="min-w-0 truncate text-[12px] leading-5 text-muted-foreground">
      Draft
    </span>
  );
  const time = (
    <span className="shrink-0 text-right text-[11px] text-muted-foreground/70 tabular-nums">
      {activityLabel(new Date(draft.updatedAt), now)}
    </span>
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={rowClassName(false)}
          onClick={onOpen}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.target === event.currentTarget) {
              onOpen();
            }
          }}
          role="button"
          tabIndex={0}
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center">
            <span aria-label="Draft" className="flex text-muted-foreground">
              <CircleDashedIcon className="size-3.5" />
            </span>
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex h-5 items-center gap-1.5">
              {pill}
              {title}
              {time}
            </p>
            <p className="mt-0.5 flex items-center gap-2">
              {standing}
              <DraftMarks draft={draft} />
            </p>
          </div>
          <RowActionBar actions={actions} />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onOpen}>Open</ContextMenuItem>
        <ContextMenuSeparator />
        {actions.map((action) => (
          <ContextMenuItem
            key={action.id}
            onSelect={action.run}
            variant="destructive"
          >
            {action.icon}
            {action.label}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** How many marks a draft's row shows of what it holds before a count of the rest. */
const ROW_MARKS = 5;

/**
 * The marks of what a draft holds: its tabs (a site's icon, a folder, a
 * file's type, an app) and then what its composer was given, by path.
 */
function DraftMarks({ draft }: { draft: Draft }) {
  const { allTabs } = useWindowTabs();
  const appsBySlug = useAppsBySlug();
  const group = draftGroupOf(draft.id);
  const marks: { icon: ReactNode; key: string }[] = [
    ...allTabs
      .filter((tab) => tab.group === group && !isHomeTab(tab))
      .map((tab) => ({
        icon: <HeldMark appsBySlug={appsBySlug} tab={tab} />,
        key: tab.id,
      })),
    ...[...(draft.chosen ?? []), ...(draft.attached ?? [])].map((item) => ({
      icon: screenPresentation(
        item.kind === "folder" ? folderHref(item.path) : fileHref(item.path),
        { appsBySlug },
      ).icon,
      key: item.path,
    })),
  ];
  const shown = unique(marks, (mark) => mark.key);
  if (shown.length === 0) {
    return null;
  }
  return (
    <span className="flex min-w-0 items-center gap-1 text-muted-foreground [&_img]:size-3.5 [&_img]:rounded-xs [&_svg]:size-3.5">
      {shown.slice(0, ROW_MARKS).map((mark) => (
        <span
          className="grid size-4 shrink-0 place-items-center"
          key={mark.key}
        >
          {mark.icon}
        </span>
      ))}
      {shown.length > ROW_MARKS && (
        <span className="text-[10px] font-medium">
          +{shown.length - ROW_MARKS}
        </span>
      )}
    </span>
  );
}
