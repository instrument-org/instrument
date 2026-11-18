import { InternalLink } from "@/client/components/internal-link";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandList,
} from "@/client/components/ui/command";
import { cn } from "@/client/lib/utils";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { type DebugPicture, debugGroups, debugPages } from "./-debug-routes";
import { DebugPageScroller } from "./-page-scroller";
import { StateItems, useOpenDebugPage } from "./-page-picker";
import { DebugHeaderEnd } from "./-shell";

export const Route = createFileRoute("/debug/")({
  component: DebugIndex,
});

/** Every debug page drawn small, by group, with a line on what it is for. */
function DebugIndex() {
  const [query, setQuery] = useState("");
  const open = useOpenDebugPage();
  const words = query.trim().toLowerCase();
  const shown = debugPages.filter(
    (page) =>
      !words || `${page.label} ${page.line}`.toLowerCase().includes(words),
  );
  return (
    <DebugPageScroller>
      <DebugHeaderEnd>
        <Command className="relative w-64 overflow-visible bg-transparent">
          <CommandInput
            onValueChange={setQuery}
            placeholder="Find a page or a state"
            value={query}
            containerClassName="h-8 rounded-lg border px-2"
          />
          {words ? (
            <CommandList className="absolute top-9 right-0 z-30 max-h-80 w-80 rounded-xl bg-popover p-1 shadow-float-md ring-1 ring-black/8">
              <CommandEmpty>No state matches.</CommandEmpty>
              <StateItems onPick={open} />
            </CommandList>
          ) : null}
        </Command>
      </DebugHeaderEnd>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-8">
        {debugGroups.map((group) => {
          const pages = shown.filter((page) => page.group === group.id);
          return pages.length > 0 ? (
            <section className="flex flex-col gap-3" key={group.id}>
              <h2 className="text-xs font-medium text-muted-foreground">
                {group.label}
              </h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">
                {pages.map((page) => (
                  <InternalLink
                    allowOpenNewTab={false}
                    className="group flex flex-col overflow-hidden rounded-xl bg-card shadow-xs ring-1 ring-black/8 hover:ring-black/20 dark:ring-white/10 dark:hover:ring-white/25"
                    key={page.id}
                    to={page.to}
                  >
                    <div className="h-24 overflow-hidden border-b bg-muted/40">
                      <Picture kind={page.picture} />
                    </div>
                    <div className="flex flex-col gap-0.5 px-3 py-2.5">
                      <span className="text-sm font-medium">{page.label}</span>
                      <span className="line-clamp-2 text-xs leading-4 text-muted-foreground">
                        {page.line}
                      </span>
                    </div>
                  </InternalLink>
                ))}
              </div>
            </section>
          ) : null;
        })}
      </div>
    </DebugPageScroller>
  );
}

const bar = "block h-1.5 rounded-full bg-foreground/15";

/** A page drawn small and abstract, different enough to tell apart at a glance. */
function Picture({ kind }: { kind: DebugPicture }) {
  switch (kind) {
    case "card": {
      return (
        <div className="p-3">
          <div className="flex flex-col gap-1.5 rounded-lg bg-card p-2.5 shadow-sm ring-1 ring-black/5">
            <span className={cn(bar, "h-2 w-1/2 bg-foreground/20")} />
            <span className={cn(bar, "w-4/5")} />
            <div className="flex gap-1.5 pt-1">
              <span className="h-3.5 w-10 rounded bg-foreground/15" />
              <span className="h-3.5 w-10 rounded bg-foreground/8" />
            </div>
          </div>
        </div>
      );
    }
    case "chat": {
      return (
        <div className="flex flex-col gap-2 p-3">
          <span className="ml-auto block h-4 w-1/2 rounded-lg bg-brand-200/70" />
          {["w-[90%]", "w-3/4", "w-4/5"].map((width) => (
            <span className={cn(bar, width)} key={width} />
          ))}
          <span className="block h-3 w-2/3 rounded bg-foreground/8" />
        </div>
      );
    }
    case "grid": {
      return (
        <div className="grid grid-cols-8 gap-1.5 p-3">
          {Array.from({ length: 24 }, (_, index) => (
            <span
              className={cn(
                "aspect-square rounded",
                index % 3 === 0 ? "bg-foreground/20" : "bg-foreground/10",
              )}
              key={index}
            />
          ))}
        </div>
      );
    }
    case "mono": {
      return (
        <div className="flex flex-col gap-1.5 p-3">
          {["w-[85%]", "w-3/5", "w-[72%]", "w-2/5", "w-2/3"].map((width) => (
            <span className={cn(bar, width)} key={width} />
          ))}
        </div>
      );
    }
    case "rows": {
      return (
        <div className="flex flex-col gap-2 p-3">
          {["w-[70%]", "w-[55%]", "w-4/5", "w-[45%]"].map((width) => (
            <div className="flex items-center gap-2" key={width}>
              <span className={cn(bar, "h-2", width)} />
              <span className="ml-auto h-4 w-10 rounded bg-foreground/10" />
            </div>
          ))}
        </div>
      );
    }
    case "swatch": {
      return (
        <div className="grid grid-cols-6 gap-1.5 p-3">
          {[
            "bg-gray-200",
            "bg-gray-400",
            "bg-gray-700",
            "bg-brand-200",
            "bg-brand-500",
            "bg-brand-700",
            "bg-error-100",
            "bg-error-500",
            "bg-warning-300",
            "bg-brand-300",
            "bg-brand-600",
            "bg-gray-500",
          ].map((color) => (
            <span className={cn("h-6 rounded", color)} key={color} />
          ))}
        </div>
      );
    }
    case "tiles": {
      return (
        <div className="grid grid-cols-3 gap-2 p-3">
          {Array.from({ length: 6 }, (_, index) => (
            <span
              className="h-9 rounded-md bg-card shadow-sm ring-1 ring-black/5"
              key={index}
            />
          ))}
        </div>
      );
    }
    case "type": {
      return (
        <div className="flex flex-col gap-1.5 p-3">
          <span className="block h-4 w-2/3 rounded bg-foreground/25" />
          <span className="block h-3 w-1/2 rounded bg-foreground/20" />
          <span className={cn(bar, "h-2 w-4/5")} />
          <span className={cn(bar, "w-3/4 bg-foreground/10")} />
        </div>
      );
    }
  }
}
