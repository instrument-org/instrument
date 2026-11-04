import { rpcClient } from "@/client/rpc/client";
import { focusManager, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

/**
 * What another window changed reaches this one as it comes to the front. React
 * Query refetches when a page comes back into view, which clicking from one
 * window to another beside it never is, so with other windows open a window's
 * own focus counts as well. Only then: a person coming back from another app
 * has changed nothing here, and every open tab's queries would go again.
 */
export function useRefetchOnWindowSwitch() {
  const others = useQuery(
    rpcClient.window.live.others.experimental_liveOptions(),
  ).data;
  const hasOthers = (others?.length ?? 0) > 0;
  useEffect(() => {
    if (!hasOthers) {
      return;
    }
    const onFocus = () => {
      focusManager.setFocused(true);
    };
    const onBlur = () => {
      focusManager.setFocused(false);
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      focusManager.setFocused(undefined);
    };
  }, [hasOthers]);
}
