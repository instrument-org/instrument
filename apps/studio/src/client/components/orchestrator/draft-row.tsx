import { type Draft } from "@/client/atoms/orchestrator";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { TrashIcon } from "@phosphor-icons/react/Trash";

import { RowActionBar } from "./row-action-bar";
import { type RowAction, rowClassName, type RowDensity } from "./row-shell";
import { TopicPill } from "./thread-row";
import { activityLabel, draftTitle, type Topic } from "./threads";

/**
 * One draft in the Drafts place, laid out the way a thread's row is so the
 * list reads the same whichever it holds: a pencil in the gutter where a
 * thread wears its state, the topic it will be filed under as a pill, the
 * first line of its words as the title, "Draft" in muted where a thread's
 * latest line goes, and when it was last touched at the far right. A plain
 * click, or Enter, opens the draft to go on writing; deleting it is the one
 * action at the row's edge and on its menu, and takes no confirming, since
 * the caller says what was deleted and offers it back.
 */
export function DraftRow({
  density,
  draft,
  now,
  onDelete,
  onOpen,
  topics,
}: {
  density: RowDensity;
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
    <span className="shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
      {activityLabel(new Date(draft.updatedAt), now)}
    </span>
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={rowClassName(density, false)}
          data-density={density}
          onClick={onOpen}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.target === event.currentTarget) {
              onOpen();
            }
          }}
          role="button"
          tabIndex={0}
        >
          <span className="flex h-5 w-4 shrink-0 items-center justify-center">
            <span aria-label="Draft" className="flex text-muted-foreground">
              <PencilSimpleIcon className="size-3.5" />
            </span>
          </span>
          {density === "slim" ? (
            <>
              <span className="flex min-w-0 basis-[38%] items-center gap-1.5">
                {pill}
                {title}
              </span>
              <span className="flex min-w-0 flex-1">{standing}</span>
              {/* The slot a thread's reply count takes, empty, so the times
                line up with the threads' down a mixed list. */}
              <span className="w-9 shrink-0" />
              <span className="w-14 shrink-0 text-right">{time}</span>
            </>
          ) : (
            <div className="min-w-0 flex-1">
              <p className="flex h-5 items-center gap-1.5">
                {pill}
                {title}
                {time}
              </p>
              <p className="mt-0.5 flex">{standing}</p>
            </div>
          )}
          <RowActionBar actions={actions} density={density} />
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
