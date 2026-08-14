import { InternalLink } from "@/client/components/internal-link";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import { Input } from "@/client/components/ui/input";
import {
  contextMenuComponents,
  type MenuComponents,
} from "@/client/components/ui/menu-components";
import { type useInlineRename } from "@/client/hooks/use-inline-rename";
import { rpcClient } from "@/client/rpc/client";
import { type Task } from "@instrument-org/workspace/client";
import { CardsThreeIcon } from "@phosphor-icons/react/CardsThree";
import { skipToken, useQuery } from "@tanstack/react-query";
import { type ReactNode, useRef, useState } from "react";

// The field's own padding, so a width built from the measured title fits the
// same text without truncating it the moment the field appears.
const RENAME_FIELD_PADDING = 32;
// Enough for a few words. Renaming a task named "Fix" in a field the width of
// the word "Fix" is worse than the small jump this costs.
const RENAME_FIELD_MIN_WIDTH = 160;
// Falls back to a plain medium field if the title was never measured.
const RENAME_FIELD_DEFAULT_WIDTH = 320;

export function TaskBreadcrumb({
  rename,
  renderMenuItems,
  task,
}: {
  rename: ReturnType<typeof useInlineRename>;
  renderMenuItems: (menuComponents: MenuComponents) => ReactNode;
  task: Task;
}) {
  const projectId = task.projectId;
  const { data: project } = useQuery(
    rpcClient.workspace.project.byId.queryOptions({
      input: projectId ? { id: projectId } : skipToken,
    }),
  );

  const titleRef = useRef<HTMLButtonElement>(null);
  const [fieldWidth, setFieldWidth] = useState<number>();

  // Nothing here is text to select: clicking the title is how a rename starts,
  // and a caret plus a highlighted word under it reads as an edit that did not
  // take.
  return (
    // No clip of its own: every crumb truncates itself, and a clip here would
    // shave the bleed off the title's hover surface.
    <div className="flex h-8 max-w-160 min-w-0 shrink cursor-default items-center gap-x-1 text-sm font-medium select-none">
      {projectId && project && (
        <>
          {/*
            Project icon as its own shrink-0 chip: it can never be squeezed away
            or overlapped, however tight the breadcrumb gets.
          */}
          <InternalLink
            className="flex shrink-0 items-center text-muted-foreground"
            openInCurrentTab
            params={{ id: projectId }}
            to="/projects/$id"
          >
            <CardsThreeIcon className="size-4" />
          </InternalLink>
          {/*
            Project name. min-w-0 must be on the link itself, not just the inner
            span: nested-flex truncation needs min-w-0 on every ancestor, or the
            link stays stuck at its content width and the task title truncates
            instead. shrink-[9999] makes the name truncate before the task.
          */}
          <InternalLink
            className="flex min-w-0 shrink-[9999] items-center text-muted-foreground"
            openInCurrentTab
            params={{ id: projectId }}
            to="/projects/$id"
          >
            <span className="min-w-0 truncate">{project.name}</span>
          </InternalLink>
          {/*
            Separator stays with the task title — a standalone shrink-0 element
            so it remains visible even after the project name fully collapses.
          */}
          <span className="shrink-0 text-gray-400">/</span>
        </>
      )}
      {rename.isEditing ? (
        // Only the title becomes a field. The project it hangs off stays where
        // it was, rather than the whole crumb sliding left for the length of
        // the rename; if the field wants the room, the project name truncates
        // ahead of it and, at its narrowest, leaves the icon alone.
        //
        // The field opens at the width of the title it replaced, so clicking a
        // short title doesn't throw a wide box across the header. offsetWidth,
        // not a rect: the app scales with CSS zoom, and only layout px can be
        // handed straight back to a style width.
        //
        // select-text because the row's own select-none reaches into the field
        // and would leave a rename you can't drag a selection through.
        //
        // Its focus ring is inset, like the toolbar buttons beside it: the row
        // is exactly as tall as the input's own line, so an outward ring would
        // sit on whatever shares the row rather than around the field.
        <div
          className="flex h-8 max-w-96 min-w-0 shrink items-center px-1 select-text"
          style={{ width: fieldWidth ?? RENAME_FIELD_DEFAULT_WIDTH }}
        >
          <Input
            className="h-7 text-sm focus-visible:-outline-offset-3"
            {...rename.inputProps}
          />
        </div>
      ) : (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            {/*
              The hover surface is pulled back out by its own padding on both
              sides, so the gaps around it stay measured from the text rather
              than from the fill: 8px to the overflow button, and behind a
              project, the same 4px off the separator that the project name has
              on its other side. The cost is that the idle fill reaches 2px
              into the separator's box, which its side bearing absorbs. Only the
              task title takes the surface: the project crumbs beside it are
              links to somewhere else, not a rename.
            */}
            <button
              className="-mx-1.5 flex h-8 min-w-0 items-center truncate rounded-lg px-1.5 text-left outline-none hover:bg-muted focus-visible:outline-[3px] focus-visible:-outline-offset-3 focus-visible:outline-ring/50 focus-visible:[outline-style:solid]"
              onClick={() => {
                setFieldWidth(
                  titleRef.current
                    ? Math.max(
                        RENAME_FIELD_MIN_WIDTH,
                        titleRef.current.offsetWidth + RENAME_FIELD_PADDING,
                      )
                    : undefined,
                );
                rename.start();
              }}
              ref={titleRef}
              type="button"
            >
              <span className="min-w-0 flex-1 truncate">{task.title}</span>
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-56">
            {renderMenuItems(contextMenuComponents)}
          </ContextMenuContent>
        </ContextMenu>
      )}
    </div>
  );
}
