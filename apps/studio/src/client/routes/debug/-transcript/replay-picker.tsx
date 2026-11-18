import { Button } from "@/client/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/client/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { chatListOptions } from "@/client/components/window/chat-list-query";
import { byLastUserMessage } from "@/client/components/window/chats";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";

import { DebugHeaderTrail } from "../-shell";
import { scenarios } from "./scenarios";

/** How many of the latest chats the picker lists, newest first. */
const RECENT_CHATS = 100;

type Playing = { chat: string } | { scenario: string };

/**
 * The name of what is playing, in the debug header after the page's title,
 * opening onto the latest chats and the scripted scenarios to play instead,
 * with a search over both. The one playing is checked, and the list opens
 * scrolled to it.
 */
export function ReplayPicker({
  name,
  playing,
}: {
  name: string;
  playing: Playing;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const { data: chats = [] } = useQuery(chatListOptions());
  const recent = byLastUserMessage(chats).slice(0, RECENT_CHATS);
  const play = (
    search: { chat: (typeof chats)[number]["id"] } | { scenario: string },
  ) => {
    setIsOpen(false);
    void navigate({ search, to: "/debug/components/transcript" });
  };
  const playingChat = "chat" in playing ? playing.chat : undefined;
  const playingScenario = "scenario" in playing ? playing.scenario : undefined;
  const current =
    recent.find(({ id }) => id === playingChat) ??
    scenarios.find(({ id }) => id === playingScenario);
  return (
    <DebugHeaderTrail>
      <CaretRightIcon className="size-3 shrink-0 text-muted-foreground/60" />
      <Popover onOpenChange={setIsOpen} open={isOpen}>
        <PopoverTrigger asChild>
          <Button
            className="h-7 max-w-96 min-w-0 gap-1.5 px-1.5 text-sm font-medium"
            variant="ghost"
          >
            <span className="min-w-0 truncate">{name}</span>
            <CaretDownIcon className="size-3 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="flex w-96 flex-col overflow-hidden p-0"
          maxHeight="32rem"
          onWheel={(event) => {
            event.stopPropagation();
          }}
        >
          <Command
            className="min-h-0"
            defaultValue={current && valueOf(current)}
          >
            <CommandInput placeholder="Find a chat or scenario" />
            <CommandList className="max-h-none min-h-0 flex-1">
              <CommandEmpty>Nothing matches.</CommandEmpty>
              <CommandGroup heading="Recent chats">
                {recent.map((chat) => (
                  <PickerItem
                    isCurrent={chat.id === playingChat}
                    key={chat.id}
                    onSelect={() => {
                      play({ chat: chat.id });
                    }}
                    value={valueOf(chat)}
                  >
                    {chat.title}
                  </PickerItem>
                ))}
              </CommandGroup>
              <CommandGroup heading="Scenarios">
                {scenarios.map((scenario) => (
                  <PickerItem
                    isCurrent={scenario.id === playingScenario}
                    key={scenario.id}
                    onSelect={() => {
                      play({ scenario: scenario.id });
                    }}
                    value={valueOf(scenario)}
                  >
                    {scenario.name}
                  </PickerItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </DebugHeaderTrail>
  );
}

/** What the search matches a row on, and what marks the one playing. */
function valueOf(
  entry: { id: string } & ({ name: string } | { title: string }),
) {
  return `${"name" in entry ? entry.name : entry.title} ${entry.id}`;
}

function PickerItem({
  children,
  isCurrent,
  onSelect,
  value,
}: {
  children: ReactNode;
  isCurrent: boolean;
  onSelect: () => void;
  value: string;
}) {
  return (
    <CommandItem
      onSelect={onSelect}
      // The one playing is brought to the middle of the list each time it opens.
      ref={
        isCurrent
          ? (node) => {
              node?.scrollIntoView({ block: "center" });
            }
          : undefined
      }
      value={value}
    >
      <span className="grid w-4 shrink-0 place-items-center">
        {isCurrent ? <CheckIcon className="size-3.5" /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </CommandItem>
  );
}
