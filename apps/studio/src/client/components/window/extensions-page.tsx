import { Button } from "@/client/components/ui/button";
import { Switch } from "@/client/components/ui/switch";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { StorefrontIcon } from "@phosphor-icons/react/Storefront";
import { useId } from "react";

import {
  type BrowserExtension,
  ExtensionIcon,
  isRefused,
  NotConnectedSteps,
  useBrowserExtensions,
  useExtensionActions,
} from "./browser-extensions";

/**
 * The Extensions screen, a window tab of its own the way Chrome's page is:
 * every extension the in-app browser runs, with its words, what to do when
 * its desktop app does not take this browser yet, whether its button is in
 * the browser's row, and Remove; and the way to the Chrome Web Store.
 */
export function ExtensionsPage() {
  const extensions = useBrowserExtensions();
  const actions = useExtensionActions();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 pt-10 pb-8 @xl/app-content:px-6 @5xl/app-content:px-8 @5xl/app-content:pt-14">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold">Extensions</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              They run in the in-app browser, the way they do in Chrome.
            </p>
          </div>
          <Button
            onClick={() => {
              actions.openStore();
            }}
            variant="default"
          >
            <StorefrontIcon />
            Chrome Web Store
          </Button>
        </div>
        <div className="mt-6 divide-y rounded-xl bg-card shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          {extensions.length === 0 ? (
            <p className="px-5 py-12 text-center text-[13px] text-muted-foreground">
              Nothing is installed yet. Anything you add from the Chrome Web
              Store shows up here.
            </p>
          ) : (
            extensions.map((extension) => (
              <ExtensionRow extension={extension} key={extension.id} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ExtensionRow({ extension }: { extension: BrowserExtension }) {
  const actions = useExtensionActions();
  const switchId = useId();
  return (
    <div className="flex items-start gap-4 px-5 py-4">
      <ExtensionIcon className="size-10 shrink-0" extension={extension} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[15px] font-medium">
            {extension.name}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {extension.version}
          </span>
        </div>
        {extension.description && (
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {extension.description}
          </p>
        )}
        {isRefused(extension) && (
          <div className="mt-3 rounded-lg bg-warning-500/10 px-3 py-2.5 ring-1 ring-warning-500/30">
            <div className="flex items-center gap-1.5 text-[13px] font-medium text-warning-700 dark:text-warning-300">
              <WarningCircleIcon className="size-4" />
              Not connected to the {extension.desktopApp?.name} app
            </div>
            <div className="mt-1.5">
              <NotConnectedSteps extension={extension} />
            </div>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            onClick={() => {
              actions.openStorePage(extension);
            }}
            size="xs"
            variant="ghost"
          >
            Details
          </Button>
          <Button
            onClick={() => {
              actions.remove(extension);
            }}
            size="xs"
            variant="ghost"
          >
            Remove
          </Button>
          <span className="flex-1" />
          <label
            className="flex items-center gap-2 text-[13px] text-muted-foreground"
            htmlFor={switchId}
          >
            Show in the row
            <Switch
              checked={extension.pinned}
              id={switchId}
              onCheckedChange={(pinned) => {
                actions.setPinned(extension, pinned);
              }}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
