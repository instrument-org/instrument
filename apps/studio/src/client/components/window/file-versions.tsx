import { formatByteSize } from "@/client/components/extend/file-system";
import { FileActionsMenuItems } from "@/client/components/file-actions-menu";
import { ShownVersionContext } from "@/client/components/file-preview-fallback";
import { OpenInAppButton } from "@/client/components/open-in-app";
import { SystemPicture } from "@/client/components/system-picture";
import {
  TOOLBAR_CONTROL_CLASSNAME,
  TOOLBAR_GROUP_CLASSNAME,
  TOOLBAR_ICON_BUTTON_CLASSNAME,
} from "@/client/components/toolbar-control";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { dropdownMenuComponents } from "@/client/components/ui/menu-components";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { VersionMark, VersionTag } from "@/client/components/version-tag";
import { useAgentSessionStatus } from "@/client/hooks/use-agent-session-status";
import { useCloseOnWindowBlur } from "@/client/hooks/use-close-on-window-blur";
import { getComputerFileUrl } from "@/client/lib/computer-file-url";
import { getFileType } from "@/client/lib/get-file-type";
import { takeInFileWrites } from "@/client/lib/live-file";
import { spokenMessage, toast } from "@/client/lib/toast";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { fileHref } from "@/shared/computer-href";
import {
  type ChatId,
  VERSIONS_FOLDERS,
} from "@instrument-org/workspace/client";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";
import { DotsThreeOutlineVerticalIcon } from "@phosphor-icons/react/DotsThreeOutlineVertical";
import { XIcon } from "@phosphor-icons/react/X";
import {
  notifyManager,
  type QueryClient,
  skipToken,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { noop } from "radashi";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { FileMark } from "./file-mark";
import { segmentsOf } from "./host-path";

type History = NonNullable<
  Awaited<ReturnType<typeof rpcClient.workspace.chats.fileVersions.call>>
>;
type Version = History["versions"][number];

const IMAGE = /\.(?:avif|bmp|gif|heic|jpe?g|png|svg|webp)$/iu;

/** Whether a path is in a chat's versions folder, so it may be a copy the chat kept. */
export function isInVersionsFolder(hostPath: string): boolean {
  return segmentsOf(hostPath).some((segment) =>
    VERSIONS_FOLDERS.includes(segment),
  );
}

/**
 * Where a copy a chat kept of a file opens: the file, with the copy shown
 * over it, so the row names the file and Restore shows it without opening it
 * again. A page's file is drawn by a guest of its own, so its copy opens in
 * its place.
 */
export function versionHref(file: string, copy: string) {
  return getFileType({ filename: file }) === "html"
    ? fileHref(copy)
    : fileHref(file, { version: copy });
}

/**
 * The versions a chat kept of the file up in its pane: one per reply that
 * handed it over, and any the person put back. Read when the file opens,
 * whenever the list does, and each time the chat stops working, since a
 * turn keeps its versions as it ends.
 */
function useFileVersions(chatId: ChatId, path: string) {
  const query = useQuery(
    rpcClient.workspace.chats.fileVersions.queryOptions({
      input: { id: chatId, path },
      staleTime: 0,
    }),
  );
  const { isChatRunning } = useAgentSessionStatus({
    id: chatId,
    sessionId: undefined,
  });
  const wasRunning = useRef(isChatRunning);
  const { refetch } = query;
  useEffect(() => {
    if (wasRunning.current && !isChatRunning) {
      void refetch();
    }
    wasRunning.current = isChatRunning;
  }, [isChatRunning, refetch]);
  return query;
}

/**
 * Opens a version of the file in the pane: the file itself for the one it
 * holds now, and otherwise its copy, whose history is the file's with
 * `viewing` set to it, so the version row over the copy starts from it and
 * shows with the copy, a read sooner.
 */
function useOpenVersion(
  chatId: ChatId,
  history: History | undefined,
  onOpen: (file: string, copy?: string) => void,
) {
  const queryClient = useQueryClient();
  return (version: Version) => {
    if (history === undefined) {
      return;
    }
    const copy = version.now ? undefined : version.copy;
    if (copy !== undefined) {
      const seeded: History = { ...history, viewing: version };
      queryClient.setQueryData(
        rpcClient.workspace.chats.fileVersions.queryOptions({
          input: { id: chatId, path: copy },
        }).queryKey,
        seeded,
      );
    }
    onOpen(history.file, copy);
  };
}

/**
 * The Versions button in the row over a file in a chat's pane, with how
 * many versions the chat kept, opening their list. Absent for a file the
 * chat kept no other version of.
 */
export function FileVersionsButton({
  chatId,
  onOpen,
  path,
}: {
  chatId: ChatId;
  /** Shows the file in this tab, or a copy kept of it. */
  onOpen: (file: string, copy?: string) => void;
  path: string;
}) {
  const [isOpen, setOpen] = useState(false);
  useCloseOnWindowBlur(isOpen, () => {
    setOpen(false);
  });
  const history = useFileVersions(chatId, path);
  const openVersion = useOpenVersion(chatId, history.data ?? undefined, onOpen);
  const versions = history.data?.versions ?? [];
  const isTooBig = versions.every((version) =>
    version.hash.startsWith("stat:"),
  );
  // Shown once there is something other than the file as it is to go to.
  const hasEarlier = versions.some((version) => !version.now);
  if (
    versions.length === 0 ||
    (!hasEarlier && !isTooBig && history.data?.viewing === undefined)
  ) {
    return null;
  }
  return (
    <Popover
      onOpenChange={(open) => {
        setOpen(open);
        if (open) {
          void history.refetch();
        }
      }}
      open={isOpen}
    >
      <ToolbarTooltip label="Versions">
        <PopoverTrigger
          aria-label="Versions"
          className={cn(
            TOOLBAR_CONTROL_CLASSNAME,
            "flex h-8 shrink-0 items-center gap-1.5 px-2.5 text-[13px] font-medium text-foreground data-[state=open]:bg-accent",
          )}
        >
          <ClockCounterClockwiseIcon className="size-4" />
          {isTooBig ? null : versions.length}
        </PopoverTrigger>
      </ToolbarTooltip>
      <PopoverContent align="end" className="w-87 overflow-y-auto p-1">
        {isTooBig ? (
          <p className="p-2 text-[13px]">
            Versions aren’t available for files this large.
          </p>
        ) : (
          history.data && (
            <VersionsList
              history={history.data}
              onPick={(version) => {
                setOpen(false);
                openVersion(version);
              }}
              path={path}
            />
          )
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The versions of a file, newest first, under the list's header. */
function VersionsList({
  history,
  onPick,
  path,
}: {
  history: History;
  onPick: (version: Version) => void;
  path: string;
}) {
  const name = segmentsOf(history.file).at(-1) ?? history.file;
  return (
    <>
      <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">
        Versions from this chat
      </p>
      {history.versions.map((version) => (
        <VersionRow
          isOn={
            version.copy !== undefined &&
            (version.copy === path ||
              (version.now && history.viewing === undefined))
          }
          key={`${String(version.number)}:${version.hash}`}
          line={lineOf(version)}
          name={name}
          onPick={() => {
            onPick(version);
          }}
          version={version}
        />
      ))}
    </>
  );
}

function VersionRow({
  isOn,
  line,
  name,
  onPick,
  version,
}: {
  isOn: boolean;
  line: string;
  name: string;
  onPick: () => void;
  version: Version;
}) {
  const canOpen = version.now || version.copy !== undefined;
  const mark = <FileMark className="size-5" hostPath={name} name={name} />;
  return (
    <button
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left",
        canOpen ? "hover:bg-accent" : "opacity-45",
        isOn && "bg-accent",
      )}
      disabled={!canOpen}
      onClick={onPick}
      type="button"
    >
      <span className="grid h-9 w-16 shrink-0 place-items-center overflow-hidden rounded-md bg-muted ring-1 ring-foreground/10">
        {version.copy !== undefined && IMAGE.test(version.copy) ? (
          <img
            alt=""
            className="size-full object-cover"
            src={getComputerFileUrl({ hostPath: version.copy })}
          />
        ) : version.copy !== undefined &&
          getFileType({ filename: name }) === "unknown" ? (
          // A file Instrument has no preview of shows the system's picture
          // of it, as its card does.
          <SystemPicture
            className="size-full"
            fallback={mark}
            hostPath={version.copy}
          />
        ) : (
          mark
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px] font-medium tabular-nums">
          v{version.number}
          {version.now && (
            <span className="rounded-full bg-secondary px-1.5 text-[11px] font-normal text-muted-foreground">
              Now
            </span>
          )}
          <span className="font-normal text-muted-foreground">
            {timeOf(version.at)}
          </span>
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {line}
        </span>
      </span>
    </button>
  );
}

/**
 * The row over a file in a chat's pane: its location row (`children`), and
 * while a copy the chat kept of the file is up, the version row in its
 * place. The location row stays mounted all along, so what the screen
 * draws into it is there again on the way back, and is out of sight exactly
 * while the version row is in sight.
 */
export function FileVersionRows({
  children,
  versions,
}: {
  children: ReactNode;
  /** The file's versions, where the row is over a file in a chat's pane. */
  versions?: Parameters<typeof FileVersionRow>[0];
}) {
  return (
    <>
      <div className="contents [&:has(+[data-version-row]:not([data-waits-for-copy]))]:hidden [&:has(+[data-waits-for-copy]):has(~*_[data-version-over]):has(~*_[data-version-under])]:hidden [&:has(+[data-waits-for-copy]):has(~*_[data-version-over]):not(:has(~*_[data-version-over]_[data-file-loading=quiet]))]:hidden">
        {children}
      </div>
      {versions && <FileVersionRow {...versions} />}
    </>
  );
}

/**
 * The version row, while a copy the chat kept of the file is up, on the
 * secondary ground: Done back to the file, the arrows to the next older and
 * newer version, the version by its number and line (its list a press away,
 * the app that opens the copy at its end), Restore, and the file's actions
 * aimed at the copy.
 */
function FileVersionRow({
  chatId,
  isOverFile = false,
  onOpen,
  path,
}: {
  chatId: ChatId;
  /** Whether the copy is drawn over the file in the pane below, which the version row waits for. */
  isOverFile?: boolean;
  /** Shows the file in this tab, or a copy kept of it. */
  onOpen: (file: string, copy?: string) => void;
  path: string;
}) {
  const history = useFileVersions(chatId, path);
  const current =
    history.data?.viewing === undefined
      ? undefined
      : { copy: path, history: history.data, viewing: history.data.viewing };
  // On the way back to the file, the copy stays drawn over it until the
  // pane's screen catches up with the tab, so the version row stays with it.
  const [kept, setKept] = useState(current);
  if (
    current &&
    (current.copy !== kept?.copy || current.history !== kept.history)
  ) {
    setKept(current);
  }
  const shown = current ?? (kept?.history.file === path ? kept : undefined);
  if (!shown) {
    return null;
  }
  const waitsForCopy = isOverFile || current === undefined;
  return (
    <VersionModeRow
      chatId={chatId}
      className={cn(
        // Out of the way unless a copy is drawn over the file below it, the
        // one it names once that has something to show, so the two come and
        // go together.
        waitsForCopy &&
          "[&:has(~*_[data-version-over]_[data-file-loading=quiet]):not(:has(~*_[data-version-under]))]:hidden [&:not(:has(~*_[data-version-over]))]:hidden",
      )}
      copy={shown.copy}
      history={shown.history}
      onOpen={onOpen}
      viewing={shown.viewing}
      waitsForCopy={waitsForCopy}
    />
  );
}

function VersionModeRow({
  chatId,
  className,
  copy,
  history,
  onOpen,
  viewing,
  waitsForCopy,
}: {
  chatId: ChatId;
  className?: string;
  copy: string;
  history: History;
  onOpen: (file: string, copy?: string) => void;
  viewing: Version;
  /** Whether it shows only once the copy is drawn over the file. */
  waitsForCopy: boolean;
}) {
  const [isListOpen, setListOpen] = useState(false);
  useCloseOnWindowBlur(isListOpen, () => {
    setListOpen(false);
  });
  const restore = useRestoreFileVersion(chatId);
  const openVersion = useOpenVersion(chatId, history, onOpen);
  const { file, versions } = history;
  const canOpen = (version: Version) =>
    version.now || version.copy !== undefined;
  const at = versions.findIndex(
    (version) =>
      version.number === viewing.number && version.hash === viewing.hash,
  );
  // Newest first, so older is further down the list.
  const older = at === -1 ? undefined : versions.slice(at + 1).find(canOpen);
  const newer = at === -1 ? undefined : versions.slice(0, at).findLast(canOpen);
  const name = segmentsOf(copy).at(-1) ?? copy;
  return (
    <div
      className={cn(
        "@container/versionrow flex h-11 shrink-0 items-center gap-1.5 border-b border-border bg-secondary px-1.5",
        className,
      )}
      // Read by the location row before it, which steps aside for it.
      data-version-row=""
      data-waits-for-copy={waitsForCopy ? "" : undefined}
    >
      <button
        aria-label="Done"
        className={cn(
          TOOLBAR_CONTROL_CLASSNAME,
          "flex h-8 shrink-0 items-center px-2.5 text-[13px] font-medium text-foreground @max-sm/versionrow:px-2",
        )}
        onClick={() => {
          onOpen(file);
        }}
        type="button"
      >
        <span className="@max-sm/versionrow:hidden">Done</span>
        <XIcon className="hidden size-4 @max-sm/versionrow:block" />
      </button>
      <div className={TOOLBAR_GROUP_CLASSNAME}>
        <StepButton
          icon={<CaretLeftIcon className="size-4" />}
          label="Older version"
          onStep={openVersion}
          to={older}
        />
        <StepButton
          icon={<CaretRightIcon className="size-4" />}
          label="Newer version"
          onStep={openVersion}
          to={newer}
        />
      </div>
      <div
        className={cn(
          "flex h-8 min-w-0 flex-1 items-center gap-2 rounded-xl bg-card pr-2 pl-2 text-[13px] ring-1 [--field-fill:var(--card)]",
          isListOpen ? "ring-foreground/25" : "ring-foreground/10",
        )}
      >
        <Popover
          onOpenChange={(open) => {
            setListOpen(open);
          }}
          open={isListOpen}
        >
          <PopoverTrigger
            aria-label="Versions"
            className="flex h-full min-w-0 flex-1 cursor-default items-center gap-2 text-left outline-none"
          >
            <VersionTag number={viewing.number} />
            <span className="min-w-0 truncate text-muted-foreground @max-sm/versionrow:hidden">
              {lineOf(viewing)}
            </span>
            <CaretDownIcon className="size-3 shrink-0 text-muted-foreground" />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-87 overflow-y-auto p-1">
            <VersionsList
              history={history}
              onPick={(version) => {
                setListOpen(false);
                openVersion(version);
              }}
              path={copy}
            />
          </PopoverContent>
        </Popover>
        <OpenInAppButton target={{ hostPath: copy }} />
      </div>
      {viewing.copy !== undefined && !viewing.now && (
        <Button
          onClick={() => {
            void restore({
              copy,
              file,
              said: `Restored v${String(viewing.number)}`,
            }).then((isDone) => {
              if (isDone) {
                onOpen(file);
              }
            });
          }}
          size="sm"
          variant="brand"
        >
          Restore
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="More actions"
            className={cn(
              TOOLBAR_ICON_BUTTON_CLASSNAME,
              "data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
            )}
            size="icon-sm"
            variant="ghost"
          >
            <DotsThreeOutlineVerticalIcon className="size-4" weight="fill" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <FileActionsMenuItems
            file={{
              filename: name,
              hostPath: copy,
              url: getComputerFileUrl({ hostPath: copy }),
            }}
            menuComponents={dropdownMenuComponents}
          />
          <DropdownMenuSeparator />
          <p className="px-2 pt-0.5 pb-1 text-xs text-muted-foreground">
            {timeOf(viewing.at)} · {formatByteSize(viewing.size)}
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** One of the version row's arrows, drawn as the location row's own: dimmed with no version that way. */
function StepButton({
  icon,
  label,
  onStep,
  to,
}: {
  icon: ReactNode;
  label: string;
  onStep: (version: Version) => void;
  to: undefined | Version;
}) {
  return (
    <ToolbarTooltip label={label}>
      <button
        aria-label={label}
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-lg",
          to === undefined
            ? "text-foreground/25"
            : "text-foreground/60 hover:bg-foreground/8 hover:text-foreground",
        )}
        disabled={to === undefined}
        onClick={() => {
          if (to) {
            onStep(to);
          }
        }}
        type="button"
      >
        {icon}
      </button>
    </ToolbarTooltip>
  );
}

/**
 * What the card for a file with no preview says of the version of it a
 * chat's pane has up at `copy`, to the screen drawn under `children`.
 */
export function ShownVersion({
  chatId,
  children,
  copy,
}: {
  chatId: ChatId;
  children: ReactNode;
  copy: string;
}) {
  const history = useFileVersions(chatId, copy);
  const viewing = history.data?.viewing;
  const file = history.data?.file;
  return (
    <ShownVersionContext
      value={
        viewing && file !== undefined
          ? {
              line: lineOf(viewing),
              name: segmentsOf(file).at(-1) ?? file,
              number: viewing.number,
              size: viewing.size,
            }
          : undefined
      }
    >
      {children}
    </ShownVersionContext>
  );
}

/**
 * A tab's mark while it has a version of a file up: the version's number,
 * once the chat's versions say it, and `fallback` until then.
 */
export function VersionTabMark({
  chatId,
  copy,
  fallback,
}: {
  chatId: ChatId;
  copy: string;
  fallback: ReactNode;
}) {
  const version = useVersionNamed(chatId, copy);
  return version ? <VersionMark number={version.number} /> : fallback;
}

/**
 * The name of the file a copy a chat kept is a version of, and the
 * version's number, for what names the copy; undefined for any other path,
 * and until the chat's versions say.
 */
export function useVersionNamed(
  chatId: ChatId | undefined,
  path: string | undefined,
) {
  const history = useQuery(
    rpcClient.workspace.chats.fileVersions.queryOptions({
      input:
        chatId !== undefined && path !== undefined && isInVersionsFolder(path)
          ? { id: chatId, path }
          : skipToken,
    }),
  );
  const file = history.data?.file;
  const number = history.data?.viewing?.number;
  return file === undefined || number === undefined
    ? undefined
    : { name: segmentsOf(file).at(-1) ?? file, number };
}

/**
 * Puts a version the chat kept back over its file, saying so in a toast
 * with Undo, which puts back what the restore replaced. Resolves whether
 * it did, once the views open on the file show what it put back, so a
 * version drawn over the file can go without the file showing in between
 * as it was. Outside a chat there is nothing to restore.
 */
export function useRestoreFileVersion(chatId: ChatId | undefined) {
  const queryClient = useQueryClient();
  const restore = async ({
    copy,
    file,
    said,
  }: {
    copy: string;
    file: string;
    said: string;
  }): Promise<boolean> => {
    if (chatId === undefined) {
      return false;
    }
    const done = await rpcClient.workspace.chats.restoreFileVersion
      .call({ copy, file, id: chatId })
      .catch((error: unknown) => {
        toast.error("Couldn’t restore that version", {
          cause: error,
          description: spokenMessage(error, ["CANNOT_RESTORE"]),
        });
        return undefined;
      });
    if (!done) {
      return false;
    }
    await showWrite(queryClient, file, done.modifiedAt);
    await queryClient.invalidateQueries({
      queryKey: rpcClient.workspace.chats.fileVersions.key(),
    });
    const { replaced } = done;
    if (replaced === undefined || said === "Undone") {
      toast(said);
      return true;
    }
    toast(said, {
      action: {
        label: "Undo",
        onClick: () => {
          void restore({ copy: replaced, file, said: "Undone" });
        },
      },
    });
    return true;
  };
  return restore;
}

/**
 * Brings the views open on a file up to a write the app just made, rather
 * than to their next look at it: its editors take the text in, a picture is
 * decoded first so the viewer swaps to it in one frame, and the watch every
 * viewer reads takes the write's time. Settles once the cache has told the
 * viewers.
 */
async function showWrite(
  queryClient: QueryClient,
  hostPath: string,
  modifiedAt: number,
) {
  await takeInFileWrites(hostPath);
  if (IMAGE.test(hostPath)) {
    const picture = new Image();
    picture.src = getComputerFileUrl({ hostPath, version: modifiedAt });
    await picture.decode().catch(noop);
  }
  queryClient.setQueryData(
    rpcClient.files.live.info.experimental_liveOptions({
      input: { path: hostPath },
    }).queryKey,
    () => ({ modifiedAt }),
  );
  // The cache tells its observers on a task of its own; this one comes after.
  await new Promise<void>((resolve) => {
    notifyManager.schedule(resolve);
  });
}

/** What a version's row says under its number. */
function lineOf(version: Version): string {
  if (version.away) {
    return "Kept on your other computer";
  }
  if (version.kind === "before-restore") {
    return "Before you restored a version";
  }
  if (version.kind === "original") {
    return "Before this chat changed it";
  }
  if (version.kind === "restored") {
    return version.from === undefined
      ? "You restored a version"
      : `You restored v${String(version.from)}`;
  }
  return version.label;
}

/** `12:01 PM` today, `Nov 14, 12:01 PM` before. */
function timeOf(at: Date): string {
  const isToday = at.toDateString() === new Date().toDateString();
  return at.toLocaleString(undefined, {
    ...(isToday ? {} : { day: "numeric", month: "short" }),
    hour: "numeric",
    minute: "2-digit",
  });
}
