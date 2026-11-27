import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { TOOLBAR_GROUP_CLASSNAME } from "@/client/components/toolbar-control";
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
import { toast } from "@/client/lib/toast";
import { cn } from "@/client/lib/utils";
import { BROWSER_EXTENSIONS_SESSION } from "@/shared/browser-extensions";
import { APP_NAME } from "@instrument-org/shared";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { PushPinIcon } from "@phosphor-icons/react/PushPin";
import { PushPinSlashIcon } from "@phosphor-icons/react/PushPinSlash";
import { PowerIcon } from "@phosphor-icons/react/Power";
import { PuzzlePieceIcon } from "@phosphor-icons/react/PuzzlePiece";
import { ShieldCheckIcon } from "@phosphor-icons/react/ShieldCheck";
import { SlidersHorizontalIcon } from "@phosphor-icons/react/SlidersHorizontal";
import { StorefrontIcon } from "@phosphor-icons/react/Storefront";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { min } from "radashi";
import { useEffect, useRef, useState } from "react";

import { AdBlockingButton, useAdBlocking } from "./ad-blocking";
import {
  type BrowserExtension,
  ExtensionIcon,
  isRefused,
  NotConnectedSteps,
  useBrowserExtensions,
  useExtensionActions,
} from "./browser-extensions";

/**
 * What a tab row too narrow for its address hides of the group: the pinned
 * buttons, which the puzzle piece's menu still lists, as Chrome folds them
 * into it when the toolbar runs out of room. Left in, the field's end
 * (its site icon and star) would draw over them.
 */
const NARROW_ROW_HIDDEN = "@max-[32rem]/tabrow:hidden";

/** The refusals already put to the person this launch, by extension id, so each is said once. */
const noticed = new Set<string>();

/**
 * The pinned buttons already drawn this launch, by extension id. A toolbar
 * mounts again on every tab switch, so only a button pinned or installed
 * since it was first seen grows in, as `AnimatePresence initial={false}`
 * does; until the first pinned list arrives (`isSeen`), nothing does.
 */
const drawnPins = { ids: new Set<string>(), isSeen: false };

/** The pinned buttons that grow in on this draw: none before the first list. */
function enteringPins(pinnedIds: string[]): string[] {
  return drawnPins.isSeen
    ? pinnedIds.filter((id) => !drawnPins.ids.has(id))
    : [];
}

/** Notes the pinned buttons as drawn, once a list with any has arrived. */
function markPinsDrawn(pinnedIds: string[]) {
  if (pinnedIds.length === 0 && !drawnPins.isSeen) {
    return;
  }
  drawnPins.isSeen = true;
  for (const id of pinnedIds) {
    drawnPins.ids.add(id);
  }
}

/**
 * Presses an extension's button, as a click on it does, for its shortcut:
 * the one in the row nearest the top right of the page that has the
 * keyboard (`document.activeElement`, the page's `<webview>`), where the
 * page's own row draws it.
 */
export function openExtensionPopup(extensionId: string): void {
  const page = document.activeElement?.getBoundingClientRect();
  const lists = [...document.querySelectorAll("browser-action-list")].filter(
    (list) => list.getClientRects().length > 0,
  );
  const nearest = page
    ? min(lists, (list) => {
        const { bottom, right } = list.getBoundingClientRect();
        return Math.abs(right - page.right) + Math.abs(bottom - page.top);
      })
    : lists[0];
  nearest?.shadowRoot
    ?.querySelector<HTMLElement>(`#${CSS.escape(extensionId)}`)
    ?.click();
}

/**
 * The browser extensions' buttons, framed as one control of the row's
 * family the way Chrome groups them, with the puzzle piece at its end:
 * every pinned extension's button, each opening its popup under itself,
 * the puzzle piece's menu listing them all with pin and more, and a
 * right-click menu on each button. An extension whose desktop app refuses
 * this browser gets an amber dot and, once, a popover with the steps.
 * With nothing installed the puzzle piece stands alone, so the menu that
 * leads to the store is in sight. Ad blocking's shield leads the group, as
 * the built-in extension it is, for the page in `targetId`.
 */
export function BrowserExtensionButtons({
  targetId,
}: {
  targetId?: BrowserTargetId | undefined;
}) {
  const extensions = useBrowserExtensions().filter(({ enabled }) => enabled);
  const adBlocking = useAdBlocking();
  const [shieldOpen, setShieldOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const opensShield = useRef(false);
  const hasShield = adBlocking.pinned || shieldOpen;
  const hasPinned = extensions.some((extension) => extension.pinned);
  const isGrouped = hasPinned || hasShield;
  const shown = useIsTaskPageVisible();
  const listRef = useRef<HTMLElement>(null);
  const [buttonMenu, setButtonMenu] = useState<null | {
    extension: BrowserExtension;
    x: number;
    y: number;
  }>(null);
  const [noticeId, setNoticeId] = useState<null | string>(null);
  const pointStyle = useWindowPointStyle(buttonMenu ?? { x: 0, y: 0 });
  useCloseOnWindowBlur(buttonMenu !== null, () => {
    setButtonMenu(null);
  });

  // The list draws every extension's button in its own shadow root; a
  // sheet of ours there makes each the frame's kind of member (a 28px
  // glyph that fills only on hover, inside the frame's corner), hides the
  // unpinned ones and dots the refused.
  const unpinned = extensions.filter((extension) => !extension.pinned);
  const refused = extensions.filter(isRefused);
  const pinnedIds = extensions
    .filter((extension) => extension.pinned)
    .map((extension) => extension.id);
  const entering = enteringPins(pinnedIds);
  useEffect(() => {
    markPinsDrawn(pinnedIds);
  });
  const sheet = [
    ":host{gap:2px}",
    ".action{width:28px;height:28px;border-radius:calc(var(--radius-xl) - 2px);background-size:16px 16px}",
    ".action:hover{background-color:color-mix(in srgb,var(--foreground) 8%,transparent)}",
    "@keyframes extension-enter{from{width:0;opacity:0;transform:scale(.6)}to{width:28px;opacity:1;transform:scale(1)}}",
    ...entering.map(
      (id) =>
        `@media(prefers-reduced-motion:no-preference){#${id}{animation:extension-enter 360ms cubic-bezier(.2,.8,.2,1)}}`,
    ),
    ...unpinned.map((extension) => `#${extension.id}{display:none}`),
    ...refused.map(
      (extension) =>
        `#${extension.id}::before{content:"";position:absolute;top:3px;right:3px;width:6px;height:6px;border-radius:9999px;background:var(--color-warning-500);box-shadow:0 0 0 1.5px var(--card)}`,
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
      setNoticeId(firstRefused.id);
    }
  }, [shown, firstRefused]);

  // The notice reads the live list, so it goes once the app takes this
  // browser, which the focus recheck finds when the person comes back from
  // approving it there; a connection gets a word of its own.
  const notice = refused.find((extension) => extension.id === noticeId) ?? null;
  const connectedName = extensions.find(
    (extension) =>
      extension.id === noticeId && extension.connection === "connected",
  )?.desktopApp?.name;
  useEffect(() => {
    if (connectedName) {
      setNoticeId(null);
      toast.success(`${connectedName} is connected to ${APP_NAME}.`);
    }
  }, [connectedName]);

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
          setNoticeId(null);
        }
      }}
      open={notice !== null}
    >
      <PopoverAnchor asChild>
        <div
          className={cn(TOOLBAR_GROUP_CLASSNAME, !isGrouped && "gap-0 px-0")}
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
          <AdBlockingButton
            className={cn(!shieldOpen && NARROW_ROW_HIDDEN)}
            compact={isGrouped}
            onOpenChange={setShieldOpen}
            open={shieldOpen}
            targetId={targetId}
          />
          <browser-action-list
            className={cn(!hasPinned && "hidden", NARROW_ROW_HIDDEN)}
            partition={BROWSER_EXTENSIONS_SESSION}
            ref={listRef}
          />
          <DropdownMenu
            modal={false}
            onOpenChange={setMenuOpen}
            open={menuOpen}
          >
            <ToolbarTooltip label="Extensions">
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="Extensions"
                  className={cn(
                    "grid shrink-0 place-items-center text-foreground/60 hover:bg-foreground/8 hover:text-foreground data-[state=open]:bg-foreground/8 data-[state=open]:text-foreground",
                    isGrouped
                      ? "size-7 rounded-[calc(var(--radius-xl)-2px)]"
                      : "size-8 rounded-xl",
                  )}
                  type="button"
                >
                  <PuzzlePieceIcon className="size-4" />
                </button>
              </DropdownMenuTrigger>
            </ToolbarTooltip>
            <DropdownMenuContent
              align="end"
              className="w-72"
              // The shield's popover opens once the menu has gone, and keeps
              // the focus the menu would hand back to the puzzle piece, which
              // would close it again.
              onCloseAutoFocus={(event) => {
                if (opensShield.current) {
                  opensShield.current = false;
                  event.preventDefault();
                  setShieldOpen(true);
                }
              }}
            >
              <DropdownMenuLabel>Extensions</DropdownMenuLabel>
              <AdBlockingRow
                onActivate={() => {
                  opensShield.current = true;
                  setMenuOpen(false);
                }}
              />
              {extensions.map((extension) => (
                <ExtensionRow
                  extension={extension}
                  key={extension.id}
                  onActivate={() => {
                    if (isRefused(extension)) {
                      setNoticeId(extension.id);
                    } else {
                      activate(extension);
                    }
                  }}
                />
              ))}
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
          <p className="flex items-center gap-2.5 text-sm font-medium">
            <ExtensionIcon className="size-6 shrink-0" extension={notice} />
            <span className="min-w-0 truncate">
              {notice.desktopApp?.name} isn’t connected to {APP_NAME} yet.
            </span>
          </p>
          <div className="mt-2">
            <NotConnectedSteps
              extension={notice}
              onDismiss={() => {
                setNoticeId(null);
              }}
              tone="muted"
            />
          </div>
        </PopoverContent>
      )}
    </Popover>
  );
}

/** Ad blocking in the puzzle piece's menu: its name to open the shield's popover, and its pin. */
function AdBlockingRow({ onActivate }: { onActivate: () => void }) {
  const adBlocking = useAdBlocking();
  return (
    <div className="flex items-center gap-1 rounded-sm pl-2 hover:bg-accent">
      <button
        className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left text-sm"
        onClick={onActivate}
        type="button"
      >
        <ShieldCheckIcon className="size-5 shrink-0" />
        <span className="truncate">Ad blocking</span>
      </button>
      <PinButton
        onPinnedChange={adBlocking.setPinned}
        pinned={adBlocking.pinned}
      />
      {/* Lines up with the extensions' More buttons below. */}
      <span className="size-7 shrink-0" />
    </div>
  );
}

function PinButton({
  onPinnedChange,
  pinned,
}: {
  onPinnedChange: (pinned: boolean) => void;
  pinned: boolean;
}) {
  return (
    <ToolbarTooltip label={pinned ? "Unpin" : "Pin"}>
      <Button
        aria-label={pinned ? "Unpin" : "Pin"}
        className={cn("size-7", !pinned && "text-muted-foreground")}
        onClick={() => {
          onPinnedChange(!pinned);
        }}
        size="icon-sm"
        variant="ghost"
      >
        <PushPinIcon className="size-3.5" weight={pinned ? "fill" : "regular"} />
      </Button>
    </ToolbarTooltip>
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
      <PinButton
        onPinnedChange={(pinned) => {
          actions.setPinned(extension, pinned);
        }}
        pinned={extension.pinned}
      />
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
 * name to its store page, pin or unpin, turn off, Remove, and Manage extensions.
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
          actions.setEnabled(extension, false);
        }}
      >
        <PowerIcon className="size-4" />
        Turn off
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
