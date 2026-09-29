import { type ViewerFile } from "@/client/atoms/task-file-viewer";
import { useFileOpenCandidates } from "@/client/hooks/use-file-open-target";
import { useOpenFileWith } from "@/client/hooks/use-open-file";
import { hasFilesView, revealInFileManager } from "@/client/lib/show-in-files";
import { getFileManagerName } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { useQuery } from "@tanstack/react-query";
import { type ReactElement } from "react";

import { IconWithFallback } from "./icon-with-fallback";
import { RevealInFolderIcon } from "./icons/reveal-in-folder";
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
        <FileManagerFooter file={file} menuComponents={menuComponents} />
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
        <FileManagerFooter file={file} menuComponents={dropdownMenuComponents} />
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

/**
 * Where the window shows a file in Files of its own, the system's file manager
 * is one more place the file can go, and the one every file has. It sits under
 * the apps rather than among them, held still while a long list scrolls, so
 * the app the file opens in stays the first row.
 */
function FileManagerFooter({
  file,
  menuComponents,
}: {
  file: FileRef;
  menuComponents: MenuComponents;
}) {
  if (!hasFilesView()) {
    return null;
  }
  const { Separator } = menuComponents;
  return (
    <div className="shrink-0 px-1 pb-1">
      <Separator className="mt-0" />
      <FileManagerItem file={file} menuComponents={menuComponents} />
    </div>
  );
}

function FileManagerItem({
  file,
  menuComponents,
}: {
  file: FileRef;
  menuComponents: MenuComponents;
}) {
  const { Item } = menuComponents;
  const { data } = useQuery(
    rpcClient.utils.fileManagerIcon.queryOptions({
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      staleTime: Number.POSITIVE_INFINITY,
    }),
  );
  return (
    <Item
      onClick={() => {
        void revealInFileManager(file.hostPath);
      }}
    >
      <IconWithFallback
        className="size-5"
        fallback={<RevealInFolderIcon className="size-5" />}
        src={data?.iconUrl ?? null}
      />
      <span className="truncate">{getFileManagerName()}</span>
    </Item>
  );
}
