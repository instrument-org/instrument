import { featuresAtom } from "@/client/atoms/features";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/client/components/ui/popover";
import { useWindowPointStyle } from "@/client/hooks/use-app-zoom";
import { useCloseOnWindowBlur } from "@/client/hooks/use-close-on-window-blur";
import { useIsTaskPageVisible } from "@/client/hooks/use-task-page-visible";
import { cn } from "@/client/lib/utils";
import { BROWSER_EXTENSIONS_SESSION } from "@/shared/browser-extensions";
import { APP_NAME } from "@instrument-org/shared";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { PushPinIcon } from "@phosphor-icons/react/PushPin";
import { PushPinSlashIcon } from "@phosphor-icons/react/PushPinSlash";
import { PuzzlePieceIcon } from "@phosphor-icons/react/PuzzlePiece";
import { SlidersHorizontalIcon } from "@phosphor-icons/react/SlidersHorizontal";
import { StorefrontIcon } from "@phosphor-icons/react/Storefront";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";

import {
  type BrowserExtension,
  ExtensionIcon,
  isRefused,
  NotConnectedSteps,
  useBrowserExtensions,
  useExtensionActions,
} from "./browser-extensions";

/** The refusals already put to the person this launch, by extension id, so each is said once. */
const noticed = new Set<string>();

/**
 * The browser extensions' buttons, grouped in a pill before Ask the way
 * Chrome groups them, with the puzzle piece at its end: every pinned
 * extension's button, each opening its popup under itself, the puzzle
 * piece's menu listing them all with pin and more, and a right-click menu
 * on each button. An extension whose desktop app refuses this browser gets
 * an amber dot and, once, a popover with the steps. Nothing while the
 * extensions are off.
 */
export function BrowserExtensionButtons() {
  const enabled = useAtomValue(featuresAtom).browser_extensions;
  const extensions = useBrowserExtensions();
  const shown = useIsTaskPageVisible();
  const listRef = useRef<HTMLElement>(null);
  const [buttonMenu, setButtonMenu] = useState<null | {
    extension: BrowserExtension;
    x: number;
    y: number;
  }>(null);
  const [notice, setNotice] = useState<BrowserExtension | null>(null);
  const pointStyle = useWindowPointStyle(buttonMenu ?? { x: 0, y: 0 });
  useCloseOnWindowBlur(buttonMenu !== null, () => {
    setButtonMenu(null);
  });

  // The list draws every extension's button in its own shadow root; a
  // sheet of ours there hides the unpinned ones and dots the refused.
  const unpinned = extensions.filter((extension) => !extension.pinned);
  const refused = extensions.filter(isRefused);
  const sheet = [
    ...unpinned.map((extension) => `#${extension.id}{display:none}`),
    ...refused.map(
      (extension) =>
        `#${extension.id}::before{content:"";position:absolute;top:0;right:0;width:8px;height:8px;border-radius:9999px;background:var(--color-warning-500);box-shadow:0 0 0 2px var(--background)}`,
    ),
  ].join("");
  useEffect(() => {
    const root = listRef.current?.shadowRoot;
    if (!root) {
      return;
    }
    let style = root.querySelector<HTMLStyleElement>("style[data-pins]");
    if (!style) {
      style = document.createElement("style");
      style.dataset.pins = "";
      root.appendChild(style);
    }
    style.textContent = sheet;
  }, [sheet]);

  // A refusal is put to the person once, in a tab they are looking at.
  const firstRefused = refused.find((extension) => !noticed.has(extension.id));
  useEffect(() => {
    if (shown && firstRefused) {
      noticed.add(firstRefused.id);
      setNotice(firstRefused);
    }
  }, [shown, firstRefused]);

  if (!enabled) {
    return null;
  }

  const activate = (extension: BrowserExtension) => {
    listRef.current?.shadowRoot
      ?.querySelector<HTMLElement>(`#${extension.id}`)
      ?.click();
  };

  return (
    <Popover
      modal={false}
      onOpenChange={(open) => {
        if (!open) {
          setNotice(null);
        }
      }}
      open={notice !== null}
    >
      <PopoverAnchor asChild>
        <div
          className="flex h-7 shrink-0 items-center gap-0.5 rounded-full border px-0.5"
          // The buttons live in the list's shadow root, which stops a
          // right-click on its own; this runs first and takes it for the
          // button's menu.
          onContextMenuCapture={(event) => {
            const target = event.nativeEvent.composedPath()[0];
            if (!(target instanceof HTMLElement)) {
              return;
            }
            const extension = extensions.find(
              (candidate) => candidate.id === target.id,
            );
            if (!extension) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            setButtonMenu({ extension, x: event.clientX, y: event.clientY });
          }}
        >
          <browser-action-list
            partition={BROWSER_EXTENSIONS_SESSION}
            ref={listRef}
          />
          <DropdownMenu modal={false}>
            <ToolbarTooltip label="Extensions">
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="Extensions"
                  className="size-6 rounded-full"
                  size="icon-sm"
                  variant="ghost"
                >
                  <PuzzlePieceIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
            </ToolbarTooltip>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>Extensions</DropdownMenuLabel>
              {extensions.map((extension) => (
                <ExtensionRow
                  extension={extension}
                  key={extension.id}
                  onActivate={() => {
                    if (isRefused(extension)) {
                      setNotice(extension);
                    } else {
                      activate(extension);
                    }
                  }}
                />
              ))}
              {extensions.length === 0 && (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">
                  Nothing is installed yet.
                </p>
              )}
              <DropdownMenuSeparator />
              <ManageItems />
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu
            modal={false}
            onOpenChange={(open) => {
              if (!open) {
                setButtonMenu(null);
              }
            }}
            open={buttonMenu !== null}
          >
            <DropdownMenuTrigger asChild>
              <span className="fixed size-0" style={pointStyle} />
            </DropdownMenuTrigger>
            {buttonMenu && (
              <DropdownMenuContent align="start" className="w-64">
                <ButtonMenuItems extension={buttonMenu.extension} />
              </DropdownMenuContent>
            )}
          </DropdownMenu>
        </div>
      </PopoverAnchor>
      {notice && (
        <PopoverContent align="end" className="w-96 p-4">
          <div className="flex gap-3">
            <ExtensionIcon className="size-9 shrink-0" extension={notice} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {notice.desktopApp?.name} isn't connected to {APP_NAME} yet.
              </p>
              <div className="mt-1">
                <NotConnectedSteps extension={notice} tone="muted" />
              </div>
              <Button
                className="mt-2"
                onClick={() => {
                  setNotice(null);
                }}
                size="xs"
                variant="ghost"
              >
                Not now
              </Button>
            </div>
          </div>
        </PopoverContent>
      )}
    </Popover>
  );
}

/** An extension in the puzzle piece's menu: its name to open it, its pin, and more. */
function ExtensionRow({
  extension,
  onActivate,
}: {
  extension: BrowserExtension;
  onActivate: () => void;
}) {
  const actions = useExtensionActions();
  const refused = isRefused(extension);
  return (
    <div className="flex items-center gap-1 rounded-sm pl-2 hover:bg-accent">
      <button
        className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left text-sm"
        onClick={onActivate}
        type="button"
      >
        <ExtensionIcon className="size-5 shrink-0" extension={extension} />
        <span className="truncate">{extension.name}</span>
        {refused && (
          <span className="flex shrink-0 items-center gap-1 text-xs whitespace-nowrap text-warning-700 dark:text-warning-300">
            <span className="size-1.5 rounded-full bg-warning-500" />
            Not connected
          </span>
        )}
      </button>
      <ToolbarTooltip
        label={extension.pinned ? "Take out of the row" : "Show in the row"}
      >
        <Button
          aria-label={extension.pinned ? "Unpin" : "Pin"}
          className={cn("size-7", !extension.pinned && "text-muted-foreground")}
          onClick={() => {
            actions.setPinned(extension, !extension.pinned);
          }}
          size="icon-sm"
          variant="ghost"
        >
          <PushPinIcon
            className="size-3.5"
            weight={extension.pinned ? "fill" : "regular"}
          />
        </Button>
      </ToolbarTooltip>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger
          aria-label="More"
          className="size-7 justify-center p-0 [&>svg:last-child]:hidden"
        >
          <DotsThreeIcon className="size-4" />
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <ButtonMenuItems extension={extension} />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </div>
  );
}

/**
 * What a right-click on an extension's button offers, as Chrome's does: its
 * name to its store page, pin or unpin, Remove, and Manage extensions.
 */
function ButtonMenuItems({ extension }: { extension: BrowserExtension }) {
  const actions = useExtensionActions();
  return (
    <>
      <DropdownMenuItem
        onSelect={() => {
          actions.openStorePage(extension);
        }}
      >
        <ExtensionIcon className="size-4" extension={extension} />
        <span className="truncate">{extension.name}</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={() => {
          actions.setPinned(extension, !extension.pinned);
        }}
      >
        {extension.pinned ? (
          <PushPinSlashIcon className="size-4" />
        ) : (
          <PushPinIcon className="size-4" />
        )}
        {extension.pinned ? "Unpin" : "Pin"}
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => {
          actions.remove(extension);
        }}
        variant="destructive"
      >
        <TrashIcon className="size-4" />
        Remove from {APP_NAME}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <ManageItems />
    </>
  );
}

/** The ways out of the extension menus: the Extensions page and the store. */
export function ManageItems() {
  const actions = useExtensionActions();
  return (
    <>
      <DropdownMenuItem
        onSelect={() => {
          actions.manage();
        }}
      >
        <SlidersHorizontalIcon className="size-4" />
        Manage extensions
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => {
          actions.openStore();
        }}
      >
        <StorefrontIcon className="size-4" />
        Chrome Web Store
      </DropdownMenuItem>
    </>
  );
}
