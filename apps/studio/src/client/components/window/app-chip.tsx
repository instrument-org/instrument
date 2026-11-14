import { screenNameOfHref, targetOfAddress } from "@/client/bookmarks/address";
import { PageFavicon } from "@/client/components/favicon";
import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { cn } from "@/client/lib/utils";
import { isScreenName, SCREENS } from "@/shared/instrument-screens";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";
import { CubeIcon } from "@phosphor-icons/react/Cube";
import { FingerprintIcon } from "@phosphor-icons/react/Fingerprint";
import { GearSixIcon } from "@phosphor-icons/react/GearSix";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { NewspaperClippingIcon } from "@phosphor-icons/react/NewspaperClipping";
import { PuzzlePieceIcon } from "@phosphor-icons/react/PuzzlePiece";
import { PulseIcon } from "@phosphor-icons/react/Pulse";
import { ShapesIcon } from "@phosphor-icons/react/Shapes";
import { type ComponentType, type ReactNode } from "react";

import { FileMark } from "./file-mark";
import { FolderMark } from "./folder-mark";
import { segmentsOf } from "./host-path";
import { matchScreen } from "./window-href";

/**
 * The app's own built-in apps, as the address field's chip names them: Chat,
 * Files, and every built-in page by its name in `SCREENS`.
 */
export type BuiltInApp = "chat" | "files" | (string & {});

type Glyph = ComponentType<{ className?: string }>;

/**
 * Each built-in page's mark, by its name in `SCREENS`, drawn in the ink of
 * the words beside it. A page named there that this has no mark for wears a
 * window.
 */
const SCREEN_MARKS: Record<string, Glyph> = {
  activity: PulseIcon,
  apps: ShapesIcon,
  browser: GlobeIcon,
  extensions: PuzzlePieceIcon,
  history: ClockCounterClockwiseIcon,
  memory: FingerprintIcon,
  "release-notes": NewspaperClippingIcon,
  settings: GearSixIcon,
  skills: CubeIcon,
};

/** What a built-in app is called on its chip. */
export function appName(app: BuiltInApp): string {
  if (app === "chat") {
    return "Chat";
  }
  if (app === "files") {
    return "Files";
  }
  return isScreenName(app) ? SCREENS[app].title : titleOf(app);
}

/** A built-in app's mark: the Instrument mark for Chat, Files' folder, and each page's own. */
export function AppMark({
  app,
  className,
}: {
  app: BuiltInApp;
  className?: string;
}) {
  if (app === "chat") {
    return (
      <InstrumentGlyph
        className={cn("size-3.5 shrink-0 text-brand-600", className)}
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
  const Icon = SCREEN_MARKS[app] ?? AppWindowIcon;
  return (
    <Icon className={cn("size-3.5 shrink-0 text-foreground/70", className)} />
  );
}

/**
 * The chip at the start of the address field that says which of the app's
 * own apps the tab is in: its mark and its name, on a card of its own. A
 * press on it goes to the app where it has a place to go to.
 */
export function AppChip({
  app,
  onPress,
}: {
  app: BuiltInApp;
  onPress?: () => void;
}) {
  const face = (
    <>
      <AppMark app={app} />
      {appName(app)}
    </>
  );
  const className =
    "-ml-1.5 flex h-6 shrink-0 cursor-default items-center gap-1.5 rounded-lg bg-card pr-2 pl-1.5 text-[13px] font-medium text-foreground shadow-xs ring-1 ring-foreground/8";
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
 * The mark an address wears wherever it is kept, the mark its tab wears: a
 * site's icon, a folder's or a file's mark, the Instrument mark for a chat,
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
      return screenNameOfHref(href) ?? "";
    }
  }
}

/** A name from an address read as words: `release-notes` as Release notes. */
function titleOf(name: string): string {
  const words = name.replaceAll(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
