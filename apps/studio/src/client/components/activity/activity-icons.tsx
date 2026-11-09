import {
  type ShownAction,
  type TimelineEntry,
} from "@/client/components/activity/activity-timeline";
import {
  FileSystemFolderGlyph,
  FileTypeIcon,
} from "@/client/components/extend/file-system";
import { PageFavicon } from "@/client/components/favicon";
import { ModelMakerIcon } from "@/client/components/model-maker-icon";
import { nameOf } from "@/client/components/window/host-path";
import { PlaceIcon } from "@/client/components/window/place-icons";
import { cn } from "@/client/lib/utils";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { ArrowBendDownRightIcon } from "@phosphor-icons/react/ArrowBendDownRight";
import { ArrowCircleUpIcon } from "@phosphor-icons/react/ArrowCircleUp";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { GearSixIcon } from "@phosphor-icons/react/GearSix";
import { PlugsIcon } from "@phosphor-icons/react/Plugs";
import { ShieldCheckIcon } from "@phosphor-icons/react/ShieldCheck";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";

const GLYPH = "size-4 text-foreground/60";

/**
 * The mark a row wears: a page's icon, a file's by its kind, a folder's,
 * the chat's for an AI row, and a plain glyph for the rest. Several
 * files moved or thrown away together wear the move's or the bin's.
 */
export function EntryIcon({
  className,
  entry,
}: {
  className?: string;
  entry: TimelineEntry;
}) {
  // A turn is a chat's, so it wears the chat's mark; its model's maker
  // stands beside the model's name.
  if (entry.kind === "turn") {
    return <PlaceIcon className={cn(GLYPH, className)} place="chat" />;
  }
  return <ActionIcon action={entry.action} className={className} />;
}

function ActionIcon({
  action,
  className,
}: {
  action: ShownAction;
  className?: string;
}) {
  const file = (path: string) => (
    <FileTypeIcon className={cn("size-4", className)} fileName={nameOf(path)} />
  );
  const glyph = cn(GLYPH, className);
  switch (action.kind) {
    case "page": {
      return (
        <PageFavicon
          className={className}
          hasTooltip={false}
          url={action.url}
        />
      );
    }
    case "file":
    case "open-with":
    case "edit":
    case "download": {
      return file(action.path);
    }
    case "rename": {
      return file(action.to);
    }
    case "folder":
    case "new-folder": {
      return <FileSystemFolderGlyph className={cn("size-4", className)} />;
    }
    case "move":
    case "copy": {
      const [only, ...rest] = action.names;
      if (only !== undefined && rest.length === 0) {
        return file(only);
      }
      return action.kind === "move" ? (
        <ArrowBendDownRightIcon className={glyph} />
      ) : (
        <CopyIcon className={glyph} />
      );
    }
    case "trash": {
      return <TrashIcon className={glyph} />;
    }
    case "chat": {
      return <ChatCircleIcon className={glyph} />;
    }
    case "permission": {
      return <ShieldCheckIcon className={glyph} />;
    }
    case "app": {
      return <PlugsIcon className={glyph} />;
    }
    case "error": {
      return <WarningCircleIcon className={glyph} />;
    }
    case "update": {
      return <ArrowCircleUpIcon className={glyph} />;
    }
    case "setting": {
      return <GearSixIcon className={glyph} />;
    }
    case "screen": {
      return <AppWindowIcon className={glyph} />;
    }
  }
}

/** A model's maker's mark, or nothing for a model no maker is known for. */
export function MakerMark({
  className = "size-3.5",
  maker,
}: {
  className?: string;
  maker: string | undefined;
}) {
  return maker === undefined ? null : (
    <ModelMakerIcon author={maker} className={cn("shrink-0", className)} />
  );
}
