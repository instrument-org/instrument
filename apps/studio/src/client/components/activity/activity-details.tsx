import {
  EntryIcon,
  MakerMark,
} from "@/client/components/activity/activity-icons";
import {
  RequestDetail,
  RequestRows,
  turnDuration,
  useModelName,
} from "@/client/components/activity/activity-requests";
import {
  actionText,
  placeOf,
  type ShownAction,
  type TimelineEntry,
  turnParts,
  turnPlaceOf,
} from "@/client/components/activity/activity-timeline";
import { CopyButton } from "@/client/components/copy-button";
import { FolderTrail } from "@/client/components/folder-trail";
import { Button } from "@/client/components/ui/button";
import {
  InfoFrame,
  InfoRow,
  PathInfo,
} from "@/client/components/window/file-info";
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

/** What the open button says for a row, by where it goes. */
function openLabel(action: ShownAction | undefined) {
  switch (action?.kind) {
    case "setting": {
      return "Show in Settings";
    }
    case "screen": {
      return action.name.startsWith("Settings") ? "Show in Settings" : "Open";
    }
    case "update": {
      return "What's New";
    }
    case "app": {
      return "Open Apps";
    }
    default: {
      return "Open";
    }
  }
}

/** The file a row is about, which Show in Folder shows. */
function fileOf(action: ShownAction): string | undefined {
  switch (action.kind) {
    case "file":
    case "open-with":
    case "edit":
    case "download": {
      return action.path;
    }
    case "rename": {
      return action.to;
    }
    default: {
      return undefined;
    }
  }
}

/**
 * The details of the row picked, beside the list, drawn the way Files' Info
 * card is: a header with its mark, name and kind, then a row per fact. A
 * file or folder shows Files' own Info about it; everything else shows
 * what Activity knows. Under the facts are the other times it was opened,
 * and at the foot the ways to open it and to take it out of Activity. An
 * AI row lists its requests, each opening what was recorded about it,
 * rather than what was said, which is the chat's to show.
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
  const action = entry.kind === "action" ? entry.action : undefined;
  const target =
    entry.kind === "turn" ? turnPlaceOf(entry.turn) : placeOf(entry.action);
  const filePath = action ? fileOf(action) : undefined;
  return (
    <aside
      aria-label="Details"
      className="relative flex min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border bg-card"
    >
      {request === null ? (
        <>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {entry.kind === "turn" ? (
              <TurnDetails entry={entry} onOpenRequest={setRequest} />
            ) : (
              <ActionDetails action={entry.action} at={entry.at} />
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border p-3">
            <OpenButton label={openLabel(action)} target={target} />
            {filePath ? (
              <Button
                onClick={() => {
                  void showInFolder(filePath, { kind: "file" });
                }}
                size="sm"
                variant="outline"
              >
                {showInFolderLabel("file")}
              </Button>
            ) : null}
            <span className="flex-1" />
            {onRemove ? (
              <Button onClick={onRemove} size="sm" variant="ghost-destructive">
                Remove from Activity
              </Button>
            ) : null}
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <RequestDetail
            id={request}
            onBack={() => {
              setRequest(null);
            }}
          />
        </div>
      )}
      <button
        aria-label="Close"
        className="absolute top-2 right-2 grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={onClose}
        type="button"
      >
        <XIcon className="size-3.5" />
      </button>
    </aside>
  );
}

/** Open, where the row's place opens; a Cmd-click opens it in a tab of its own. */
function OpenButton({
  label,
  target,
}: {
  label: string;
  target: OpenTarget | undefined;
}) {
  const gesturesFor = useGesturesFor();
  const gestures = target ? gesturesFor(target) : undefined;
  if (!gestures?.primary) {
    return null;
  }
  return (
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
      {label}
    </Button>
  );
}

/** A folder's place as Files names it, one line that folds in its middle. */
function FolderFact({ label, path }: { label: string; path: string }) {
  return (
    <InfoRow label={label}>
      <FolderTrail path={path} />
    </InfoRow>
  );
}

/** A page's address in full, to read and copy. */
function AddressFact({
  label = "Address",
  url,
}: {
  label?: string;
  url: string;
}) {
  return (
    <InfoRow label={label}>
      <span className="flex items-start gap-1">
        <span className="min-w-0 flex-1 break-all">{url}</span>
        <CopyButton
          className="-mt-0.5 shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
          label="Copy address"
          onCopy={() => navigator.clipboard.writeText(url)}
          tooltip="Copy address"
        />
      </span>
    </InfoRow>
  );
}

/** A section under the facts, with its own small head. */
function Section({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="border-t border-border px-3 py-2">
      <div className="py-1 text-xs font-medium text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

/** When the row happened, and the other times the person opened what it names, newest first. */
function Times({
  at,
  did,
  of,
}: {
  at: number;
  did: string;
  of?: { download: true; path: string } | { path: string } | { url: string };
}) {
  const { data } = useQuery(
    rpcClient.activity.openings.queryOptions({ input: of ?? skipToken }),
  );
  // The row's own opening is among them, and the rest are the others.
  const others = (data ?? [])
    .filter((each) => Date.parse(each.at) !== at)
    .slice(0, 8);
  return (
    <Section title="In Activity">
      <dl>
        <InfoRow label={did}>{whenOf(at)}</InfoRow>
        {others.map((each) => (
          <InfoRow
            key={`${each.kind}:${each.at}`}
            label={
              each.kind === "open-with"
                ? `Opened in ${each.app ?? "another app"}`
                : each.kind === "download"
                  ? "Downloaded"
                  : each.kind === "page"
                    ? "Visited"
                    : "Opened"
            }
          >
            {whenOf(Date.parse(each.at))}
          </InfoRow>
        ))}
      </dl>
    </Section>
  );
}

/** A row that is not a file or folder, under a header of its own mark, name and what it was. */
function OwnInfo({
  children,
  entry,
  sub,
  title,
}: {
  children?: ReactNode;
  entry: TimelineEntry;
  sub: string;
  title: string;
}) {
  return (
    <InfoFrame
      name={title}
      picture={<EntryIcon className="size-7" entry={entry} />}
      sub={sub}
    >
      {children}
    </InfoFrame>
  );
}

/** What one of the person's own rows names, where it is, and what else is known about it. */
function ActionDetails({ action, at }: { action: ShownAction; at: number }) {
  const words = { trash: osConventions().trash };
  const text = actionText(action, words);
  const entry: TimelineEntry = { action, at, id: "", kind: "action" };
  switch (action.kind) {
    case "file":
    case "open-with":
    case "edit": {
      return (
        <>
          <PathInfo hostPath={action.path} kind="file" />
          <Times
            at={at}
            did={text.context || "Opened"}
            of={{ path: action.path }}
          />
        </>
      );
    }
    case "download": {
      return (
        <>
          <PathInfo hostPath={action.path} kind="file" />
          {action.url ? (
            <div className="border-t border-border px-3 py-2">
              <dl>
                <AddressFact label="From" url={action.url} />
              </dl>
            </div>
          ) : null}
          <Times
            at={at}
            did="Downloaded"
            of={{ download: true, path: action.path }}
          />
        </>
      );
    }
    case "rename": {
      return (
        <>
          <PathInfo hostPath={action.to} kind="file" />
          <Times at={at} did={`Renamed from ${nameOf(action.from)}`} />
        </>
      );
    }
    case "folder":
    case "new-folder": {
      return (
        <>
          <PathInfo hostPath={action.path} kind="folder" />
          <Times at={at} did={action.kind === "folder" ? "Opened" : "Made"} />
        </>
      );
    }
    case "move":
    case "copy": {
      return (
        <>
          <OwnInfo entry={entry} sub={text.context} title={text.title}>
            <InfoRow label="Files">
              {action.names.map(nameOf).join(", ")}
            </InfoRow>
            <FolderFact label="From" path={action.from} />
            <FolderFact label="To" path={action.to} />
          </OwnInfo>
          <Times at={at} did={action.kind === "move" ? "Moved" : "Copied"} />
        </>
      );
    }
    case "trash": {
      const first = action.paths[0];
      return (
        <>
          <OwnInfo entry={entry} sub={text.context} title={text.title}>
            <InfoRow label="Files">
              {action.paths.map(nameOf).join(", ")}
            </InfoRow>
            {first === undefined ? null : (
              <FolderFact label="From" path={folderOf(first)} />
            )}
          </OwnInfo>
          <Times at={at} did="Moved" />
        </>
      );
    }
    case "page": {
      return (
        <>
          <OwnInfo entry={entry} sub={text.context} title={text.title}>
            <AddressFact url={action.url} />
          </OwnInfo>
          <Times at={at} did="Visited" of={{ url: action.url }} />
        </>
      );
    }
    case "permission": {
      return (
        <>
          <OwnInfo entry={entry} sub="Permission" title={text.title}>
            <InfoRow label="Chat">{action.title}</InfoRow>
            {action.path === undefined ? (
              <InfoRow label="App">{action.app}</InfoRow>
            ) : (
              <FolderFact label="Folder" path={action.path} />
            )}
            <InfoRow label="Answer">
              {action.did === "allowed" ? "Allowed" : "Didn't allow"}
            </InfoRow>
          </OwnInfo>
          <Times at={at} did="Answered" />
        </>
      );
    }
    case "error": {
      return (
        <>
          <OwnInfo
            entry={entry}
            sub={action.where ? `In ${action.where}` : "Error"}
            title="Error"
          >
            <InfoRow label="Said">{action.message}</InfoRow>
          </OwnInfo>
          <Times at={at} did="Shown" />
        </>
      );
    }
    case "update": {
      return (
        <>
          <OwnInfo entry={entry} sub="Update" title={text.title}>
            <InfoRow label="From">{action.from}</InfoRow>
            <InfoRow label="To">{action.to}</InfoRow>
          </OwnInfo>
          <Times at={at} did="Updated" />
        </>
      );
    }
    case "setting": {
      return (
        <>
          <OwnInfo entry={entry} sub="Setting" title={action.name}>
            <InfoRow label="Changed to">{action.value}</InfoRow>
          </OwnInfo>
          <Times at={at} did="Changed" />
        </>
      );
    }
    case "chat": {
      return (
        <>
          <OwnInfo entry={entry} sub="Chat" title={text.title} />
          <Times at={at} did="Opened" />
        </>
      );
    }
    case "app": {
      return (
        <>
          <OwnInfo entry={entry} sub="App" title={text.title} />
          <Times at={at} did={text.context} />
        </>
      );
    }
    case "screen": {
      return (
        <>
          <OwnInfo entry={entry} sub="Screen" title={text.title} />
          <Times at={at} did="Opened" />
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
  const parts = turnParts(turn, modelName);
  const took = turnDuration(turn);
  return (
    <>
      <OwnInfo
        entry={entry}
        sub={parts.did ?? "AI requests"}
        title={parts.title}
      >
        {parts.model ? (
          <InfoRow label="Model">
            <span className="flex min-w-0 items-center gap-1.5">
              <MakerMark maker={parts.maker} />
              <span className="truncate">{parts.model}</span>
            </span>
          </InfoRow>
        ) : null}
        <InfoRow label="Requests">{parts.requests}</InfoRow>
        {took ? <InfoRow label="Took">{took}</InfoRow> : null}
        <InfoRow label="When">{whenOf(entry.at)}</InfoRow>
      </OwnInfo>
      <Section title="Requests">
        <RequestRows onOpen={onOpenRequest} turn={turn} />
      </Section>
    </>
  );
}
