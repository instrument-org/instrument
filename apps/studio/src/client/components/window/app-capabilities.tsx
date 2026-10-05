import { Skeleton } from "@/client/components/ui/skeleton";
import { PageSection } from "@/client/components/window/page-section";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { rpcClient } from "@/client/rpc/client";
import { ListMagnifyingGlassIcon } from "@phosphor-icons/react/ListMagnifyingGlass";
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
  onAsk,
  onInspect,
  slug,
}: {
  name: string;
  /** Opens a draft that starts the request, for the person to finish. */
  onAsk: (action: string) => void;
  /** Opens every action with what each one answers. */
  onInspect: () => void;
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
    <div className="mt-10">
      <PageSection
        action={{
          icon: <ListMagnifyingGlassIcon className="size-3.5" />,
          label: "See every action",
          onPress: onInspect,
        }}
        title={`${name} actions`}
      >
        <div className="grid gap-x-10 gap-y-6 @2xl/app-content:grid-cols-2">
          {capabilities ? (
            <>
              {capabilities.finds.length > 0 ? (
                <Group
                  items={capabilities.finds}
                  label="Look up"
                  onAsk={onAsk}
                />
              ) : null}
              {capabilities.does.length > 0 ? (
                <Group items={capabilities.does} label="Change" onAsk={onAsk} />
              ) : null}
            </>
          ) : (
            <>
              <SkeletonGroup />
              <SkeletonGroup />
            </>
          )}
        </div>
      </PageSection>
    </div>
  );
}

function Group({
  items,
  label,
  onAsk,
}: {
  items: Capability[];
  label: string;
  onAsk: (action: string) => void;
}) {
  const [isAll, setIsAll] = useState(false);
  const shown = isAll ? items : items.slice(0, SHOWN);
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-xs font-medium text-foreground">{label}</p>
      <ul className="flex flex-col gap-2">
        {shown.map((item) => (
          <li
            className="group/action flex min-w-0 items-start gap-2 text-[13px] leading-5"
            key={item.name}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate">{item.label}</p>
              {item.detail ? (
                <p className="truncate text-xs leading-4 text-muted-foreground">
                  {item.detail}
                </p>
              ) : null}
            </div>
            {/* Under the pointer, the way to start a request with it: a
                draft that names the action and leaves the rest to say. */}
            <button
              aria-label={`Ask Instrument to use ${item.label}`}
              className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md opacity-0 transition-opacity group-hover/action:opacity-100 hover:bg-accent focus-visible:opacity-100"
              onClick={() => {
                onAsk(item.label);
              }}
              title={`Ask Instrument to use ${item.label}`}
              type="button"
            >
              <InstrumentGlyph className="size-3.5 text-brand-600 dark:text-brand-400" />
            </button>
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
