import { Button } from "@/client/components/ui/button";
import { WindowContext } from "@/client/components/window/context";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import { toast } from "@/client/lib/toast";
import { isLinux, isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  BROWSER_EXTENSIONS_SESSION,
  type BrowserExtension,
  CHROME_WEB_STORE_URL,
  chromeWebStorePageOf,
  desktopAppSteps,
} from "@/shared/browser-extensions";
import { SCREEN_ROUTES } from "@/client/components/window/window-href";
import { APP_NAME } from "@instrument-org/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useContext, useEffect } from "react";

export type { BrowserExtension };

/**
 * The extensions the in-app browser runs, kept current, and asked after
 * again each time the window comes to the front, since that is when a person
 * is back from approving this browser in an extension's own app.
 */
export function useBrowserExtensions(): BrowserExtension[] {
  const { data } = useQuery(
    rpcClient.browserExtensions.live.list.experimental_liveOptions(),
  );
  const extensions = data ?? [];
  const { data: windowFocusChanged } = useQuery(
    rpcClient.utils.events.windowFocusChanged.experimental_liveOptions(),
  );
  const hasDesktopApp = extensions.some((extension) => extension.desktopApp);
  useEffect(() => {
    if (hasDesktopApp) {
      void rpcClient.browserExtensions.recheck.call({}).catch(() => {});
    }
  }, [windowFocusChanged, hasDesktopApp]);
  return extensions;
}

/** What the row, the puzzle menu and the Extensions page do to an extension. */
export function useExtensionActions() {
  const appWindow = useContext(WindowContext);
  const openExternalLink = useOpenExternalLink();
  const { mutate: remove } = useMutation(
    rpcClient.browserExtensions.remove.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't remove the extension", { cause: error });
      },
    }),
  );
  const { mutate: setPinned } = useMutation(
    rpcClient.browserExtensions.setPinned.mutationOptions(),
  );
  const { mutate: openDesktopApp } = useMutation(
    rpcClient.browserExtensions.openDesktopApp.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't open the app", { cause: error });
      },
    }),
  );
  // The store's own install button only works in the in-app browser, so
  // its pages open in a tab of the window; a browser with no window (a
  // task's) sends them to the default browser instead.
  const openStore = (url: string = CHROME_WEB_STORE_URL) => {
    if (appWindow) {
      appWindow.openPage(url, { newTab: true });
    } else {
      openExternalLink(url, { addReferral: false });
    }
  };
  return {
    manage: () => {
      appWindow?.openScreen(SCREEN_ROUTES.extensions);
    },
    openDesktopApp: (extension: BrowserExtension) => {
      openDesktopApp({ id: extension.id });
    },
    openStore,
    openStorePage: (extension: BrowserExtension) => {
      openStore(chromeWebStorePageOf(extension.id));
    },
    remove: (extension: BrowserExtension) => {
      remove({ id: extension.id });
    },
    setPinned: (extension: BrowserExtension, pinned: boolean) => {
      setPinned({ id: extension.id, pinned });
    },
  };
}

/** An extension's icon, served by the browser session's `crx:` handler. */
export function ExtensionIcon({
  className,
  extension,
}: {
  className: string;
  extension: BrowserExtension;
}) {
  return (
    <img
      alt=""
      className={className}
      src={`crx://extension-icon/${extension.id}/32/1?partition=${BROWSER_EXTENSIONS_SESSION}`}
    />
  );
}

/** Whether an extension's desktop app has refused this browser, which the person can change in that app. */
export function isRefused(extension: BrowserExtension): boolean {
  return extension.connection === "refused" && extension.desktopApp !== null;
}

/**
 * What to do when an extension's desktop app does not take this browser:
 * the steps in that app, numbered, and a button that opens it, or on a
 * system where the app has no such screen, the way to use the extension on
 * its own.
 */
export function NotConnectedSteps({
  extension,
  tone = "default",
}: {
  extension: BrowserExtension;
  tone?: "default" | "muted";
}) {
  const actions = useExtensionActions();
  const openExternalLink = useOpenExternalLink();
  const appName = extension.desktopApp?.name ?? extension.name;
  const steps = desktopAppSteps(
    appName,
    isMacOS() ? "mac" : isLinux() ? "linux" : "windows",
  );
  const words = tone === "muted" ? "text-muted-foreground" : "";
  const help = extension.desktopApp?.help;
  if (!steps) {
    return (
      <div className={`text-[13px] ${words}`}>
        <p>
          On this computer {appName} cannot be told to trust {APP_NAME}, so the
          extension works on its own: sign in to it from its button.
        </p>
        {help && (
          <Button
            className="mt-2"
            onClick={() => {
              openExternalLink(help, { addReferral: false });
            }}
            size="xs"
            variant="outline"
          >
            Read more
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className={`text-[13px] ${words}`}>
      <p>
        Until it is, the extension asks you to sign in on its own. To connect
        it:
      </p>
      <ol className="mt-2 space-y-1.5">
        {steps.map((step, index) => (
          <li className="flex gap-2.5" key={step}>
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-foreground/8 text-[11px] font-medium text-foreground">
              {index + 1}
            </span>
            <span className="pt-px">{step}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2.5 text-xs text-muted-foreground">
        {APP_NAME} notices on its own once it is added.
      </p>
      <Button
        className="mt-3"
        onClick={() => {
          actions.openDesktopApp(extension);
        }}
        size="xs"
        variant="brand"
      >
        Open {appName}
      </Button>
    </div>
  );
}
