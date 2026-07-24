import { useTabActions } from "@/client/hooks/use-tab-actions";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// Surfaces a one-time toast after the app restarts on a newer version. The main
// process hands the bump out exactly once, so claiming it is destructive and has
// to wait until there is somewhere to show it: the main window is created
// hidden, and stays hidden behind the onboarding window until provider setup is
// finished, which an update can land in the middle of.
export function UpdatedToast() {
  const { addTab } = useTabActions();
  // The query result stays cached, so without this a later re-render would fire
  // the toast again from the same data.
  const hasShownRef = useRef(false);
  const isVisible = useDocumentVisible();

  const { data: recentUpdate } = useQuery(
    rpcClient.preferences.getRecentUpdate.queryOptions({ enabled: isVisible }),
  );

  useEffect(() => {
    if (!recentUpdate || hasShownRef.current) {
      return;
    }
    hasShownRef.current = true;

    toast.success(`${APP_NAME} updated to ${recentUpdate.to}`, {
      action: {
        label: "What's new",
        onClick: () => {
          void addTab({ to: "/release-notes" });
        },
      },
    });
  }, [recentUpdate, addTab]);

  return null;
}

function useDocumentVisible() {
  const [isVisible, setIsVisible] = useState(
    () => document.visibilityState === "visible",
  );

  useEffect(() => {
    const onChange = () => {
      setIsVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", onChange);
    return () => {
      document.removeEventListener("visibilitychange", onChange);
    };
  }, []);

  return isVisible;
}
