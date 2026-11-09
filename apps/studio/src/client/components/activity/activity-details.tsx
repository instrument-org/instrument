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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
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
import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { XIcon } from "@phosphor-icons/react/X";
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
 * card is: a file's picture large, a header with its mark, name and kind,
 * then a row per fact. A file or folder shows Files' own Info about it;
 * everything else shows what Activity knows, and what was done with it
 * and when is one more row. Its bar puts the way to open it first, and
 * Remove and Close at its end. An AI row lists its requests, each opening what was recorded
 * about it, rather than what was said, which is the chat's to show.
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
      className="flex min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border p-2">
        {request === null ? (
          <>
            <OpenButton label={openLabel(action)} target={target} />
            {filePath ? (
              <Button
                onClick={() => {
                  void showInFolder(filePath, { kind: "file" });
                }}
                size="sm"
                variant="ghost"
              >
                {showInFolderLabel("file")}
              </Button>
            ) : null}
          </>
        ) : (
          <Button
            onClick={() => {
              setRequest(null);
            }}
            size="sm"
            variant="ghost"
          >
            <ArrowLeftIcon />
            Back
          </Button>
        )}
        <span className="flex-1" />
        {onRemove ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Remove from Activity"
                onClick={onRemove}
                size="icon-sm"
                variant="ghost"
              >
                <TrashIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Remove from Activity</TooltipContent>
          </Tooltip>
        ) : null}
        <Button
          aria-label="Close"
          onClick={onClose}
          size="icon-sm"
          variant="ghost"
        >
          <XIcon className="size-4" />
        </Button>
      </div>
      {/* Block flow, so Files' Info rows keep their height rather than
        shrinking to fit the card. */}
      <div className="min-h-0 flex-1 overflow-y-auto scroll-fade-y">
        {request !== null ? (
          <div className="p-4">
            <RequestDetail id={request} />
          </div>
        ) : entry.kind === "turn" ? (
          <TurnDetails entry={entry} onOpenRequest={setRequest} />
        ) : (
          <ActionDetails action={entry.action} at={entry.at} />
        )}
      </div>
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
      variant="default"
    >
      {label}
    </Button>
  );
}

/** A folder's place as Files names it, whole. */
function FolderFact({ label, path }: { label: string; path: string }) {
  return (
    <InfoRow label={label}>
      <FolderTrail path={path} wrap />
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

/**
 * What was done and when, as one more row of the facts: inside a header's
 * own rows, or under Files' Info for a file or folder, as if it were one
 * of its rows.
 */
function WhenRow({
  at,
  did,
  under = false,
}: {
  at: number;
  did: string;
  under?: boolean;
}) {
  const row = <InfoRow label={did}>{whenOf(at)}</InfoRow>;
  return under ? <dl className="-mt-2 px-3 pb-2">{row}</dl> : row;
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
  const own = (sub: string, rows: ReactNode, did: string) => (
    <OwnInfo entry={entry} sub={sub} title={text.title}>
      {rows}
      <WhenRow at={at} did={did} />
    </OwnInfo>
  );
  switch (action.kind) {
    case "file":
    case "open-with":
    case "edit": {
      return (
        <>
          <PathInfo hostPath={action.path} kind="file" />
          <WhenRow at={at} did={text.context || "Opened"} under />
        </>
      );
    }
    case "download": {
      return (
        <>
          <PathInfo hostPath={action.path} kind="file" />
          <dl className="-mt-2 px-3 pb-2">
            {action.url ? <AddressFact label="From" url={action.url} /> : null}
            <InfoRow label="Downloaded">{whenOf(at)}</InfoRow>
          </dl>
        </>
      );
    }
    case "rename": {
      return (
        <>
          <PathInfo hostPath={action.to} kind="file" />
          <dl className="-mt-2 px-3 pb-2">
            <InfoRow label="Was">{nameOf(action.from)}</InfoRow>
            <InfoRow label="Renamed">{whenOf(at)}</InfoRow>
          </dl>
        </>
      );
    }
    case "folder":
    case "new-folder": {
      return (
        <>
          <PathInfo hostPath={action.path} kind="folder" />
          <WhenRow
            at={at}
            did={action.kind === "folder" ? "Opened" : "Made"}
            under
          />
        </>
      );
    }
    case "move":
    case "copy": {
      return own(
        text.context,
        <>
          <InfoRow label="Files">{action.names.map(nameOf).join(", ")}</InfoRow>
          <FolderFact label="From" path={action.from} />
          <FolderFact label="To" path={action.to} />
        </>,
        action.kind === "move" ? "Moved" : "Copied",
      );
    }
    case "trash": {
      const first = action.paths[0];
      return own(
        text.context,
        <>
          <InfoRow label="Files">{action.paths.map(nameOf).join(", ")}</InfoRow>
          {first === undefined ? null : (
            <FolderFact label="From" path={folderOf(first)} />
          )}
        </>,
        "Moved",
      );
    }
    case "page": {
      return (
        <>
          {own(text.context, <AddressFact url={action.url} />, "Visited")}
        </>
      );
    }
    case "permission": {
      return own(
        "Permission",
        <>
          <InfoRow label="Chat">{action.title}</InfoRow>
          {action.path === undefined ? (
            <InfoRow label="App">{action.app}</InfoRow>
          ) : (
            <FolderFact label="Folder" path={action.path} />
          )}
          <InfoRow label="Answer">
            {action.did === "allowed" ? "Allowed" : "Didn't allow"}
          </InfoRow>
        </>,
        "Answered",
      );
    }
    case "error": {
      return own(action.where ? `In ${action.where}` : "Error", null, "Shown");
    }
    case "update": {
      return own(
        "Update",
        <>
          <InfoRow label="From">{action.from}</InfoRow>
          <InfoRow label="To">{action.to}</InfoRow>
        </>,
        "Updated",
      );
    }
    case "setting": {
      return own(
        "Setting",
        <InfoRow label="Changed to">{action.value}</InfoRow>,
        "Changed",
      );
    }
    case "chat": {
      return own("Chat", null, "Opened");
    }
    case "app": {
      return own("App", null, text.context);
    }
    case "screen": {
      return own("Screen", null, "Opened");
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
