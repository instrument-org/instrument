import {
  type FileSystemItem,
  type FileSystemSortKey,
  type FileSystemSortState,
} from "@/client/components/extend/file-system";
import { TOOLBAR_ICON_BUTTON_CLASSNAME } from "@/client/components/toolbar-control";
import { listingKeys } from "@/client/components/extend/file-system-keys";
import { NewTabIcon } from "@/client/components/icons/new-tab-icon";
import { RevealInFolderIcon } from "@/client/components/icons/reveal-in-folder";
import { IconWithFallback } from "@/client/components/icon-with-fallback";
import { OpenTargetIcon } from "@/client/components/open-target-icon";
import { OpenInMenu } from "@/client/components/open-with-menu";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import {
  ContextMenuContent,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/client/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  contextMenuComponents,
  dropdownMenuComponents,
  type MenuComponents,
} from "@/client/components/ui/menu-components";
import { useFileOpenTarget } from "@/client/hooks/use-file-open-target";
import { useOpenFile } from "@/client/hooks/use-open-file";
import { currentOs, isMacOS, osConventions } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { SquareSplitHorizontalIcon } from "@phosphor-icons/react/SquareSplitHorizontal";
import { StackIcon } from "@phosphor-icons/react/Stack";
import { StarIcon } from "@phosphor-icons/react/Star";
import { ClipboardIcon } from "@phosphor-icons/react/Clipboard";
import { ClipboardTextIcon } from "@phosphor-icons/react/ClipboardText";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { EyeIcon } from "@phosphor-icons/react/Eye";
import { FolderOpenIcon } from "@phosphor-icons/react/FolderOpen";
import { FolderPlusIcon } from "@phosphor-icons/react/FolderPlus";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { MinusCircleIcon } from "@phosphor-icons/react/MinusCircle";
import { PlusCircleIcon } from "@phosphor-icons/react/PlusCircle";
import { ScissorsIcon } from "@phosphor-icons/react/Scissors";
import { SortAscendingIcon } from "@phosphor-icons/react/SortAscending";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { InfoIcon } from "@phosphor-icons/react/Info";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";

import { fileTabOf, hostPathOfItem } from "./finder-actions";
/**
 * The orders the folder's menu offers, in the Finder's words, each opening in
 * the direction the toolbar's sort opens it in. The recents add the order
 * they were opened in, which is theirs alone.
 */
export const SORT_BY: {
  direction: "asc" | "desc";
  key: FileSystemSortKey;
  label: string;
  recentsOnly?: boolean;
}[] = [
  {
    direction: "desc",
    key: "openedAt",
    label: "Date Last Opened",
    recentsOnly: true,
  },
  { direction: "asc", key: "name", label: "Name" },
  { direction: "asc", key: "kind", label: "Kind" },
  { direction: "desc", key: "updatedAt", label: "Date Modified" },
  { direction: "desc", key: "createdAt", label: "Date Created" },
  { direction: "desc", key: "size", label: "Size" },
];

/** What a row's menus do, by the menu's own components; see `FolderMenu`. */
export type FolderMenuActions = {
  /**
   * Why a folder among what the menu acts on stays where it is
   * (`keptInPlaceOf`): Move to Trash, Rename and Duplicate are there, and
   * off, and the reason is said at the menu's foot.
   */
  kept?: string | undefined;
  onCopy: () => void;
  onCopyPath: () => void;
  onCut: () => void;
  onDuplicate: () => void;
  /** Keeps it as a bookmark; left out for several. */
  onAddToBookmarks?: (() => void) | undefined;
  /** Left out where nothing shows a file's info, or the menu is on the folder's empty space. */
  onInfo: (() => void) | undefined;
  /** Left out where there is no folder to make one in. */
  onNewFolder: (() => void) | undefined;
  /** What a double-click does: a folder is gone into, a file opened here. */
  onOpen: () => void;
  /** A folder in a tab of its own, which is the Finder's first answer for one. */
  onOpenInNewTab: () => void;
  /** What it is in a window of its own, several as tabs of one. */
  onOpenInNewWindow: () => void;
  /** The first tab of a new tab group; left out for several. */
  onOpenInNewGroup?: (() => void) | undefined;
  /** On the other side of this tab's group, made where it has one side; left out for several. */
  onOpenInSplit?: (() => void) | undefined;
  /** Left out where nothing shows a file over the page. */
  onQuickLook: (() => void) | undefined;
  /** Left out where there is no field to type a name in. */
  onRename?: () => void;
  onReveal: () => void;
  /** A package (an app) gone into as the folder it is; left out for anything else. */
  onShowPackageContents?: (() => void) | undefined;
  onTrash: () => void;
  /**
   * Where opening leaves this window: an app that runs, or a file the
   * computer's own app for it opens. Left out for what opens here.
   */
  opensOutside?: "app" | "file" | undefined;
  /** Adding a folder to Favorites, or removing it; left out for anything but one folder. */
  favorite?: { isFavorite: boolean; onToggle: () => void } | undefined;
  /** Files on the clipboard, copied into the folder on screen, by its name; left out where there is no folder. */
  paste?: { into: string; onMove: () => void; onPaste: () => void } | undefined;
  /**
   * What the menu acts on, when it is several selected: what names one thing
   * (Rename, Copy Path, Quick Look, Reveal) is left off, and Open With lists
   * the apps every one of them opens in.
   */
  group?: FileSystemItem[] | undefined;
};

/**
 * What can be done to the thing under the pointer, or to the folder itself
 * where there is nothing under it, in the order the Finder's own menu puts
 * them: opening first, the Trash apart, then what changes the thing, then
 * where it is. Handing a file to another program is one row, and a submenu
 * wherever the Mac can name the apps that read it, a folder's included: naming an app on the row
 * itself makes the menu as wide as whatever app that file happens to belong
 * to.
 */
export function FolderMenu({
  isRecents = false,
  onClosed,
  onSortKey,
  sort,
  ...props
}: FolderMenuActions & {
  isRecents?: boolean;
  item: FileSystemItem | undefined;
  /** The menu gone, and the keyboard with it. */
  onClosed?: () => void;
  /** With `sort`, the folder's own orders, offered on its empty space. */
  onSortKey?: (key: FileSystemSortKey) => void;
  sort?: FileSystemSortState;
}) {
  return (
    <ContextMenuContent
      className="min-w-48"
      // Closing hands the keyboard back to what the menu came up over, which
      // lands after a chosen action has already put it somewhere of its own:
      // in the name field a rename just opened, or on the browser. Every item
      // here says where the keyboard goes, so the menu says nothing.
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        onClosed?.();
      }}
    >
      <FolderMenuItems
        {...props}
        emptyTail={
          onSortKey && sort ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <SortAscendingIcon className="size-4" />
                <span>Sort By</span>
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="min-w-44">
                <ContextMenuRadioGroup
                  onValueChange={(key) => {
                    const option = SORT_BY.find((entry) => entry.key === key);
                    if (option) {
                      onSortKey(option.key);
                    }
                  }}
                  value={sort.key}
                >
                  {SORT_BY.filter(
                    (option) => isRecents || !option.recentsOnly,
                  ).map((option) => (
                    <ContextMenuRadioItem key={option.key} value={option.key}>
                      {option.label}
                    </ContextMenuRadioItem>
                  ))}
                </ContextMenuRadioGroup>
              </ContextMenuSubContent>
            </ContextMenuSub>
          ) : null
        }
        menuComponents={contextMenuComponents}
      />
    </ContextMenuContent>
  );
}

/**
 * The toolbar's More menu, the Finder's ⋯: the folder menu for what is
 * selected, or for the folder where nothing is, with New Folder at its head
 * either way, since a list with no empty space to right-click still needs a
 * way to make one.
 */
export function FolderOverflowMenu({
  folded,
  onClosed,
  ...props
}: FolderMenuActions & {
  /** The folder's views and sort, at the menu's head, where the toolbar has no room for them. */
  folded?: ReactNode;
  item: FileSystemItem | undefined;
  onClosed: () => void;
}) {
  // The recents with nothing selected have nothing to make or paste, so the
  // menu would open empty.
  if (!folded && !props.item && !props.onNewFolder && !props.paste) {
    return null;
  }
  return (
    <DropdownMenu>
      <ToolbarTooltip label="More">
        <DropdownMenuTrigger asChild>
          <button
            aria-label="More"
            className={TOOLBAR_ICON_BUTTON_CLASSNAME}
            type="button"
          >
            <DotsThreeIcon className="size-4" weight="bold" />
          </button>
        </DropdownMenuTrigger>
      </ToolbarTooltip>
      <DropdownMenuContent
        align="end"
        className="min-w-48"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onClosed();
        }}
      >
        {folded}
        <FolderMenuItems
          {...props}
          menuComponents={dropdownMenuComponents}
          newFolderFirst
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The folder menu's rows, drawn by whichever menu holds them. */
export function FolderMenuItems({
  emptyTail,
  item,
  kept,
  menuComponents,
  newFolderFirst = false,
  onAddToBookmarks,
  onCopy,
  onCopyPath,
  onCut,
  onDuplicate,
  onInfo,
  onNewFolder,
  onOpen,
  onOpenInNewGroup,
  onOpenInNewTab,
  onOpenInNewWindow,
  onOpenInSplit,
  onQuickLook,
  onRename,
  onReveal,
  onShowPackageContents,
  onTrash,
  opensOutside,
  paste,
  favorite,
  group,
}: FolderMenuActions & {
  /** What the menu adds on the folder's empty space, after New Folder. */
  emptyTail?: ReactNode;
  item: FileSystemItem | undefined;
  menuComponents: MenuComponents;
  /** New Folder at the head whatever the menu is about, the way the Finder's ⋯ has it. */
  newFolderFirst?: boolean;
}) {
  const { Item, Separator, Shortcut } = menuComponents;
  const keys = listingKeys(currentOs());
  const tab = item?.kind === "file" ? fileTabOf(item) : undefined;
  const several = group?.length;
  const file = tab && !several ? { hostPath: tab.hostPath } : undefined;
  const openFile = useOpenFile();
  const { openLabel, opensUnnamed, showOpen } = useFileOpenTarget(file);
  // Paste is offered only while the clipboard has files, read as the menu
  // opens on the folder's empty space.
  const clipboard = useQuery({
    ...rpcClient.files.clipboardHasFiles.queryOptions(),
    enabled: !item && paste !== undefined,
    gcTime: 0,
    staleTime: 0,
  });
  const canPaste = clipboard.data?.hasFiles === true;
  const itemHostPath = hostPathOfItem(item);
  // A file the system opens with a helper not worth naming has one way to
  // open, and the Open above already takes it.
  const openIn =
    isMacOS() && itemHostPath && !opensUnnamed
      ? { hostPath: itemHostPath }
      : undefined;
  // The rest of the selection, opened along with the row in the app picked.
  const openInOthers = (group ?? []).flatMap((each) => {
    const hostPath = hostPathOfItem(each);
    return hostPath && hostPath !== itemHostPath ? [{ hostPath }] : [];
  });
  return (
    <>
      {newFolderFirst && onNewFolder ? (
        <>
          <Item onClick={onNewFolder}>
            <FolderPlusIcon className="size-4" />
            <span>New Folder</span>
            <Shortcut>{keys.newFolder}</Shortcut>
          </Item>
          {item || (canPaste && paste) || emptyTail ? <Separator /> : null}
        </>
      ) : null}
      {item ? (
        <>
          {/* Open is drawn as where the file goes: an app runs, and a file
              with no viewer here comes up in the app the computer picks for
              it, so neither looks like it opens in this window. */}
          {(item.kind === "file" || several) && (
            <Item onClick={onOpen}>
              {!opensOutside ? (
                <FolderOpenIcon className="size-4" />
              ) : opensOutside === "app" && item.kind === "file" ? (
                <IconWithFallback
                  className="size-4"
                  fallback={<AppWindowIcon className="size-4" />}
                  src={item.previewImageUrl ?? null}
                />
              ) : file ? (
                <OpenTargetIcon className="size-4" file={file} />
              ) : (
                <AppWindowIcon className="size-4" />
              )}
              <span>{opensOutside === "file" ? openLabel : "Open"}</span>
              {/* The key opens the one row the keyboard is on. */}
              {several ? null : <Shortcut>{keys.open}</Shortcut>}
            </Item>
          )}
          {onOpenInSplit ? (
            <Item onClick={onOpenInSplit}>
              <SquareSplitHorizontalIcon className="size-4" />
              <span>Open in Split</span>
            </Item>
          ) : null}
          <Item onClick={onOpenInNewTab}>
            <NewTabIcon className="size-4" />
            <span>{several ? "Open in New Tabs" : "Open in New Tab"}</span>
          </Item>
          {onOpenInNewGroup ? (
            <Item onClick={onOpenInNewGroup}>
              <StackIcon className="size-4" />
              <span>Open in New Tab Group</span>
            </Item>
          ) : null}
          <Item onClick={onOpenInNewWindow}>
            <AppWindowIcon className="size-4" />
            <span>Open in New Window</span>
          </Item>
          {onShowPackageContents && !several ? (
            <Item onClick={onShowPackageContents}>
              <FolderOpenIcon className="size-4" />
              <span>Show Package Contents</span>
            </Item>
          ) : null}
          {/* The apps are listed where the Mac can be asked for them, and the
                submenu asks only once it is opened, so the row is there from
                the first frame rather than arriving under the pointer once a
                lookup has answered. Elsewhere the one row hands the file to
                whichever program the system has chosen for it. */}
          {openIn ? (
            <OpenInMenu
              file={openIn}
              menuComponents={menuComponents}
              onlyAlternatives={opensOutside === "file"}
              others={openInOthers}
            />
          ) : file && showOpen && !opensUnnamed && !opensOutside ? (
            <Item
              onClick={() => {
                openFile(file);
              }}
            >
              <OpenTargetIcon className="size-4" file={file} />
              <span>{openLabel}</span>
            </Item>
          ) : null}
          <Separator />
          <Item
            disabled={kept !== undefined}
            onClick={onTrash}
            variant="destructive"
          >
            <TrashIcon className="size-4" />
            <span>Move to {osConventions().trash}</span>
            <Shortcut>{keys.trash}</Shortcut>
          </Item>
          <Separator />
          {onRename ? (
            <Item disabled={kept !== undefined} onClick={onRename}>
              <PencilSimpleIcon className="size-4" />
              <span>Rename</span>
              <Shortcut>{keys.rename}</Shortcut>
            </Item>
          ) : null}
          {keys.cut ? (
            <Item disabled={kept !== undefined} onClick={onCut}>
              <ScissorsIcon className="size-4" />
              <span>Cut</span>
              <Shortcut>{keys.cut}</Shortcut>
            </Item>
          ) : null}
          <Item onClick={onCopy}>
            <CopyIcon className="size-4" />
            <span>Copy</span>
            <Shortcut>{keys.copy}</Shortcut>
          </Item>
          <Item disabled={kept !== undefined} onClick={onDuplicate}>
            <CopyIcon className="size-4" />
            <span>Duplicate</span>
            {keys.duplicate ? <Shortcut>{keys.duplicate}</Shortcut> : null}
          </Item>
          {!several && onQuickLook ? (
            <Item onClick={onQuickLook}>
              <EyeIcon className="size-4" />
              <span>Preview</span>
              <Shortcut>{keys.preview}</Shortcut>
            </Item>
          ) : null}
          {onInfo ? (
            <Item onClick={onInfo}>
              <InfoIcon className="size-4" />
              <span>{osConventions().files.infoLabel}</span>
              <Shortcut>{keys.info}</Shortcut>
            </Item>
          ) : null}
          {/* Where one thing is has no answer for several. */}
          {several ? null : (
            <>
              <Separator />
              {onAddToBookmarks ? (
                <Item onClick={onAddToBookmarks}>
                  <StarIcon className="size-4" />
                  <span>Add to Bookmarks</span>
                </Item>
              ) : null}
              <Item onClick={onCopyPath}>
                <ClipboardTextIcon className="size-4" />
                <span>Copy Path</span>
                {keys.copyPath ? <Shortcut>{keys.copyPath}</Shortcut> : null}
              </Item>
              {/* The Open in list already offers the Finder, so a row of its
                    own would name it twice. */}
              {openIn ? null : (
                <Item onClick={onReveal}>
                  <RevealInFolderIcon className="size-4" />
                  <span>{osConventions().showInFileManager}</span>
                </Item>
              )}
              {favorite ? (
                <Item onClick={favorite.onToggle}>
                  {favorite.isFavorite ? (
                    <MinusCircleIcon className="size-4" />
                  ) : (
                    <PlusCircleIcon className="size-4" />
                  )}
                  <span>
                    {favorite.isFavorite
                      ? "Remove from Favorites"
                      : "Add to Favorites"}
                  </span>
                </Item>
              ) : null}
            </>
          )}
          {/* Said up front, since a turned-off item cannot be pointed at
              for a tooltip. */}
          {kept === undefined ? null : (
            <>
              <Separator />
              <p className="max-w-60 px-2 py-1.5 text-xs text-muted-foreground">
                {kept}
              </p>
            </>
          )}
        </>
      ) : (
        <>
          {onNewFolder && !newFolderFirst ? (
            <Item onClick={onNewFolder}>
              <FolderPlusIcon className="size-4" />
              <span>New Folder</span>
              <Shortcut>{keys.newFolder}</Shortcut>
            </Item>
          ) : null}
          {canPaste && paste ? (
            <>
              {onNewFolder && !newFolderFirst ? <Separator /> : null}
              <Item onClick={paste.onPaste}>
                <ClipboardIcon className="size-4" />
                <span>Paste into “{paste.into}”</span>
                <Shortcut>{keys.paste}</Shortcut>
              </Item>
              {keys.moveHere ? (
                <Item onClick={paste.onMove}>
                  <ClipboardIcon className="size-4" />
                  <span>Move into “{paste.into}”</span>
                  <Shortcut>{keys.moveHere}</Shortcut>
                </Item>
              ) : null}
            </>
          ) : null}
          {emptyTail ? (
            <>
              {(onNewFolder && !newFolderFirst) || (canPaste && paste) ? (
                <Separator />
              ) : null}
              {emptyTail}
            </>
          ) : null}
        </>
      )}
    </>
  );
}
