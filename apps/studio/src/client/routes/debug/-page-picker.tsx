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
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { debugGroups, debugPages } from "./-debug-routes";

type Page = (typeof debugPages)[number];

/**
 * Keeps the rows whose text has the typed words in it, where the menu's own
 * fuzzy match would keep any row holding the letters in order.
 */
export function matchesWords(value: string, search: string): number {
  const text = value.toLowerCase();
  return search
    .toLowerCase()
    .split(/\s+/)
    .every((word) => text.includes(word))
    ? 1
    : 0;
}

/** Opens a debug page, or one of its states at its address. */
export function useOpenDebugPage() {
  const navigate = useNavigate();
  return (page: Page, state?: { id: string; tab?: string }) => {
    void navigate({
      search: state ? { state: state.id, tab: state.tab } : {},
      to: page.to,
    });
  };
}

/**
 * The page's title, opening onto every debug page by group, with a search that
 * also reaches the states inside them once something is typed.
 */
export function DebugPagePicker({ current }: { current: Page }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const open = useOpenDebugPage();
  const go = (page: Page, state?: { id: string; tab?: string }) => {
    setIsOpen(false);
    setQuery("");
    open(page, state);
  };
  return (
    <Popover onOpenChange={setIsOpen} open={isOpen}>
      <PopoverTrigger asChild>
        <Button
          className="h-7 gap-1.5 px-1.5 text-sm font-medium"
          variant="ghost"
        >
          {current.label}
          <CaretDownIcon className="size-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-80 flex-col overflow-hidden p-0"
        maxHeight="32rem"
        onWheel={(event) => {
          event.stopPropagation();
        }}
      >
        <Command filter={matchesWords}>
          <CommandInput
            onValueChange={setQuery}
            placeholder="Find a page or a state"
            value={query}
          />
          <CommandList className="min-h-0 flex-1">
            <CommandEmpty>Nothing matches.</CommandEmpty>
            {debugGroups.map((group) => (
              <CommandGroup heading={group.label} key={group.id}>
                {debugPages
                  .filter((page) => page.group === group.id)
                  .map((page) => (
                    <CommandItem
                      key={page.id}
                      onSelect={() => {
                        go(page);
                      }}
                      value={`${page.label} ${page.line}`}
                    >
                      <span className="grid w-4 place-items-center">
                        {page.id === current.id ? (
                          <CheckIcon className="size-3.5" />
                        ) : null}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {page.label}
                      </span>
                    </CommandItem>
                  ))}
              </CommandGroup>
            ))}
            {query.trim() ? <StateItems onPick={go} /> : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Every page's states, as rows naming the page they are on. */
export function StateItems({
  onPick,
}: {
  onPick: (page: Page, state: { id: string; tab?: string }) => void;
}) {
  return (
    <CommandGroup heading="States">
      {debugPages.flatMap((page) =>
        ("states" in page ? page.states : []).map(
          (state: { id: string; label: string; tab?: string }) => (
            <CommandItem
              key={`${page.id}:${state.id}`}
              onSelect={() => {
                onPick(page, state);
              }}
              value={`${state.label} ${page.label} ${page.id}:${state.id}`}
            >
              <span className="min-w-0 flex-1 truncate">{state.label}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {page.label}
              </span>
            </CommandItem>
          ),
        ),
      )}
    </CommandGroup>
  );
}
