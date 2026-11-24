import { targetOfAddress } from "@/client/bookmarks/address";
import { PageFavicon } from "@/client/components/favicon";
import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { cn } from "@/client/lib/utils";
import {
  isScreenName,
  type ScreenName,
  SCREENS,
  screenOfHref,
} from "@/shared/instrument-screens";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { BookmarksIcon } from "@phosphor-icons/react/Bookmarks";
import { FolderSimpleIcon } from "@phosphor-icons/react/FolderSimple";
import { GearSixIcon } from "@phosphor-icons/react/GearSix";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { KeyboardIcon } from "@phosphor-icons/react/Keyboard";
import { ChatsCircleIcon } from "@phosphor-icons/react/ChatsCircle";
import { NewspaperClippingIcon } from "@phosphor-icons/react/NewspaperClipping";
import { PuzzlePieceIcon } from "@phosphor-icons/react/PuzzlePiece";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";
import { ShapesIcon } from "@phosphor-icons/react/Shapes";
import { type ComponentType, type ReactNode } from "react";

import { AppIcon } from "./app-icon";
import { FileMark } from "./file-mark";
import { FolderMark } from "./folder-mark";
import { segmentsOf } from "./host-path";
import { CHATS_INDEX_HREF, matchScreen } from "./window-href";

/**
 * The app's own built-in apps, as the address field's chip names them: Chat,
 * Files, and every built-in page by its name in `SCREENS`.
 */
export type BuiltInApp = "chat" | "files" | (string & {});

type Glyph = ComponentType<{ className?: string }>;

/**
 * Each built-in page's mark, by its name in `SCREENS`: what its tab, its
 * chip and a row or bookmark of it wear.
 */
const SCREEN_MARKS: Record<ScreenName, Glyph> = {
  activity: ClockCounterClockwiseIcon,
  apps: ShapesIcon,
  chats: ChatsCircleIcon,
  bookmarks: BookmarksIcon,
  browser: GlobeIcon,
  extensions: PuzzlePieceIcon,
  files: FolderSimpleIcon,
  "release-notes": NewspaperClippingIcon,
  settings: GearSixIcon,
  shortcuts: KeyboardIcon,
};

/** A built-in page's mark alone, in the ink of whatever it stands in. */
export function ScreenMark({
  className,
  name,
}: {
  className?: string;
  name: ScreenName;
}) {
  const Mark = SCREEN_MARKS[name];
  return <Mark className={className} />;
}

/**
 * Where a built-in app's chip goes: the app's index, which every place in it
 * is under. Chat's is every chat; Files' is the folder browser at its start.
 */
export function appIndexHref(app: BuiltInApp): string | undefined {
  if (app === "chat") {
    return CHATS_INDEX_HREF;
  }
  if (!isScreenName(app)) {
    return undefined;
  }
  const screen = SCREENS[app];
  return "href" in screen ? screen.href : undefined;
}

/** What a built-in app is called on its chip. */
export function appName(app: BuiltInApp): string {
  if (app === "chat") {
    return "Chats";
  }
  if (app === "files") {
    return "Files";
  }
  return isScreenName(app) ? SCREENS[app].title : titleOf(app);
}

/** A built-in app's mark: the chat bubble for Chat, Files' folder, and each page's own. */
export function AppMark({
  app,
  className,
}: {
  app: BuiltInApp;
  className?: string;
}) {
  if (app === "chat") {
    return (
      <ChatCircleIcon
        className={cn("size-3.5 shrink-0 text-foreground/70", className)}
      />
    );
  }
  if (app === "files") {
    return (
      <span
        className={cn(
          "flex size-3.5 shrink-0 items-center justify-center",
          className,
        )}
      >
        <FileSystemFolderGlyph className="h-3 w-auto" />
      </span>
    );
  }
  const Icon = isScreenName(app) ? SCREEN_MARKS[app] : AppWindowIcon;
  return (
    <Icon className={cn("size-3.5 shrink-0 text-foreground/70", className)} />
  );
}

/**
 * The chip at the start of the address field that says which of the app's
 * own apps the tab is in: its mark and its name, on a card of its own; Chats
 * wears the bubbles of many chats, the page it goes to. A press on it goes
 * to the app where it has a place to go to. With
 * `nameFolds`, a narrow field (`@container/field`) shows the mark alone, so
 * the name after the chip keeps the room.
 */
export function AppChip({
  app,
  nameFolds = false,
  onPress,
}: {
  app: BuiltInApp;
  nameFolds?: boolean;
  onPress?: () => void;
}) {
  const face = (
    <>
      {app === "chat" ? (
        <ChatsCircleIcon className="size-3.5 shrink-0 text-foreground/70" />
      ) : (
        <AppMark app={app} />
      )}
      <span className={cn(nameFolds && "@max-[18rem]/field:sr-only")}>
        {appName(app)}
      </span>
    </>
  );
  const className = cn(CHIP, nameFolds && "@max-[18rem]/field:pr-1.5");
  if (!onPress) {
    return (
      <span className={className} data-app-chip={app}>
        {face}
      </span>
    );
  }
  return (
    <button
      className={cn(className, "hover:bg-accent")}
      data-app-chip={app}
      onClick={onPress}
      type="button"
    >
      {face}
    </button>
  );
}

/**
 * The same chip ahead of the address of a page on an app's site: which of the
 * person's apps the page is, and the way to the app's page in Instrument.
 */
export function SiteAppChip({
  icon,
  name,
  onPress,
  site,
}: {
  icon?: string | undefined;
  name: string;
  onPress: () => void;
  site: string | undefined;
}) {
  return (
    <button
      className={cn(CHIP, "max-w-40 hover:bg-accent @max-[18rem]/field:pr-1.5")}
      onClick={onPress}
      type="button"
    >
      <AppIcon icon={icon} name={name} site={site} size="sm" />
      <span className="truncate @max-[18rem]/field:sr-only">{name}</span>
    </button>
  );
}

/** A chip's card, at the start of the address field. */
const CHIP =
  "-ml-1.5 flex h-6 shrink-0 cursor-default items-center gap-1.5 rounded-lg bg-card pr-2 pl-1.5 text-[13px] font-medium text-foreground shadow-xs ring-1 ring-foreground/8";

/**
 * The mark an address wears wherever it is kept, the mark its tab wears: a
 * site's icon, a folder's or a file's mark, the chat bubble for a chat,
 * and a built-in page's own; a place inside an app wears the app's mark.
 */
export function AddressMark({
  address,
  className,
}: {
  address: string;
  className?: string;
}): ReactNode {
  const target = targetOfAddress(address);
  if (!target) {
    return <AppMark app="" className={className} />;
  }
  if (target.kind === "page") {
    return (
      <PageFavicon
        className={cn("size-3.5", className)}
        hasTooltip={false}
        url={target.url}
      />
    );
  }
  if (target.kind === "path") {
    return target.isFolder ? (
      <FolderMark path={target.path} />
    ) : (
      <FileMark
        className={cn("size-4", className)}
        hostPath={target.path}
        name={segmentsOf(target.path).at(-1) ?? target.path}
      />
    );
  }
  return <AppMark app={appOfHref(target.href)} className={className} />;
}

/** The built-in app a screen's href is in, for its mark. */
function appOfHref(href: string): BuiltInApp {
  const screen = matchScreen(href);
  switch (screen.kind) {
    case "chat":
    case "chatLink":
    case "chatOfSession":
    case "inbox":
    case "task": {
      return "chat";
    }
    case "computer": {
      return "files";
    }
    case "app":
    case "apps": {
      return "apps";
    }
    case "memory": {
      return "memory";
    }
    case "skill": {
      return "skills";
    }
    case "setting": {
      return "settings";
    }
    case "namedScreen": {
      return screen.name;
    }
    default: {
      return screenOfHref(href)?.name ?? "";
    }
  }
}

/** A name from an address read as words: `release-notes` as Release notes. */
function titleOf(name: string): string {
  const words = name.replaceAll(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
