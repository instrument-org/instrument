import { Skeleton } from "@/client/components/ui/skeleton";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { type Capability, capabilitiesOf } from "./app-capabilities-model";

/** How many of a group show before the rest wait behind "Show all". */
const SHOWN = 8;

/** How long an app's list of actions is reused: it changes only when the app ships a new version. */
const KEPT_MS = 30 * 60_000;

/**
 * What a connected app lets Instrument do, read from the actions the app
 * itself lists: what it can find there and what it can do there, in words.
 * Nothing runs; the list is read once and kept.
 */
export function AppCapabilities({
  name,
  slug,
}: {
  name: string;
  slug: string;
}) {
  const tools = useQuery({
    ...rpcClient.apps.inspect.queryOptions({ input: { slug } }),
    gcTime: KEPT_MS,
    staleTime: KEPT_MS,
  });

  if (tools.isError) {
    return (
      <section className="mt-8">
        <p className="text-[13px] text-muted-foreground">
          {name} didn’t say what it lets Instrument do.{" "}
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
    return null;
  }

  return (
    <section className="mt-8">
      <p className="mb-3 text-[13px] font-medium text-muted-foreground">
        What Instrument can do in {name}
      </p>
      <div className="grid gap-x-10 gap-y-6 @2xl/app-content:grid-cols-2">
        {capabilities ? (
          <>
            {capabilities.finds.length > 0 ? (
              <Group items={capabilities.finds} label="Finds" />
            ) : null}
            {capabilities.does.length > 0 ? (
              <Group items={capabilities.does} label="Does" />
            ) : null}
          </>
        ) : (
          <>
            <SkeletonGroup />
            <SkeletonGroup />
          </>
        )}
      </div>
    </section>
  );
}

function Group({ items, label }: { items: Capability[]; label: string }) {
  const [isAll, setIsAll] = useState(false);
  const shown = isAll ? items : items.slice(0, SHOWN);
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-xs font-medium text-foreground">{label}</p>
      <ul className="flex flex-col gap-2">
        {shown.map((item) => (
          <li className="min-w-0 text-[13px] leading-5" key={item.name}>
            <p className="truncate">{item.label}</p>
            {item.detail ? (
              <p className="truncate text-xs leading-4 text-muted-foreground">
                {item.detail}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {items.length > SHOWN ? (
        <button
          className="mt-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => {
            setIsAll((value) => !value);
          }}
          type="button"
        >
          {isAll ? "Show fewer" : `Show all ${items.length}`}
        </button>
      ) : null}
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
