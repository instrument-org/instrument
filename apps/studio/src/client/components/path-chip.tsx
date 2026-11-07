import {
  FileSystemFolderGlyph,
  FileTypeIcon,
} from "@/client/components/extend/file-system";
import {
  ChipButton,
  INLINE_CHIP_CLASS_NAME,
  INLINE_CHIP_ICON_CLASS_NAME,
  INLINE_CHIP_ICON_SLOT_CLASS_NAME,
} from "@/client/components/inline-link";
import {
  type OpenOptions,
  WindowContext,
} from "@/client/components/window/context";
import {
  type OpenDestination,
  openClickGestures,
  showOpenMenu,
  wantsNewTab,
  wantsNewWindow,
} from "@/client/hooks/use-open-target";
import {
  locateTypedPath,
  missedPathNotice,
} from "@/client/lib/locate-typed-path";
import { MAX_PATH_LABEL_LENGTH, shortPathLabel } from "@/client/lib/path-text";
import { toast } from "@/client/lib/toast";
import { cn } from "@/client/lib/utils";
import {
  FILE_MISSING_LABEL,
  useFilePresence,
} from "@/client/hooks/use-file-presence";
import { getComputerFileUrl } from "@/client/lib/computer-file-url";
import { expandHomePath } from "@instrument-org/shared";
import { type TypedPath, typedFileName } from "@/client/lib/typed-path";
import { fileHref, folderHref } from "@/shared/computer-href";
import { type ReactElement, type ReactNode, useContext } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * The icon a path written in someone's words is drawn with, read from its
 * name alone: a file's by its extension, and a folder for a name with none
 * or a separator after it. What is really there is only known once it is
 * looked up.
 */
function PathIcon({
  className,
  path,
}: {
  className?: string;
  path: TypedPath;
}) {
  const fileName = typedFileName(path);
  return fileName ? (
    <FileTypeIcon className={className} fileName={fileName} />
  ) : (
    <FileSystemFolderGlyph className={className} />
  );
}

/**
 * Where to ask after the file a path names, for a path that names a file by
 * its name and is a real place on this computer as written: not a folder,
 * and not the agent's shell spelling of a Windows drive (`/c/Users`).
 */
function fileUrlOf(path: TypedPath) {
  if (typedFileName(path) === undefined) {
    return undefined;
  }
  const hostPath = expandHomePath(path.shown, window.api.homeDir);
  const isHostPath =
    window.electron.process.platform === "win32"
      ? /^(?:[a-z]:[\\/]|\\\\)/i.test(hostPath)
      : hostPath.startsWith("/");
  return isHostPath ? getComputerFileUrl({ hostPath }) || undefined : undefined;
}

/**
 * A path on this computer someone wrote into a message, as a chip with its
 * file or folder icon. A long one is shortened to where it starts and the
 * names at its end, the way a bare link is, and hovering it shows the whole
 * path.
 *
 * Drawn from the words, then a file is asked after once the chip comes near
 * the viewport, the way a reply's file cards are (`useFilePresence`), and
 * one that is gone is drawn faded and says so on hover. A folder is not
 * asked: the channel serves files, and its answer for a folder is the same
 * 404 a missing file gets. Nothing is asked while the words are typed, only
 * once they are sent. It opens where the window opens a place on the computer, a file in its
 * view and a folder as the folder view, whatever the chat itself can reach,
 * since the person who wrote it is the one opening it.
 */
export function PathChip({ path }: { path: TypedPath }) {
  const appWindow = useContext(WindowContext);
  const { isMissing, ref } = useFilePresence<HTMLSpanElement>(fileUrlOf(path));
  const icon = <PathIcon className={INLINE_CHIP_ICON_CLASS_NAME} path={path} />;
  const body = <PathChipBody icon={icon} text={shortPathLabel(path.shown)} />;
  const withWholePath = (chip: ReactElement) => (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent maxWidth="24rem">
        <p className="break-all">{path.shown}</p>
        {isMissing && <p className="mt-1 opacity-70">{FILE_MISSING_LABEL}</p>}
      </TooltipContent>
    </Tooltip>
  );
  if (!appWindow) {
    return withWholePath(
      <span
        className={cn(INLINE_CHIP_CLASS_NAME, isMissing && "opacity-60")}
        ref={ref}
      >
        {body}
      </span>,
    );
  }
  const open = (options?: OpenOptions) => {
    void locateTypedPath(path).then((located) => {
      if (located.kind === "failed" || located.kind === "missing") {
        toast(missedPathNotice(located));
        return;
      }
      appWindow.openScreen(
        located.kind === "file"
          ? fileHref(located.path)
          : folderHref(located.path),
        options,
      );
    });
  };
  const destinations: OpenDestination[] = [
    {
      id: "open",
      label: "Open",
      run: () => {
        open();
      },
    },
    {
      id: "openNewTab",
      label: "Open in New Tab",
      run: () => {
        open({ behind: true, newTab: true });
      },
    },
    {
      id: "openNewWindow",
      label: "Open in New Window",
      run: () => {
        open({ newWindow: true });
      },
    },
    {
      id: "copy",
      label: "Copy Path",
      run: () => {
        void navigator.clipboard
          .writeText(path.written)
          .catch((error: unknown) => {
            toast.error("Couldn't copy the path", { cause: error });
          });
      },
    },
  ];
  const clicks = openClickGestures({
    open: () => {
      open();
    },
    openInNewTab: () => {
      open({ behind: true, newTab: true });
    },
  });
  return withWholePath(
    <ChipButton
      className={cn(isMissing && "opacity-60")}
      onActivate={(event) => {
        if (wantsNewWindow(event)) {
          open({ newWindow: true });
        } else if (wantsNewTab(event)) {
          open({ behind: true, newTab: true });
        } else {
          open();
        }
      }}
      onAuxClick={clicks.onAuxClick}
      onContextMenu={(event) => {
        event.preventDefault();
        void showOpenMenu(destinations);
      }}
      onMouseDown={clicks.onMouseDown}
      ref={ref}
    >
      {body}
    </ChipButton>,
  );
}

/**
 * A path's icon, then the path, on one line. A label still long after
 * shortening (a file with a long name) is one long word, so it breaks
 * wherever the line runs out rather than running out of the message, and
 * its first name stays on the icon's line so a line never ends on the icon
 * alone.
 */
function PathChipBody({ icon, text }: { icon: ReactNode; text: string }) {
  const lead = /^[^\\/]*[\\/]?[^\\/]*/.exec(text)?.[0] ?? "";
  const held =
    text.length <= MAX_PATH_LABEL_LENGTH
      ? text
      : lead.length <= 16
        ? lead
        : text.slice(0, 1);
  return (
    <>
      <span className="whitespace-nowrap">
        <span className={INLINE_CHIP_ICON_SLOT_CLASS_NAME}>{icon}</span>
        {held}
      </span>
      <span className="wrap-anywhere">{text.slice(held.length)}</span>
    </>
  );
}
