import { cn } from "@/client/lib/utils";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  createContext,
  type ReactNode,
  use,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { type DebugPageId, getDebugPage } from "./-debug-routes";

/**
 * Where a page puts what it adds to the debug header (after the title, and at
 * the header's end), and the layer a state alone is drawn on.
 */
export const DebugSlotsContext = createContext<{
  alone: HTMLElement | null;
  end: HTMLElement | null;
  trail: HTMLElement | null;
}>({ alone: null, end: null, trail: null });

/** What the address asks of a debug page: a state, drawn alone or not, and a tab. */
function useDebugSearch() {
  return useSearch({ from: "/debug" });
}

/** Puts `children` in the debug header, just after the page's title. */
export function DebugHeaderTrail({ children }: { children: ReactNode }) {
  const { trail } = use(DebugSlotsContext);
  return trail ? createPortal(children, trail) : null;
}

/** Puts `children` at the debug header's end. */
export function DebugHeaderEnd({ children }: { children: ReactNode }) {
  const { end } = use(DebugSlotsContext);
  return end ? createPortal(children, end) : null;
}

/**
 * One state a page draws, at its own address (`?state=<id>`): reached there,
 * the page scrolls to it and marks it a moment; with `alone`, it is drawn by
 * itself on a plain ground over the page, for a screenshot of nothing else.
 */
export function DebugState({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id: string;
}) {
  const { alone, state } = useDebugSearch();
  const slots = use(DebugSlotsContext);
  const ref = useRef<HTMLDivElement>(null);
  const isAsked = state === id;
  const [isMarked, setIsMarked] = useState(false);
  useEffect(() => {
    if (!isAsked || alone) {
      return;
    }
    ref.current?.scrollIntoView({ block: "center" });
    setIsMarked(true);
    const timer = window.setTimeout(() => {
      setIsMarked(false);
    }, 1600);
    return () => {
      window.clearTimeout(timer);
    };
  }, [alone, isAsked]);
  if (isAsked && alone && slots.alone) {
    return createPortal(
      <div data-debug-state={id}>{children}</div>,
      slots.alone,
    );
  }
  return (
    <div
      className={cn(
        "rounded-lg transition-shadow duration-700",
        isMarked && "ring-2 ring-ring ring-offset-4 ring-offset-background",
        className,
      )}
      data-debug-state={id}
      ref={ref}
    >
      {children}
    </div>
  );
}

/**
 * The tab a page with tabs is on: the one the address names, else the one its
 * asked-for state is drawn under, else its first.
 */
export function useDebugTab(pageId: DebugPageId): string {
  const { state, tab } = useDebugSearch();
  const page = getDebugPage(pageId);
  const tabs = page.tabs ?? [];
  const ofState = page.states?.find((each) => each.id === state)?.tab;
  return (
    tabs.find((each) => each.id === tab)?.id ?? ofState ?? tabs[0]?.id ?? ""
  );
}

/** A page's tabs, under the debug header, each at its own `?tab=`. */
export function DebugTabBar({ pageId }: { pageId: DebugPageId }) {
  const navigate = useNavigate();
  const page = getDebugPage(pageId);
  const active = useDebugTab(pageId);
  return (
    <div
      className="flex shrink-0 items-center gap-5 border-b px-8 text-sm"
      role="tablist"
    >
      {(page.tabs ?? []).map((tab) => (
        <button
          aria-selected={tab.id === active}
          className={cn(
            "-mb-px border-b-2 py-2.5",
            tab.id === active
              ? "border-foreground font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
          key={tab.id}
          onClick={() => {
            void navigate({ search: { tab: tab.id }, to: "." });
          }}
          role="tab"
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
