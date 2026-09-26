import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { rpcClient } from "@/client/rpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { useFileOpenTarget } from "./use-file-open-target";
import { useOpenFile } from "./use-open-file";

/** What leaves Instrument for another app: a file on the computer, or a web address. */
export type OpenInAppTarget = { hostPath: string } | { url: string };

/** A page's address as something another app can open: a file for a local page, the address itself for a site, nothing for anything else. */
export function openInAppTargetOfUrl(
  url: string | undefined,
): OpenInAppTarget | undefined {
  if (!url) {
    return;
  }
  const hostPath = hostPathOfFileUrl(url);
  if (hostPath !== undefined) {
    return { hostPath };
  }
  return /^https?:/i.test(url) ? { url } : undefined;
}

/**
 * The app a file or a web page would open in outside Instrument, and the way
 * there. A file goes to the app the computer opens its type with; a web page
 * to the default browser. `appName` is null where the platform cannot name
 * the app, which still opens: the label then says where it goes in general.
 */
export function useOpenInApp(target: OpenInAppTarget | undefined) {
  const file = target && "hostPath" in target ? target : undefined;
  const url = target && "url" in target ? target.url : undefined;
  const fileTarget = useFileOpenTarget(file);
  const browser = useQuery(
    rpcClient.utils.browserOpenTarget.queryOptions({
      enabled: url !== undefined,
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      staleTime: Number.POSITIVE_INFINITY,
    }),
  );
  const openFile = useOpenFile();
  const openLink = useMutation(
    rpcClient.utils.openExternalLink.mutationOptions({
      onError: (error) => {
        toast.error("Failed to open the page", {
          description: error.message,
        });
      },
    }),
  );

  if (file) {
    return {
      appName: fileTarget.appName,
      iconUrl: fileTarget.appName ? fileTarget.iconUrl : null,
      isPending: fileTarget.isPending,
      label: fileTarget.appName
        ? `Open in ${fileTarget.appName}`
        : "Open in default app",
      open: () => {
        openFile(file);
      },
    };
  }
  const appName = browser.data?.appName ?? null;
  return {
    appName,
    iconUrl: appName ? (browser.data?.iconUrl ?? null) : null,
    isPending: url !== undefined && browser.isPending,
    label: appName ? `Open in ${appName}` : "Open in browser",
    open: () => {
      if (url !== undefined) {
        openLink.mutate({ url });
      }
    },
  };
}
