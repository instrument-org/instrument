import { settingsModalAtom } from "@/client/atoms/settings-modal";
import { SettingsSection } from "@/client/components/settings/general-section";
import { settingAnchor } from "@/client/components/settings/settings-index";
import { Button } from "@/client/components/ui/button";
import { WindowContext } from "@/client/components/window/context";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import {
  BROWSER_EXTENSIONS_SESSION,
  CHROME_WEB_STORE_URL,
} from "@/shared/browser-extensions";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { useContext } from "react";

/** The Browser page of Settings: the extensions the in-app browser runs. */
export function BrowserSection() {
  return (
    <div className="space-y-4">
      <Extensions />
    </div>
  );
}

/**
 * What is installed, with Remove on each, and the way to the store. The
 * store opens in a tab of the window rather than the default browser, since
 * its install button only works in the in-app browser, so Settings closes to
 * leave the tab in view.
 */
function Extensions() {
  const appWindow = useContext(WindowContext);
  const openExternalLink = useOpenExternalLink();
  const closeSettings = useSetAtom(settingsModalAtom);
  const { data: extensions } = useQuery(
    rpcClient.browserExtensions.live.list.experimental_liveOptions(),
  );
  const { mutate: remove } = useMutation(
    rpcClient.browserExtensions.remove.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't remove the extension", { cause: error });
      },
    }),
  );
  const openStore = () => {
    if (appWindow) {
      appWindow.openPage(CHROME_WEB_STORE_URL, { newTab: true });
      closeSettings(null);
    } else {
      openExternalLink(CHROME_WEB_STORE_URL, { addReferral: false });
    }
  };

  return (
    <section {...settingAnchor("extensions")}>
      <SettingsSection title="Extensions">
        <p className="text-sm text-muted-foreground">
          Extensions run in the in-app browser, the way they do in Chrome.
        </p>
        {extensions && extensions.length > 0 ? (
          <ul className="divide-y overflow-hidden rounded-lg border">
            {extensions.map((extension) => (
              <li
                className="flex min-w-0 items-center gap-3 px-3 py-2"
                key={extension.id}
              >
                <img
                  alt=""
                  className="size-6 shrink-0"
                  src={`crx://extension-icon/${extension.id}/32/1?partition=${BROWSER_EXTENSIONS_SESSION}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {extension.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Version {extension.version}
                  </div>
                </div>
                <Button
                  className="shrink-0"
                  onClick={() => {
                    remove({ id: extension.id });
                  }}
                  size="xs"
                  variant="outline"
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nothing is installed yet.
          </p>
        )}
        <Button onClick={openStore} size="sm" variant="outline">
          Open the Chrome Web Store
        </Button>
      </SettingsSection>
    </section>
  );
}
