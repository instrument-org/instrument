import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  contextMenuComponents,
  dropdownMenuComponents,
  type MenuComponents,
} from "@/client/components/ui/menu-components";
import { ArchiveIcon } from "@phosphor-icons/react/Archive";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { SmileyIcon } from "@phosphor-icons/react/Smiley";

import { PickList, PickListAction } from "./pick-list";
import { type Topic } from "./threads";
import { TopicMark } from "./topic-mark";

/** What can be done to a topic from its own menu. */
export type TopicAction = "mark" | "rename" | "retire";

/**
 * Every topic, a check on each that is on, and a new one at the foot: the
 * list behind the Topics chip and behind a row's tag control alike, so filing
 * and filtering are learned once. A topic's own menu, by right click or the
 * dots at its edge, renames it, re-marks it, or retires it.
 */
export function TopicPickList({
  chosen,
  notes,
  onManage,
  onNew,
  onToggle,
  topics,
}: {
  chosen: ReadonlySet<string>;
  /** A figure per topic id, for how many threads it reaches. */
  notes?: ReadonlyMap<string, number>;
  /** Absent where a topic is only being applied, not kept. */
  onManage?: (action: TopicAction, topic: Topic) => void;
  onNew: () => void;
  onToggle: (id: string) => void;
  topics: Topic[];
}) {
  const live = topics.filter((topic) => !topic.retired);
  const byId = new Map(live.map((topic) => [topic.id, topic]));
  return (
    <PickList
      chosen={chosen}
      entries={live.map((topic) => {
        const count = notes?.get(topic.id);
        return {
          icon: <TopicMark topic={topic} />,
          id: topic.id,
          label: topic.name,
          ...(count === undefined ? {} : { note: String(count) }),
        };
      })}
      findPlaceholder="Find a topic"
      foot={
        <PickListAction onSelect={onNew}>
          <PlusIcon className="size-3.5 text-muted-foreground" />
          New topic…
        </PickListAction>
      }
      onToggle={onToggle}
      {...(onManage
        ? {
            rowTrailing: (entry) => {
              const topic = byId.get(entry.id);
              return topic ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label={`Actions for ${topic.name}`}
                      className="grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground opacity-0 group-hover/pick:opacity-100 hover:bg-foreground/8 hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100"
                      type="button"
                    >
                      <DotsThreeIcon className="size-4" weight="bold" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="right">
                    <TopicMenuItems
                      components={dropdownMenuComponents}
                      onPick={(action) => {
                        onManage(action, topic);
                      }}
                    />
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null;
            },
            wrapRow: (entry, row) => {
              const topic = byId.get(entry.id);
              return topic ? (
                <ContextMenu>
                  <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
                  <ContextMenuContent>
                    <TopicMenuItems
                      components={contextMenuComponents}
                      onPick={(action) => {
                        onManage(action, topic);
                      }}
                    />
                  </ContextMenuContent>
                </ContextMenu>
              ) : (
                row
              );
            },
          }
        : {})}
    />
  );
}

/** The three things a topic's menu offers, drawn under whichever menu asked. */
function TopicMenuItems({
  components: { Item, Separator },
  onPick,
}: {
  components: MenuComponents;
  onPick: (action: TopicAction) => void;
}) {
  return (
    <>
      <Item
        onSelect={() => {
          onPick("rename");
        }}
      >
        <PencilSimpleIcon className="size-4" />
        Rename
      </Item>
      <Item
        onSelect={() => {
          onPick("mark");
        }}
      >
        <SmileyIcon className="size-4" />
        Change mark
      </Item>
      <Separator />
      {/* Retiring keeps every thread filed under it; only the chip goes. */}
      <Item
        onSelect={() => {
          onPick("retire");
        }}
        variant="destructive"
      >
        <ArchiveIcon className="size-4" />
        Retire
      </Item>
    </>
  );
}
