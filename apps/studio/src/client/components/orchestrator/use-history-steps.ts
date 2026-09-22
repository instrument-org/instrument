import { useRouter } from "@tanstack/react-router";

import { type BrowserTabsHandle } from "./browser-tabs";
import { type TasksFace } from "./thread-tasks-view";
import { type useWindowTabs } from "./window-tabs";

/**
 * Back and forward for what is on screen, and whether either has anywhere
 * to go: the face over the tab, the guest's own history, the tab's trail of
 * screens, and the visits across the two, in that order.
 */
export function useHistorySteps({
  browser,
  setTasksFace,
  tasksFace,
  windowTabs,
}: {
  /** The window's browser, whose guest keeps the page's own history; null until it is mounted. */
  browser: BrowserTabsHandle | null;
  /** Moves the face over the tab, or puts it away. */
  setTasksFace: (face: TasksFace | undefined) => void;
  /** The face over the tab, while one is up; nothing otherwise. */
  tasksFace: TasksFace | undefined;
  windowTabs: ReturnType<typeof useWindowTabs>;
}) {
  const router = useRouter();
  const { active } = windowTabs;
  const isTasksViewUp = tasksFace !== undefined;
  const isPageOnScreen = active?.kind === "page";
  // Walk the current screen or guest first, then cross into the preceding or
  // following visit in this tab. Guests stay alive while a screen is up.
  // The face over the tab is walked first of all: a task back to the list,
  // the list back to the tab under it, and forward from the list to the
  // task that was left.
  const canGoBack =
    isTasksViewUp ||
    Boolean(active?.past?.length) ||
    (isPageOnScreen ? true : windowTabs.canStepBack);
  const canGoForward = isTasksViewUp
    ? tasksFace.task === undefined && tasksFace.forward !== undefined
    : isPageOnScreen
      ? Boolean(active.future?.length) || (browser?.canGoForward ?? false)
      : Boolean(active?.future?.length) || windowTabs.canStepForward;
  const goBack = () => {
    if (isTasksViewUp) {
      setTasksFace(
        tasksFace.task === undefined
          ? undefined
          : { ...tasksFace, forward: tasksFace.task, task: undefined },
      );
      return;
    }
    if (!active) {
      return;
    }
    if (active.kind === "page") {
      if (browser?.canGoBack) {
        browser.goBack();
      } else {
        windowTabs.stepVisit(-1);
      }
      return;
    }
    const href = windowTabs.step(-1);
    if (href !== undefined) {
      router.history.push(href);
    } else if (windowTabs.stepVisit(-1)) {
      return;
    } else if (active.isOpened) {
      // Nothing behind it, and something else opened it: back is the way out
      // of a tab that exists to show one thing.
      windowTabs.close(active.id);
    }
  };
  const goForward = () => {
    if (isTasksViewUp) {
      if (tasksFace.forward !== undefined) {
        setTasksFace({
          ...tasksFace,
          forward: undefined,
          task: tasksFace.forward,
        });
      }
      return;
    }
    if (active?.kind === "page") {
      if (active.future?.length && !active.pageBackSteps) {
        windowTabs.stepVisit(1);
      } else {
        browser?.goForward();
      }
      return;
    }
    const href = windowTabs.step(1);
    if (href === undefined) {
      windowTabs.stepVisit(1);
    } else {
      router.history.push(href);
    }
  };
  return { canGoBack, canGoForward, goBack, goForward };
}
