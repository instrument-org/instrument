import { useTabsController } from "@/client/hooks/use-tabs-controller";
import { type StudioPath } from "@/shared/studio-path";
import {
  type ParsedLocation,
  type RegisteredRouter,
  type ToOptions,
  useRouter,
} from "@tanstack/react-router";

/**
 * Tab actions for components rendered inside a tab's router (sidebar, routes,
 * command menu, etc.). `addTab` opens a new tab in the renderer-owned model;
 * `navigateTab` navigates the *current* tab via its own router (the per-tab
 * router->atom sync mirrors the new pathname into the tab bar). The unified tab
 * bar, which lives outside any router, uses `useTabsController` directly instead.
 */
export function useTabActions() {
  const router = useRouter();
  const controller = useTabsController();

  const buildUrlPath = <
    TTo extends string | undefined,
    TFrom extends string = string,
    TMaskFrom extends string = TFrom,
    TMaskTo extends string = "",
  >(
    opts: ToOptions<RegisteredRouter, TFrom, TTo, TMaskFrom, TMaskTo>,
  ) => {
    const location = router.buildLocation(
      opts as Parameters<typeof router.buildLocation>[0],
    );
    return locationToAppPath(location);
  };

  // Methods resolve to a Promise so existing fire-and-forget call sites
  // (`void addTab(...)`, `await closeTab(...)`) stay valid even though the
  // renderer-owned actions are synchronous.
  return {
    addTab: <
      TTo extends string | undefined,
      TFrom extends string = string,
      TMaskFrom extends string = TFrom,
      TMaskTo extends string = "",
    >(
      opts: ToOptions<RegisteredRouter, TFrom, TTo, TMaskFrom, TMaskTo>,
      options?: { select?: boolean },
    ) => {
      controller.addTab({
        pathname: buildUrlPath(opts),
        select: options?.select,
      });
      return Promise.resolve();
    },
    closeTab: ({ id }: { id: string }) => {
      controller.closeTab({ id });
      return Promise.resolve();
    },
    navigateTab: <
      TTo extends string | undefined,
      TFrom extends string = string,
      TMaskFrom extends string = TFrom,
      TMaskTo extends string = "",
    >(
      opts: ToOptions<RegisteredRouter, TFrom, TTo, TMaskFrom, TMaskTo>,
    ) => router.navigate(opts as Parameters<typeof router.navigate>[0]),
    reorderTabs: ({ tabIds }: { tabIds: string[] }) => {
      controller.reorderTabs({ ids: tabIds });
      return Promise.resolve();
    },
    selectTab: ({ id }: { id: string }) => {
      controller.selectTab({ id });
      return Promise.resolve();
    },
  };
}

function locationToAppPath(location: ParsedLocation) {
  if (!location.href.startsWith("/")) {
    throw new Error("Invalid location href");
  }
  return location.href as StudioPath;
}
