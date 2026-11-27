import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { useAtom } from "jotai";
import {
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { byNewestChat, type Project } from "./chats";
import { projectsOpenAtom } from "./chat-list-view";
import { FadeTitle } from "./fade-title";
import { projectColor } from "./project-colors";
import { ProjectMark } from "./project-mark";
import { ProjectActionsButton, ProjectContextMenu } from "./project-menu";
import { projectTint } from "./project-tint";

/**
 * How many columns of tiles the projects take in a section this wide, in
 * layout px: two under 260, three under 400, four past that. Fewer projects
 * than that share one row, and four at three across go two by two, since
 * three and one would leave a lone wide tile under three narrow ones.
 */
export function projectColumns(width: number, count: number) {
  const most = width < 260 ? 2 : width < 400 ? 3 : 4;
  if (count <= most) {
    return Math.max(count, 1);
  }
  return count === 4 && most === 3 ? 2 : most;
}

/**
 * The projects at the top of the inbox, a tile each in its tint: its mark
 * over its name in its ink. The project with the newest chat comes first,
 * columns come from the section's width (`projectColumns`), and past two
 * rows the last tile says how many more there are, which opens them all with
 * Show less at their end. The heading's caret folds the whole section, kept
 * for every window on this computer, and its + makes a project.
 */
export function ProjectsSection({
  chats,
  onChoose,
  onDetails,
  onNew,
  projects,
}: {
  chats: { archived: boolean; lastUserMessageAt: number; project?: string }[];
  onChoose: (project: Project) => void;
  onDetails: (project: Project) => void;
  onNew: () => void;
  projects: Project[];
}) {
  const [isOpen, setOpen] = useAtom(projectsOpenAtom);
  const [isAllShown, setAllShown] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const width = useLayoutWidth(sectionRef);
  const ordered = byNewestChat(
    projects.filter((project) => !project.retired),
    chats,
  );
  const columns = projectColumns(width, ordered.length);
  const room = columns * 2;
  const isFolding = ordered.length > room;
  // Past two rows, the last cell is the More tile while the rest are folded,
  // and the first of the rest once they are open, so the two grids read as one.
  const shown = isFolding ? ordered.slice(0, room - 1) : ordered;
  const [firstFolded, ...folded] = isFolding ? ordered.slice(room - 1) : [];
  const grid = cn(
    "grid gap-1.5",
    ["grid-cols-1", "grid-cols-2", "grid-cols-3", "grid-cols-4"][columns - 1],
  );
  const tile = (project: Project) => (
    <ProjectContextMenu
      key={project.id}
      onDetails={onDetails}
      project={project}
    >
      <div
        className="group/project relative h-14 min-w-0 rounded-[10px] bg-(--project-tint-surface)/45 project-tint hover:bg-(--project-tint-surface)/70 has-focus-visible:bg-(--project-tint-surface)/70 dark:bg-(--project-tint-surface)/20 dark:hover:bg-(--project-tint-surface)/35"
        style={projectTint(projectColor(project))}
      >
        <button
          className="flex size-full min-w-0 flex-col justify-center gap-1 px-2.5 text-left text-(--project-tint-ink) outline-hidden"
          onClick={() => {
            onChoose(project);
          }}
          type="button"
        >
          <ProjectMark className="size-4 text-[15px]" plain project={project} />
          <FadeTitle className="block w-full text-xs leading-4 font-medium">
            {project.name}
          </FadeTitle>
        </button>
        <ProjectActionsButton
          className="absolute top-1.5 right-1.5 bg-background/70 group-hover/project:opacity-100 dark:bg-foreground/10"
          onDetails={onDetails}
          project={project}
        />
      </div>
    </ProjectContextMenu>
  );
  const moreTile = (label: string) => (
    <button
      className="flex h-14 min-w-0 flex-col justify-center gap-1 rounded-[10px] bg-foreground/4 px-2.5 text-left text-xs leading-4 font-medium text-muted-foreground hover:bg-foreground/6 hover:text-foreground"
      onClick={() => {
        setAllShown(!isAllShown);
      }}
      type="button"
    >
      <DotsThreeIcon className="size-4" weight="bold" />
      {label}
    </button>
  );
  return (
    <section aria-label="Projects" className="pb-1" ref={sectionRef}>
      <div
        className="group/heading flex h-8 items-center justify-between pr-1 pl-2.5"
        onContextMenu={(event) => {
          event.preventDefault();
          void rpcClient.utils.showContextMenu
            .call({ items: [{ id: "new", label: "New Project…" }] })
            .then((picked) => {
              if (picked.id === "new") {
                onNew();
              }
            });
        }}
      >
        <button
          aria-expanded={isOpen}
          className="flex h-6 items-center gap-1 rounded-md pr-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={() => {
            setOpen(!isOpen);
          }}
          type="button"
        >
          Projects
          <CaretDownIcon
            className={cn(
              "size-3 transition-transform motion-reduce:transition-none",
              !isOpen && "-rotate-90",
            )}
            weight="bold"
          />
        </button>
        <button
          aria-label="New project"
          className="grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 group-hover/heading:opacity-100 hover:bg-foreground/5 hover:text-foreground focus-visible:opacity-100"
          onClick={onNew}
          title="New project"
          type="button"
        >
          <PlusIcon className="size-3.5" weight="bold" />
        </button>
      </div>
      <Unfold isOpen={isOpen}>
        <div className={grid}>
          {shown.map(tile)}
          {firstFolded &&
            (isAllShown
              ? tile(firstFolded)
              : moreTile(`${ordered.length - shown.length} more`))}
        </div>
        {isFolding && (
          <Unfold isOpen={isAllShown}>
            {/* Its own gap above, so a closed fold adds none to the grid. */}
            <div className={cn(grid, "pt-1.5")}>
              {folded.map(tile)}
              {moreTile("Show less")}
            </div>
          </Unfold>
        )}
      </Unfold>
    </section>
  );
}

/**
 * An element's width in layout px, which the window's zoom leaves alone, as
 * it is laid out and whenever that changes; 0 until it is first measured.
 */
function useLayoutWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    // Its first call measures the element as it mounts, before the frame is
    // painted.
    const observer = new ResizeObserver(() => {
      setWidth(element.clientWidth);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return width;
}

/**
 * Tiles that open and close by growing to their height and shrinking back,
 * kept drawn while closed so the closing can play; closed, they are out of
 * reach of the pointer, the keyboard and a screen reader.
 */
function Unfold({
  children,
  className,
  isOpen,
}: {
  children: ReactNode;
  className?: string;
  isOpen: boolean;
}) {
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
        isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr] opacity-0",
        className,
      )}
    >
      <div className="min-h-0 overflow-hidden" inert={!isOpen}>
        {children}
      </div>
    </div>
  );
}
