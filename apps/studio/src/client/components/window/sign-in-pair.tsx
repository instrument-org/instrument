import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { type SignInDestination } from "@/client/components/window/use-sign-in-landing";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";

/** What the button that signs in on this window's own page says. */
export const SIGN_IN_HERE = "Sign in here";

/** The computer's default browser, by name and icon where it can say. */
export function useDefaultBrowser() {
  return useQuery(
    rpcClient.utils.browserOpenTarget.queryOptions({
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      staleTime: Number.POSITIVE_INFINITY,
    }),
  );
}

/**
 * The pair a sign-in offers: the user's own browser, then another way in.
 * While one waits it stays in its place, dimmed, and the other's place is
 * Cancel, at the width of the button it stands in for, so a second press
 * lands on nothing.
 */
export function SignInPair({
  busy = false,
  hereLabel = SIGN_IN_HERE,
  lit,
  onCancel,
  onStart,
  other,
  verb,
  waitingIn,
}: {
  busy?: boolean;
  hereLabel?: string;
  /** Which is lit as the one to press; `true` is the user's own browser. */
  lit: "here" | boolean;
  onCancel: () => void;
  onStart: (where: SignInDestination) => void;
  /** The second way in, where it is not the same sign-in here. */
  other?: ReactNode;
  verb: string;
  waitingIn: SignInDestination | undefined;
}) {
  const browser = useDefaultBrowser();
  // Named only when the computer says which browser is the default, so the
  // button never promises the wrong one.
  const ownBrowser = browser.data?.appName
    ? `${verb} with ${browser.data.appName}`
    : `${verb} with your browser`;
  const cancel = (standsFor: ReactNode) => (
    <Button
      className="relative text-foreground"
      onClick={onCancel}
      size="sm"
      variant="outline"
    >
      <span
        aria-hidden
        className="invisible inline-flex items-center gap-[inherit]"
      >
        {standsFor}
      </span>
      <span className="absolute inset-0 flex items-center justify-center">
        Cancel
      </span>
    </Button>
  );
  const inBrowser = (
    <>
      {/* The spinner takes the icon's box, so the button keeps its width. */}
      {!browser.data?.iconUrl ? null : waitingIn === "external" ? (
        <span className="grid size-4 shrink-0 place-items-center">
          <Spinner className="size-3.5" delay={0} />
        </span>
      ) : (
        <img
          alt=""
          className="size-4 shrink-0"
          draggable={false}
          src={browser.data.iconUrl}
        />
      )}
      {ownBrowser}
    </>
  );
  return (
    <>
      {waitingIn === "app" ? (
        cancel(inBrowser)
      ) : (
        <Button
          className={lit === true ? undefined : "text-foreground"}
          disabled={busy || waitingIn !== undefined}
          onClick={() => {
            onStart("external");
          }}
          size="sm"
          variant={lit === true ? "brand" : "outline"}
        >
          {inBrowser}
        </Button>
      )}
      {waitingIn === "external"
        ? cancel(SIGN_IN_HERE)
        : (other ?? (
            <Button
              className={lit === "here" ? undefined : "text-foreground"}
              disabled={busy || waitingIn !== undefined}
              onClick={() => {
                onStart("app");
              }}
              size="sm"
              variant={lit === "here" ? "brand" : "outline"}
            >
              {hereLabel}
            </Button>
          ))}
    </>
  );
}
