import { Skeleton } from "@/client/components/ui/skeleton";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { type Capability, capabilitiesOf } from "./app-capabilities-model";

/** How many of a group show before the rest wait behind "Show more". */
const SHOWN = 6;

/** How long an app's list of actions is reused: it changes only when the app ships a new version. */
const KEPT_MS = 30 * 60_000;

/**
 * What a connected app lets Instrument do, read from the actions the app
 * itself lists: what it can find there and what it can do there, in words.
 * Nothing runs; the list is read once and kept.
 */
export function AppCapabilities({
  name,
  onInspect,
  slug,
}: {
  name: string;
  /** Opens an action with what it answers. */
  onInspect: (action: string) => void;
  slug: string;
}) {
  const tools = useQuery({
    ...rpcClient.apps.inspect.queryOptions({ input: { slug } }),
    gcTime: KEPT_MS,
    staleTime: KEPT_MS,
  });

  if (tools.isError) {
    return (
      <section>
        <p className="text-[13px] text-muted-foreground">
          Couldn’t load {name}’s actions.{" "}
          <button
            className="underline hover:text-foreground disabled:opacity-60"
            disabled={tools.isFetching}
            onClick={() => void tools.refetch()}
            type="button"
          >
            Try again
          </button>
        </p>
      </section>
    );
  }
  const capabilities = tools.data ? capabilitiesOf(tools.data) : undefined;
  if (
    capabilities &&
    capabilities.finds.length === 0 &&
    capabilities.does.length === 0
  ) {
    return (
      <p className="text-[13px] text-muted-foreground">
        {name} doesn’t list any actions.
      </p>
    );
  }

  return (
    <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
      {capabilities ? (
        <>
          {capabilities.finds.length > 0 ? (
            <Group
              items={capabilities.finds}
              label="Look up"
              onOpen={onInspect}
            />
          ) : null}
          {capabilities.does.length > 0 ? (
            <Group
              items={capabilities.does}
              label="Change"
              onOpen={onInspect}
            />
          ) : null}
        </>
      ) : (
        <>
          <SkeletonGroup />
          <SkeletonGroup />
        </>
      )}
    </div>
  );
}

function Group({
  items,
  label,
  onOpen,
}: {
  items: Capability[];
  label: string;
  onOpen: (action: string) => void;
}) {
  const [isAll, setIsAll] = useState(false);
  // Held back only when a few would be left over, since a button that shows
  // one or two more costs as much room as the rows it hides.
  const folds = items.length > SHOWN + 2;
  const shown = folds && !isAll ? items.slice(0, SHOWN) : items;
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-xs font-medium text-foreground">{label}</p>
      {/* One quiet list per group: each row opens the action's details,
          where a look-up that needs nothing filled in runs on the spot. */}
      <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
        {shown.map((item) => (
          <li className="group/row flex min-w-0 items-center" key={item.name}>
            <button
              className="min-w-0 flex-1 px-3 py-2 text-left hover:bg-accent/50"
              onClick={() => {
                onOpen(item.name);
              }}
              title={item.detail}
              type="button"
            >
              <span className="block truncate text-[13px] leading-5 font-medium">
                {item.label}
              </span>
              {item.detail ? (
                <span className="block truncate text-xs leading-4 text-muted-foreground">
                  {item.detail}
                </span>
              ) : null}
            </button>
          </li>
        ))}
        {folds ? (
          <li>
            <button
              className="w-full px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              onClick={() => {
                setIsAll((value) => !value);
              }}
              type="button"
            >
              {isAll ? "Show fewer" : `Show ${items.length - SHOWN} more`}
            </button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function SkeletonGroup() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-3 w-12" />
      {["w-1/2", "w-2/3", "w-2/5", "w-3/5"].map((width) => (
        <div className="flex flex-col gap-1.5" key={width}>
          <Skeleton className={`h-3.5 ${width}`} />
          <Skeleton className="h-3 w-5/6" />
        </div>
      ))}
    </div>
  );
}
