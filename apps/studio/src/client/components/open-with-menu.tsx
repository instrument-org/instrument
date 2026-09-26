import { type ViewerFile } from "@/client/atoms/task-file-viewer";
import { useFileOpenCandidates } from "@/client/hooks/use-file-open-target";
import { useOpenFileWith } from "@/client/hooks/use-open-file";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { type ReactElement } from "react";

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
import { MenuScrollArea } from "./ui/menu-scroll-area";
import { Spinner } from "./ui/spinner";

type FileRef = Pick<ViewerFile, "hostPath">;

/**
 * The "Open in" submenu: every app that can open the file, the one the system
 * would use first. Where a menu also offers the default on its own row, it
 * asks for the others alone, under "Open with". Candidates are fetched
 * lazily: the query only runs once the submenu content mounts (opens).
 */
export function OpenInMenu({
  file,
  menuComponents,
  onlyAlternatives = false,
}: {
  file: FileRef;
  menuComponents: MenuComponents;
  onlyAlternatives?: boolean;
}) {
  const { Sub, SubContent, SubTrigger } = menuComponents;

  return (
    <Sub>
      <SubTrigger>
        <AppWindowIcon className="size-4" />
        <span>{onlyAlternatives ? "Open with" : "Open in"}</span>
      </SubTrigger>
      <SubContent className="flex min-w-52 flex-col p-0">
        <MenuScrollArea className="max-h-80">
          <OpenWithCandidates
            file={file}
            menuComponents={menuComponents}
            omitDefault={onlyAlternatives}
          />
        </MenuScrollArea>
      </SubContent>
    </Sub>
  );
}

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
        <MenuScrollArea className="max-h-80">
          <OpenWithCandidates
            file={file}
            menuComponents={dropdownMenuComponents}
            omitDefault
          />
        </MenuScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
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
  const { apps, isError, isPending } = useFileOpenCandidates(file, {
    enabled: true,
  });
  const openWith = useOpenFileWith();
  // Beside a control that already launches the default app, only the
  // alternatives are listed; otherwise the default leads. Match on the flag
  // rather than on position: the resolver orders by Launch Services
  // preference, which is not a guarantee.
  const candidates = omitDefault
    ? apps.filter((candidate) => !candidate.isDefault)
    : [
        ...apps.filter((candidate) => candidate.isDefault),
        ...apps.filter((candidate) => !candidate.isDefault),
      ];

  if (isPending) {
    return (
      <Item disabled>
        <Spinner className="size-4" delay={0} />
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
