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
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { scenarios } from "./scenarios";

/** How many of the latest chats the picker lists, newest first. */
const RECENT_CHATS = 100;

/**
 * The name of what is playing, opening onto the latest chats and the scripted
 * scenarios to play instead, with a search over both.
 */
export function ReplayPicker({ name }: { name: string }) {
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
  return (
    <Popover onOpenChange={setIsOpen} open={isOpen}>
      <PopoverTrigger asChild>
        <Button
          className="h-auto w-full justify-between px-2 py-1 text-left text-sm font-medium"
          variant="ghost"
        >
          <span className="min-w-0 truncate">{name}</span>
          <CaretDownIcon className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-96 flex-col overflow-hidden p-0"
        onWheel={(event) => {
          event.stopPropagation();
        }}
      >
        <Command>
          <CommandInput placeholder="Find a chat or scenario" />
          <CommandList className="min-h-0 flex-1">
            <CommandEmpty>Nothing matches.</CommandEmpty>
            <CommandGroup heading="Recent chats">
              {recent.map(({ id, title }) => (
                <CommandItem
                  key={id}
                  onSelect={() => {
                    play({ chat: id });
                  }}
                  value={`${title} ${id}`}
                >
                  <span className="min-w-0 truncate">{title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="Scenarios">
              {scenarios.map((scenario) => (
                <CommandItem
                  key={scenario.id}
                  onSelect={() => {
                    play({ scenario: scenario.id });
                  }}
                  value={`${scenario.name} ${scenario.id}`}
                >
                  <span className="min-w-0 truncate">{scenario.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
