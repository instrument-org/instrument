import { useAppsBySlug } from "@/client/components/window/apps-by-slug";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { atom, useAtom } from "jotai";
import { useEffect } from "react";
import { toast } from "@/client/lib/toast";

/**
 * The app sign-ins started from the window and not yet finished, by slug,
 * with the standing each app had when its sign-in started. Held by the
 * window rather than by the controls that started one, since opening the
 * sign-in page in the window's browser can take the screen those controls
 * were on.
 */
export const signInsWaitingAtom = atom<ReadonlyMap<string, string | undefined>>(
  new Map(),
);

/**
 * Lands a finished sign-in where it was started: once an app the window is
 * waiting on connects, a toast says so and the app's page comes up, wherever
 * the sign-in page took the window. A sign-in the provider declined or that
 * failed is let go without either.
 */
export function useSignInLanding(openScreen: (href: string) => void) {
  const [waiting, setWaiting] = useAtom(signInsWaitingAtom);
  const apps = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const appsBySlug = useAppsBySlug();

  useEffect(() => {
    if (waiting.size === 0 || !apps.data) {
      return;
    }
    const settled = new Set<string>();
    for (const [slug, from] of waiting) {
      const standing = apps.data.apps.find(
        (app) => app.slug === slug,
      )?.standing;
      if (standing === "connected") {
        settled.add(slug);
        toast.success(`Connected ${appsBySlug.get(slug)?.name ?? slug}`, {
          description: "Instrument can use it in your chats now.",
        });
        openScreen(`/apps/${slug}`);
      } else if (
        standing !== from &&
        (standing === "declined" || standing === "failed")
      ) {
        settled.add(slug);
      }
    }
    if (settled.size > 0) {
      setWaiting(
        (current) =>
          new Map([...current].filter(([slug]) => !settled.has(slug))),
      );
    }
    // Once, as a standing lands; the opener and names are read then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, apps.data]);
}
