import { openCreateProject } from "@/client/atoms/project-modal";
import {
  type ComposerSkill,
  SkillMenuRow,
} from "@/client/components/skill-menu-row";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { useComposerMenuPlacement } from "@/client/hooks/use-composer-menu-placement";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type ProjectId } from "@instrument-org/workspace/client";
import { type Icon } from "@phosphor-icons/react";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";

/**
 * Something the composer can be given, offered by name in the menu that adds
 * it. The same list answers the plus button and a typed slash, so an entry is
 * described once and its `onSelect` is what differs per surface.
 */
export interface ComposerAction {
  icon: Icon;
  id: string;
  /**
   * For an entry that turns the menu into something else rather than acting and
   * leaving. Ignored by surfaces that were never a menu to begin with.
   */
  keepMenuOpen?: boolean;
  label: string;
  onSelect: () => void;
}

/**
 * Which face the menu is wearing, or `null` for closed. Picking a project
 * replaces the menu rather than opening a second one beside it, so the caller
 * owns this: a slash-typed "Work in a project" opens the menu already turned.
 */
export type ComposerMenuView = "projects" | "root";

/**
 * The plus button and everything it offers: what the composer can be given,
 * then the skills that can be run.
 *
 * Sized and placed to the composer rather than to its own trigger. The skills
 * read as a line of name, description and source -- the width a typed slash
 * gives them -- and the prompt this is adding to stays in view beside the menu
 * rather than under it.
 */
export function ComposerAddMenu({
  actions,
  bounds,
  disabled,
  onReturnFocus,
  onSelectProject,
  onSelectSkill,
  onViewChange,
  projectId,
  skills,
  view,
}: {
  actions: ComposerAction[];
  /** The composer box this hangs off, rather than overlays. */
  bounds: HTMLElement | null;
  disabled?: boolean;
  /** Puts the caret back in the prompt, once something has been chosen here. */
  onReturnFocus: () => void;
  /** Omitted where a task's project is not the composer's to choose. */
  onSelectProject?: (projectId: null | ProjectId) => void;
  onSelectSkill: (skill: ComposerSkill) => void;
  onViewChange: (view: ComposerMenuView | null) => void;
  projectId?: null | ProjectId;
  skills: ComposerSkill[];
  view: ComposerMenuView | null;
}) {
  // Whether this closed because something was chosen, which is the only case
  // where the menu owns where focus lands next. Dismissing it is the user
  // going somewhere themselves, and Radix's own handling is right for that.
  const chose = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { alignOffset, side, sideOffset, width } = useComposerMenuPlacement({
    anchorRef: triggerRef,
    bounds,
    open: view !== null,
  });

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        onViewChange(open ? "root" : null);
      }}
      open={view !== null}
    >
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Add to this prompt"
          // A filled rest state rather than a ghost one, so the way in is
          // visible before it is pointed at. Its hover has to darken in one
          // theme and lighten in the other, which no single token does.
          className="size-8 bg-muted p-0 text-foreground/60 not-disabled:hover:bg-black/10 dark:not-disabled:hover:bg-white/15"
          disabled={disabled}
          ref={triggerRef}
          size="sm"
          variant="ghost"
        >
          <PlusIcon className="size-5" weight="regular" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        alignOffset={alignOffset}
        avoidCollisions={false}
        // Room for the first group and a few skills, and no more: left to the
        // available height a full skills list becomes a column as tall as the
        // window. The same cap the slash menu keeps, over the same entries.
        //
        // The corner is the composer's own rather than the menu radius every
        // other dropdown wears, since this one is read against the edge of the
        // box it hangs off.
        className="max-h-[min(18rem,calc(var(--radix-dropdown-menu-content-available-height)/var(--content-zoom)))] rounded-[20px]"
        // Everything on offer here is something the prompt is about to carry,
        // so the caret goes back to the prompt rather than to the button that
        // opened this -- including out of the project picker, which is a
        // second menu deep and would otherwise leave the caret nowhere.
        onCloseAutoFocus={(event) => {
          if (!chose.current) {
            return;
          }
          chose.current = false;
          event.preventDefault();
          onReturnFocus();
        }}
        side={side}
        sideOffset={sideOffset}
        style={{ width }}
      >
        {view === "projects" && onSelectProject ? (
          <ProjectItems
            onSelect={(id) => {
              chose.current = true;
              onSelectProject(id);
              onViewChange(null);
            }}
            projectId={projectId ?? null}
          />
        ) : (
          <>
            {actions.map((action) => (
              <DropdownMenuItem
                key={action.id}
                onSelect={(event) => {
                  if (action.keepMenuOpen) {
                    event.preventDefault();
                  } else {
                    chose.current = true;
                  }
                  action.onSelect();
                }}
              >
                <action.icon className="size-4" />
                {action.label}
              </DropdownMenuItem>
            ))}
            {skills.length > 0 && (
              <MenuGroupHeader keyHint="/" label="Skills" />
            )}
            {skills.map((skill) => (
              <DropdownMenuItem
                key={skill.id}
                onSelect={() => {
                  chose.current = true;
                  onSelectSkill(skill);
                }}
              >
                <SkillMenuRow
                  match={{
                    descriptionRanges: null,
                    nameRanges: null,
                    skill,
                  }}
                />
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Names a run of items, and says which key reaches them without the menu. The
 * rule above it is what separates the groups, so the first one carries none.
 */
export function MenuGroupHeader({
  className,
  keyHint,
  label,
}: {
  className?: string;
  keyHint?: string;
  label: string;
}) {
  return (
    <div
      className={cn(
        "-mx-1 mt-1 flex items-center gap-2 border-t border-black/5 px-4 pt-2 pb-1 text-xs text-muted-foreground dark:border-white/5",
        className,
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {keyHint && (
        <span className="flex size-5 shrink-0 items-center justify-center rounded bg-muted font-semibold">
          {keyHint}
        </span>
      )}
    </div>
  );
}

// Cancelling is an entry rather than a way out of the menu, because arriving
// here is a choice the user may want to take back without also losing the menu
// they made it in.
function ProjectItems({
  onSelect,
  projectId,
}: {
  onSelect: (projectId: null | ProjectId) => void;
  projectId: null | ProjectId;
}) {
  const { data: projects } = useQuery(
    rpcClient.workspace.project.live.list.experimental_liveOptions(),
  );

  return (
    <>
      <DropdownMenuCheckboxItem
        checked={projectId === null}
        className="data-[state=checked]:text-foreground"
        onSelect={() => {
          onSelect(null);
        }}
      >
        Don&apos;t work in a project
      </DropdownMenuCheckboxItem>
      {projects?.map((project) => (
        <DropdownMenuCheckboxItem
          checked={project.id === projectId}
          className="data-[state=checked]:text-foreground"
          key={project.id}
          onSelect={() => {
            onSelect(project.id);
          }}
        >
          <span className="min-w-0 flex-1 truncate">{project.name}</span>
        </DropdownMenuCheckboxItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={() => {
          openCreateProject();
        }}
      >
        <PlusIcon className="size-4" />
        New project
      </DropdownMenuItem>
    </>
  );
}
