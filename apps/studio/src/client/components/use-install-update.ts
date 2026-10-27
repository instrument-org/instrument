import { rpcClient } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

/**
 * Installs the staged update, and says whether the app is restarting for it.
 * Restarting from the press on, so the check the main process makes first
 * shows as the restart it leads to rather than a flash of "Checking", and
 * until the request comes back with anything but a quit.
 */
export function useInstallUpdate() {
  const [restarting, setRestarting] = useState(false);
  const install = async () => {
    setRestarting(true);
    const outcome = await safe(rpcClient.preferences.quitAndInstall.call());
    const [error, result] = outcome;
    if (error || result.type !== "installing") {
      setRestarting(false);
    }
    return outcome;
  };
  return { install, restarting };
}

/**
 * Whether a status is one a restart the person started shows over: the build
 * still staged, the check before installing, and the install itself. A
 * download that supersedes the staged build shows as itself.
 */
export function showsAsRestarting(
  restarting: boolean,
  status: string | undefined,
) {
  return (
    restarting &&
    (status === "checking" ||
      status === "downloaded" ||
      status === "installing")
  );
}

/**
 * Whether installing will ask for the person's password, which a Linux package
 * does, so the button that starts it can say so first.
 */
export function useInstallAsksForPassword() {
  const { data } = useQuery(
    rpcClient.updates.installAsksForPassword.queryOptions({
      staleTime: Infinity,
    }),
  );
  return data ?? false;
}
