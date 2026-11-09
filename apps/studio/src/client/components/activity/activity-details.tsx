import { EntryIcon } from "@/client/components/activity/activity-icons";
import {
  RequestDetail,
  RequestRows,
  turnDuration,
  useModelName,
} from "@/client/components/activity/activity-requests";
import {
  actionText,
  leadOf,
  modelOf,
  placeOf,
  type ShownAction,
  type TimelineEntry,
  turnPlaceOf,
  turnText,
} from "@/client/components/activity/activity-timeline";
import { CopyButton } from "@/client/components/copy-button";
import { FolderRow } from "@/client/components/folder-row";
import { Button } from "@/client/components/ui/button";
import { folderOf, nameOf } from "@/client/components/window/host-path";
import { useGesturesFor } from "@/client/hooks/use-open-target";
import { displayLocale } from "@/client/lib/display-locale";
import { type OpenTarget } from "@/client/lib/open-target";
import { showInFolder, showInFolderLabel } from "@/client/lib/show-in-files";
import { commandKeyHeld, osConventions } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { XIcon } from "@phosphor-icons/react/X";
import { skipToken, useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

const dayFormat = new Intl.DateTimeFormat(displayLocale, {
  day: "numeric",
  month: "short",
  weekday: "short",
});
const timeFormat = new Intl.DateTimeFormat(displayLocale, {
  hour: "numeric",
  minute: "2-digit",
});

/** When something happened, as a person says it: today at 2:38 PM, or the day's date and time. */
function whenOf(at: number, now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const day =
    at >= today.getTime()
      ? "Today"
      : at >= yesterday.getTime()
        ? "Yesterday"
        : dayFormat.format(at);
  return `${day} at ${timeFormat.format(at)}`;
}

/**
 * The details of the row picked, in a card beside the list: what it names
 * and when, a way to open it, where it is, the other times it was opened,
 * and a way to take it out of Activity. An AI row lists its requests, each
 * opening what was recorded about it, rather than what was said, which is
 * the chat's to show.
 */
export function ActivityDetails({
  entry,
  onClose,
  onRemove,
}: {
  entry: TimelineEntry;
  onClose: () => void;
  /** Absent for a row that stays, a permission answered. */
  onRemove?: () => void;
}) {
  const [request, setRequest] = useState<null | string>(null);
  return (
    <div className="relative flex min-h-0 w-full flex-col overflow-y-auto rounded-xl border border-border bg-card p-5 select-text">
      <Button
        aria-label="Close"
        className="absolute top-3 right-3"
        onClick={onClose}
        size="icon-sm"
        variant="ghost"
      >
        <XIcon className="size-4" />
      </Button>
      {request === null ? (
        <div className="flex flex-1 flex-col gap-5">
          {entry.kind === "turn" ? (
            <TurnDetails entry={entry} onOpenRequest={setRequest} />
          ) : (
            <ActionDetails action={entry.action} at={entry.at} />
          )}
          <span className="flex-1" />
          {onRemove ? (
            <div>
              <Button
                className="-ml-2.5"
                onClick={onRemove}
                size="sm"
                variant="ghost-destructive"
              >
                Remove from Activity
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <RequestDetail
          id={request}
          onBack={() => {
            setRequest(null);
          }}
        />
      )}
    </div>
  );
}

function Head({
  entry,
  line,
  title,
}: {
  entry: TimelineEntry;
  line: string;
  title: string;
}) {
  return (
    <div className="flex items-start gap-3 pr-8">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-foreground/5">
        <EntryIcon className="size-5" entry={entry} />
      </span>
      <div className="min-w-0">
        <div className="text-[15px] leading-5 font-medium [overflow-wrap:anywhere]">
          {title}
        </div>
        <div className="mt-0.5 text-[13px] text-muted-foreground">{line}</div>
      </div>
    </div>
  );
}

/** Open, and what else the row's place can be opened with. */
function Opens({
  extra,
  target,
}: {
  extra?: ReactNode;
  target: OpenTarget | undefined;
}) {
  const gesturesFor = useGesturesFor();
  const gestures = target ? gesturesFor(target) : undefined;
  if (!gestures?.primary && !extra) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {gestures?.primary ? (
        <Button
          onClick={(event) => {
            if (commandKeyHeld(event)) {
              gestures.separate?.run();
            } else {
              gestures.primary?.run();
            }
          }}
          size="sm"
          variant="outline"
        >
          Open
        </Button>
      ) : null}
      {extra}
    </div>
  );
}

function Facts({ children }: { children: ReactNode }) {
  return <dl className="flex flex-col">{children}</dl>;
}

function Fact({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-3 py-1.5 text-[13px]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/** A folder as every list names one: its mark, its name over its path, and the menu that copies the path. */
function FolderFact({ label, path }: { label: string; path: string }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3 py-1 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <FolderRow
        className="-mx-1.5 rounded-md p-1.5 hover:bg-foreground/5"
        onOpen={() => {
          void showInFolder(path, { kind: "folder" });
        }}
        path={path}
      />
    </div>
  );
}

/** A page's address in full, to read and copy. */
function AddressFact({ url }: { url: string }) {
  return (
    <Fact label="Address">
      <span className="flex items-start gap-1">
        <span className="min-w-0 flex-1 font-mono text-xs leading-5 break-all">
          {url}
        </span>
        <CopyButton
          className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
          label="Copy address"
          onCopy={() => navigator.clipboard.writeText(url)}
          tooltip="Copy address"
        />
      </span>
    </Fact>
  );
}

/** The other times the person opened what a row names, newest first. */
function OtherTimes({
  at,
  of,
}: {
  at: number;
  of:
    | { download: true; path: string }
    | { path: string }
    | { url: string }
    | undefined;
}) {
  const { data } = useQuery(
    rpcClient.activity.openings.queryOptions({ input: of ?? skipToken }),
  );
  // The row's own opening is among them, and the rest are the others.
  const others = (data ?? [])
    .filter((each) => Date.parse(each.at) !== at)
    .slice(0, 8);
  if (others.length === 0) {
    return null;
  }
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">
        Other times
      </div>
      {others.map((each) => (
        <div
          className="flex h-7 items-center justify-between gap-3 text-[13px]"
          key={`${each.kind}:${each.at}`}
        >
          <span className="truncate">
            {each.kind === "open-with"
              ? `Opened in ${each.app ?? "another app"}`
              : each.kind === "download"
                ? "Downloaded"
                : each.kind === "page"
                  ? "Visited"
                  : "Opened"}
          </span>
          <span className="shrink-0 text-muted-foreground">
            {whenOf(Date.parse(each.at))}
          </span>
        </div>
      ))}
    </div>
  );
}

/** What one of the person's own rows names, where it is, and what else is known about it. */
function ActionDetails({ action, at }: { action: ShownAction; at: number }) {
  const words = { trash: osConventions().trash };
  const text = actionText(action, words);
  const entry: TimelineEntry = { action, at, id: "", kind: "action" };
  const when = whenOf(at);
  const line = text.context ? `${text.context} · ${when}` : when;
  const target = placeOf(action);
  const showFile = (path: string) => (
    <Button
      onClick={() => {
        void showInFolder(path, { kind: "file" });
      }}
      size="sm"
      variant="outline"
    >
      {showInFolderLabel("file")}
    </Button>
  );
  const head = <Head entry={entry} line={line} title={text.title} />;
  switch (action.kind) {
    case "file":
    case "open-with":
    case "edit": {
      return (
        <>
          {head}
          <Opens extra={showFile(action.path)} target={target} />
          <Facts>
            <FolderFact label="Where" path={folderOf(action.path)} />
          </Facts>
          <OtherTimes at={at} of={{ path: action.path }} />
        </>
      );
    }
    case "download": {
      return (
        <>
          {head}
          <Opens extra={showFile(action.path)} target={target} />
          <Facts>
            <FolderFact label="Where" path={folderOf(action.path)} />
            {action.url ? <AddressFact url={action.url} /> : null}
          </Facts>
          <OtherTimes at={at} of={{ download: true, path: action.path }} />
        </>
      );
    }
    case "folder":
    case "new-folder": {
      return (
        <>
          {head}
          <Opens target={target} />
          <Facts>
            <FolderFact label="In" path={folderOf(action.path)} />
          </Facts>
        </>
      );
    }
    case "rename": {
      return (
        <>
          {head}
          <Opens extra={showFile(action.to)} target={target} />
          <Facts>
            <Fact label="Before">{nameOf(action.from)}</Fact>
            <FolderFact label="Where" path={folderOf(action.to)} />
          </Facts>
        </>
      );
    }
    case "move":
    case "copy": {
      return (
        <>
          {head}
          <Opens target={target} />
          <Facts>
            <Fact label="Files">{action.names.map(nameOf).join(", ")}</Fact>
            <FolderFact label="From" path={action.from} />
            <FolderFact label="To" path={action.to} />
          </Facts>
        </>
      );
    }
    case "trash": {
      const first = action.paths[0];
      return (
        <>
          {head}
          <Facts>
            <Fact label="Files">{action.paths.map(nameOf).join(", ")}</Fact>
            {first === undefined ? null : (
              <FolderFact label="From" path={folderOf(first)} />
            )}
          </Facts>
        </>
      );
    }
    case "page": {
      return (
        <>
          {head}
          <Opens target={target} />
          <Facts>
            <AddressFact url={action.url} />
          </Facts>
          <OtherTimes at={at} of={{ url: action.url }} />
        </>
      );
    }
    case "permission": {
      return (
        <>
          {head}
          <Opens target={target} />
          <Facts>
            <Fact label="Chat">{action.title}</Fact>
            {action.path === undefined ? (
              <Fact label="App">{action.app}</Fact>
            ) : (
              <FolderFact label="Folder" path={action.path} />
            )}
          </Facts>
        </>
      );
    }
    case "error": {
      return (
        <>
          {head}
          <Facts>
            <Fact label="Said">{action.message}</Fact>
          </Facts>
        </>
      );
    }
    case "update": {
      return (
        <>
          {head}
          <Facts>
            <Fact label="From">{action.from}</Fact>
            <Fact label="To">{action.to}</Fact>
          </Facts>
        </>
      );
    }
    case "chat":
    case "app":
    case "screen":
    case "setting": {
      return (
        <>
          {head}
          <Opens target={target} />
        </>
      );
    }
  }
}

/** What an AI row was: its chat, the model, and its requests, each opening what was recorded about it. */
function TurnDetails({
  entry,
  onOpenRequest,
}: {
  entry: Extract<TimelineEntry, { kind: "turn" }>;
  onOpenRequest: (id: string) => void;
}) {
  const modelName = useModelName();
  const { turn } = entry;
  const text = turnText(turn, modelName);
  const lead = leadOf(turn);
  const count = turn.requests.length;
  const line = [
    lead ? modelName(modelOf(lead)) : "",
    `${count} ${count === 1 ? "request" : "requests"}`,
    turnDuration(turn),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <Head entry={entry} line={line} title={text.title} />
      <Opens target={turnPlaceOf(turn)} />
      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {`Requests · ${whenOf(entry.at)}`}
        </div>
        <RequestRows onOpen={onOpenRequest} turn={turn} />
      </div>
    </>
  );
}
