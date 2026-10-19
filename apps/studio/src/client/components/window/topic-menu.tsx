import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { cn } from "@/client/lib/utils";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { InfoIcon } from "@phosphor-icons/react/Info";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { type ReactNode } from "react";

import { type Topic } from "./chats";
import { PickList, PickListAction } from "./pick-list";
import { TopicMark } from "./topic-mark";

/**
 * The dots at the edge of a row that stands for a topic, opening the topic's
 * own menu. Invisible until the caller's hover class, focus, or the open menu
 * shows them, so a list of topics is not a list of dots.
 */
export function TopicActionsButton({
  className,
  onDetails,
  topic,
}: {
  className?: string;
  onDetails: (topic: Topic) => void;
  topic: Topic;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`Actions for ${topic.name}`}
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground opacity-0 hover:bg-foreground/8 hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100",
            className,
          )}
          type="button"
        >
          <DotsThreeIcon className="size-4" weight="bold" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="right">
        <DropdownMenuItem
          onSelect={() => {
            onDetails(topic);
          }}
        >
          <InfoIcon className="size-4" />
          View topic details
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A topic's own menu on right click, around whatever row stands for the topic. */
export function TopicContextMenu({
  children,
  onDetails,
  topic,
}: {
  children: ReactNode;
  onDetails: (topic: Topic) => void;
  topic: Topic;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() => {
            onDetails(topic);
          }}
        >
          <InfoIcon className="size-4" />
          View topic details
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * Every topic, a check on the one that is on, and a new one at the foot: the
 * list behind a row's tag control, a draft's topic and a chat's head alike,
 * so filing is learned once. It opens on a find field whose words the foot
 * offers to make into a topic.
 */
export function TopicPickList({
  chosen,
  onNew,
  onToggle,
  topics,
}: {
  chosen: ReadonlySet<string>;
  /** Makes a topic, named for what was typed in the find field when anything was. */
  onNew: (name: string) => void;
  onToggle: (id: string) => void;
  topics: Topic[];
}) {
  const live = topics.filter((topic) => !topic.retired);
  return (
    <PickList
      chosen={chosen}
      entries={live.map((topic) => ({
        icon: <TopicMark topic={topic} />,
        id: topic.id,
        label: topic.name,
      }))}
      findPlaceholder="Find or make a topic"
      foot={(find) => (
        <PickListAction
          onSelect={() => {
            onNew(find);
          }}
        >
          <PlusIcon className="size-3.5 text-muted-foreground" />
          <span className="min-w-0 truncate">
            {find ? `New topic “${find}”…` : "New topic…"}
          </span>
        </PickListAction>
      )}
      onToggle={onToggle}
    />
  );
}
