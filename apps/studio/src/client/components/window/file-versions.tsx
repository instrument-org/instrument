import { TOOLBAR_CONTROL_CLASSNAME } from "@/client/components/toolbar-control";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { useCloseOnWindowBlur } from "@/client/hooks/use-close-on-window-blur";
import { getComputerFileUrl } from "@/client/lib/computer-file-url";
import { toast } from "@/client/lib/toast";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type ChatId } from "@instrument-org/workspace/client";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { FileMark } from "./file-mark";
import { segmentsOf } from "./host-path";

type History = NonNullable<
  Awaited<ReturnType<typeof rpcClient.workspace.chats.fileVersions.call>>
>;
type Version = History["versions"][number];

const IMAGE = /\.(?:avif|bmp|gif|heic|jpe?g|png|svg|webp)$/iu;

/**
 * The versions a chat kept of the file up in its pane: one per reply that
 * handed it over, and any the person put back. Read when the file opens and
 * again whenever the list does, since a turn can add one at any time.
 */
function useFileVersions(chatId: ChatId, path: string) {
  return useQuery(
    rpcClient.workspace.chats.fileVersions.queryOptions({
      input: { id: chatId, path },
      staleTime: 0,
    }),
  );
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
  /** Shows a file or a kept copy in this tab. */
  onOpen: (hostPath: string) => void;
  path: string;
}) {
  const [isOpen, setOpen] = useState(false);
  useCloseOnWindowBlur(isOpen, () => {
    setOpen(false);
  });
  const history = useFileVersions(chatId, path);
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
      <PopoverContent align="end" className="w-87 p-1">
        {isTooBig ? (
          <p className="p-2 text-[13px]">
            This file is too big to keep versions of, so each reply’s card shows
            it as it is now.
          </p>
        ) : (
          <>
            <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">
              Versions from this chat
            </p>
            {versions.map((version) => (
              <VersionRow
                isOn={
                  version.copy !== undefined &&
                  (version.copy === path ||
                    (version.now && history.data?.viewing === undefined))
                }
                key={`${version.hash}:${version.at.toISOString()}`}
                line={lineOf(version, versions)}
                name={segmentsOf(history.data?.file ?? path).at(-1) ?? path}
                onPick={() => {
                  setOpen(false);
                  onOpen(
                    version.now || version.copy === undefined
                      ? (history.data?.file ?? path)
                      : version.copy,
                  );
                }}
                version={version}
              />
            ))}
          </>
        )}
      </PopoverContent>
    </Popover>
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
        ) : (
          <FileMark className="size-5" hostPath={name} name={name} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px] font-medium">
          {timeOf(version.at)}
          {version.now && (
            <span className="rounded-full bg-secondary px-1.5 text-[11px] text-muted-foreground">
              Now
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {line}
        </span>
      </span>
    </button>
  );
}

/**
 * The strip over a kept copy open in a chat's pane: which version it is,
 * the way back to the file, and Restore, which puts it back over the file.
 */
export function FileVersionStrip({
  chatId,
  onOpen,
  path,
}: {
  chatId: ChatId;
  onOpen: (hostPath: string) => void;
  path: string;
}) {
  const queryClient = useQueryClient();
  const history = useFileVersions(chatId, path);
  const viewing = history.data?.viewing;
  const file = history.data?.file;
  if (!viewing || file === undefined) {
    return null;
  }
  const restore = async (copy: string, said: string) => {
    const done = await rpcClient.workspace.chats.restoreFileVersion
      .call({ copy, file, id: chatId })
      .catch((error: unknown) => {
        toast.error("Couldn’t restore that version", { cause: error });
        return undefined;
      });
    if (!done) {
      return;
    }
    await queryClient.invalidateQueries({
      queryKey: rpcClient.workspace.chats.fileVersions.key(),
    });
    onOpen(file);
    const { replaced } = done;
    if (replaced === undefined || said === "Undone") {
      toast(said);
      return;
    }
    toast(said, {
      action: {
        label: "Undo",
        onClick: () => {
          void restore(replaced, "Undone");
        },
      },
    });
  };
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-secondary px-3 text-[13px]">
      <ClockCounterClockwiseIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">
        Version from {timeOf(viewing.at)}
        {viewing.label ? `, after “${viewing.label}”` : ""}
      </span>
      <Button
        onClick={() => {
          onOpen(file);
        }}
        size="sm"
        variant="ghost"
      >
        Back to now
      </Button>
      {viewing.copy !== undefined && !viewing.now && (
        <Button
          onClick={() => {
            void restore(path, `Restored the ${timeOf(viewing.at)} version`);
          }}
          size="sm"
          variant="secondary"
        >
          Restore
        </Button>
      )}
    </div>
  );
}

/** What a version's row says under its time. */
function lineOf(version: Version, versions: readonly Version[]): string {
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
    const from = versions.find(
      (other) => other.kind !== "restored" && other.hash === version.hash,
    );
    return from
      ? `You restored the ${timeOf(from.at)} version`
      : "You restored a version";
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
