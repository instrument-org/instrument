import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { useOpenTaskFileWith } from "@/client/hooks/use-open-task-file";
import { useTaskFileOpenCandidates } from "@/client/hooks/use-task-file-open-target";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { type ReactElement, type ReactNode } from "react";

import { IconWithFallback } from "./icon-with-fallback";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  dropdownMenuComponents,
  type MenuComponents,
} from "./ui/menu-components";
import { Spinner } from "./ui/spinner";

type FileRef = Pick<TaskFileViewerFile, "filePath" | "taskId">;

export function OpenWithDropdown({
  children,
  file,
}: {
  children: ReactElement;
  file: FileRef;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="flex min-w-52 flex-col p-0">
        <OpenWithScroller>
          <OpenWithCandidates
            file={file}
            menuComponents={dropdownMenuComponents}
            omitDefault
          />
        </OpenWithScroller>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// "Open with" submenu listing every app that can open the file. Candidates are
// fetched lazily: the query only runs once the submenu content mounts (opens).
export function OpenWithMenu({
  file,
  menuComponents,
}: {
  file: FileRef;
  menuComponents: MenuComponents;
}) {
  const { Sub, SubContent, SubTrigger } = menuComponents;

  return (
    <Sub>
      <SubTrigger>
        <AppWindowIcon className="size-4" />
        <span>Open with</span>
      </SubTrigger>
      <SubContent className="flex min-w-52 flex-col p-0">
        <OpenWithScroller>
          <OpenWithCandidates file={file} menuComponents={menuComponents} />
        </OpenWithScroller>
      </SubContent>
    </Sub>
  );
}

function OpenWithCandidates({
  file,
  menuComponents,
  omitDefault = false,
}: {
  file: FileRef;
  menuComponents: MenuComponents;
  omitDefault?: boolean;
}) {
  const { Item } = menuComponents;
  const { apps, isError, isPending } = useTaskFileOpenCandidates(file, {
    enabled: true,
  });
  const openWith = useOpenTaskFileWith();
  // The split button already launches the default app, so its menu lists only
  // the alternatives. Match on the flag rather than on position: the resolver
  // orders by Launch Services preference, which is not a guarantee.
  const candidates = omitDefault
    ? apps.filter((candidate) => !candidate.isDefault)
    : apps;

  if (isPending) {
    return (
      <Item disabled>
        <Spinner className="size-4" />
        <span>Loading apps…</span>
      </Item>
    );
  }

  if (isError) {
    return (
      <Item disabled>
        <span>Couldn&apos;t load apps</span>
      </Item>
    );
  }

  if (candidates.length === 0) {
    return (
      <Item disabled>
        <span>No apps available</span>
      </Item>
    );
  }

  return (
    <>
      {candidates.map((candidate) => (
        <Item
          key={candidate.appPath}
          onClick={() => {
            openWith(file, candidate.appPath);
          }}
        >
          <IconWithFallback
            className="size-5"
            fallback={<AppWindowIcon className="size-5" />}
            src={candidate.iconUrl}
          />
          <span className="truncate">{candidate.appName}</span>
        </Item>
      ))}
    </>
  );
}

/**
 * The apps scroll inside the menu rather than the menu scrolling itself, so the
 * list can carry the same edge fade every other scroller in the app has.
 *
 * `scroll-fade-y` is a mask, and a mask takes everything the element paints.
 * Worn by the menu -- which is the scroller by default, and also the thing
 * painting `bg-popover` and its shadow -- it would dissolve the menu's own
 * surface at the bottom edge and show the window through it. One layer in, with
 * nothing of its own to paint, it fades only the rows, onto the popover behind
 * them; the color question answers itself.
 *
 * The menu stays a flex column so this shrinks under whatever cap the menu has
 * rather than overflowing it into a second scrollbar.
 */
function OpenWithScroller({ children }: { children: ReactNode }) {
  return (
    <div className="max-h-80 min-h-0 overflow-y-auto scroll-fade-y p-1">
      {children}
    </div>
  );
}
