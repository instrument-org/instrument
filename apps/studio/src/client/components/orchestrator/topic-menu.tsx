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

import { PickList, PickListAction } from "./pick-list";
import { type Topic } from "./threads";
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
 * Every topic, a check on each that is on, and a new one at the foot: the
 * list behind the filter column's Topics marks and behind a row's tag control
 * alike, so filing and filtering are learned once. A topic's own menu, by
 * right click or the dots at its edge, opens the topic's details, which is
 * where its name, its mark, and its deletion live.
 */
export function TopicPickList({
  chosen,
  onDetails,
  onNew,
  onToggle,
  topics,
}: {
  chosen: ReadonlySet<string>;
  /** Absent where a topic is only being applied, not kept. */
  onDetails?: (topic: Topic) => void;
  onNew: () => void;
  onToggle: (id: string) => void;
  topics: Topic[];
}) {
  const live = topics.filter((topic) => !topic.retired);
  const byId = new Map(live.map((topic) => [topic.id, topic]));
  return (
    <PickList
      chosen={chosen}
      entries={live.map((topic) => ({
        icon: <TopicMark topic={topic} />,
        id: topic.id,
        label: topic.name,
      }))}
      findPlaceholder="Find a topic"
      foot={
        <PickListAction onSelect={onNew}>
          <PlusIcon className="size-3.5 text-muted-foreground" />
          New topic…
        </PickListAction>
      }
      onToggle={onToggle}
      {...(onDetails
        ? {
            rowTrailing: (entry) => {
              const topic = byId.get(entry.id);
              return topic ? (
                <TopicActionsButton
                  className="group-hover/pick:opacity-100"
                  onDetails={onDetails}
                  topic={topic}
                />
              ) : null;
            },
            wrapRow: (entry, row) => {
              const topic = byId.get(entry.id);
              return topic ? (
                <TopicContextMenu onDetails={onDetails} topic={topic}>
                  {row}
                </TopicContextMenu>
              ) : (
                row
              );
            },
          }
        : {})}
    />
  );
}
