import { type TabVisit, type WindowTab } from "@/client/atoms/orchestrator";

/** Restore a visit while retaining its browser session or screen trail. */
export function stepTabVisit(
  current: WindowTab,
  direction: -1 | 1,
): undefined | WindowTab {
  const from = direction === -1 ? current.past : current.future;
  const visit = from?.at(-1);
  if (!visit || !from) return undefined;
  return {
    ...visit,
    future:
      direction === 1
        ? from.slice(0, -1)
        : [...(current.future ?? []), visitOf(current)],
    isOpened: current.isOpened,
    past:
      direction === -1
        ? from.slice(0, -1)
        : [...(current.past ?? []), visitOf(current)],
    stripKey: current.stripKey ?? current.id,
  };
}

/** Navigate across the screen/browser boundary without adding a tab. */
export function visitInTab(current: WindowTab, visit: TabVisit): WindowTab {
  const previous =
    current.kind === "screen" && current.trail
      ? {
          ...current,
          trail: current.trail.slice(
            0,
            (current.at ?? current.trail.length - 1) + 1,
          ),
        }
      : current.kind === "page"
        ? { ...current, pageBackSteps: 0 }
        : current;
  return {
    ...visit,
    future: [],
    isOpened: current.isOpened,
    past: [...(current.past ?? []), visitOf(previous)],
    stripKey: current.stripKey ?? current.id,
  };
}

function visitOf(tab: WindowTab): TabVisit {
  const {
    future: _future,
    isOpened: _opened,
    past: _past,
    stripKey: _key,
    ...visit
  } = tab;
  return visit;
}
