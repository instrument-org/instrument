import { InternalLink } from "@/client/components/internal-link";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { debugPageAt } from "./-debug-routes";
import { DebugPagePicker } from "./-page-picker";
import { DebugSlotsContext } from "./-shell";

const searchSchema = z.object({
  /** Draws the asked-for state by itself, for a screenshot of only it. */
  alone: z.boolean().optional(),
  /** A state's id on the page, which the page scrolls to. */
  state: z.string().optional(),
  /** The tab a page with tabs opens on. */
  tab: z.string().optional(),
});

export const Route = createFileRoute("/debug")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Debug pages" }],
  }),
  staticData: { tabIcon: "code" },
  validateSearch: searchSchema,
});

/**
 * Every debug page under one header: the way back to the index, the page's
 * title as a picker of every page, and what the page adds after it.
 */
function RouteComponent() {
  const { pathname } = useLocation();
  const { alone } = Route.useSearch();
  const page = debugPageAt(pathname);
  const [trail, setTrail] = useState<HTMLElement | null>(null);
  const [end, setEnd] = useState<HTMLElement | null>(null);
  const [aloneLayer, setAloneLayer] = useState<HTMLElement | null>(null);

  return (
    <DebugSlotsContext value={{ alone: aloneLayer, end, trail }}>
      <main className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
          {page ? (
            <>
              <InternalLink
                className="rounded-md px-1.5 py-1 text-sm text-muted-foreground hover:text-foreground"
                to="/debug"
              >
                Debug pages
              </InternalLink>
              <CaretRightIcon className="size-3 text-muted-foreground/60" />
              <DebugPagePicker current={page} />
            </>
          ) : (
            <span className="px-1.5 text-sm font-medium">Debug pages</span>
          )}
          <div className="flex min-w-0 items-center gap-1" ref={setTrail} />
          <div className="flex-1" />
          <div className="flex items-center gap-2" ref={setEnd} />
        </header>
        <div className="min-h-0 flex-1">
          <Outlet />
        </div>
        {alone ? (
          <div
            className="absolute inset-0 z-20 grid place-items-center overflow-auto bg-background p-8"
            ref={setAloneLayer}
          />
        ) : null}
      </main>
    </DebugSlotsContext>
  );
}
