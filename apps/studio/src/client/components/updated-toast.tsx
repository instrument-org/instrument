import { useTabActions } from "@/client/hooks/use-tab-actions";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// Surfaces a one-time toast after the app restarts on a newer version. The main
// process computes the bump once at startup and hands it out to a single caller,
// so the query is gated on visibility: only a visible tab claims (and shows) it,
// preventing the toast from being consumed by a hidden background tab.
export function UpdatedToast() {
  const { addTab } = useTabActions();
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
