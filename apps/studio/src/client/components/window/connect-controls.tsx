import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { cn, osConventions } from "@/client/lib/utils";
import { Destination } from "@/client/components/window/connect-destination";
import { KeyForm } from "@/client/components/window/key-form";
import { WindowContext } from "@/client/components/window/context";
import {
  type SignInDestination,
  signInsWaitingAtom,
} from "@/client/components/window/use-sign-in-landing";
import { useSiteSignIn } from "@/client/components/window/site-sign-in";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import { rpcClient } from "@/client/rpc/client";
import { type ChatId } from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { type ReactNode, useContext } from "react";
import { toast } from "@/client/lib/toast";

/** A card row's pair of buttons, ending where the row does; in a narrow chat they go under the name, half the row each. */
const ROW_BUTTONS =
  "flex shrink-0 items-center gap-1.5 @max-md/transcript:w-full @max-md/transcript:flex-wrap @max-md/transcript:*:flex-1";

/**
 * A web app's row buttons. In a narrow chat they go under the name at the
 * row's width, the last first, so the button that shows the site stays
 * where the one that opened it was pressed.
 */
const SITE_ROW_BUTTONS =
  "flex shrink-0 items-center gap-1.5 @max-md/transcript:w-full @max-md/transcript:flex-col-reverse @max-md/transcript:items-stretch";

/** What the button that signs in on the app's own site says. */
const SIGN_IN_ON_SITE = "Sign in here";

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
 * The one thing only the user can give an app, wherever it is asked for: a
 * sign-in, or a key. The card in the conversation, the directory row, and the
 * app's page all draw these same controls, so an app the agent set up gets
 * finished by a click on whichever of them is in front of the user, with no
 * second trip through the agent. Plain buttons, not the mark: nothing here
 * sends the agent a word.
 *
 * A sign-in leads with the user's own browser, where they are most likely
 * already signed in and have their passkeys, saved passwords and extensions;
 * the window's own browser is offered beside it. Either one connects the app,
 * since the answer comes back to the same callback. While one waits, the
 * button pressed stays where it is, dimmed, and Cancel takes the other's
 * place, so a second press lands on nothing. A key
 * goes straight to the encrypted store and is tested on arrival. A web app
 * signs in on its own site in the window's browser, and the user's word that
 * they did is what connects it: Done on the bar over the site
 * (`SiteSignInBar`), or here. The button that shows the site again stands
 * where the one that opened it stood.
 */
export function ConnectControls({
  alongside,
  askedIn,
  compact = false,
  describesDestination = true,
  kind,
  label,
  name,
  runs,
  slug,
}: {
  /** One more control at the end of the row: the app's page puts its way to ask the agent here. */
  alongside?: ReactNode;
  /** For a card in a chat, the chat, which hears what the user does here even after the card stopped waiting. */
  askedIn?: ChatId;
  /**
   * For a row of the card in a chat, the buttons that fit in the row: one
   * for a web app until its site is open, two for a sign-in. `primary` lights
   * the first as the one to press next. `failure` is how the app's last sign-in ended: another try
   * is offered in the user's own browser beside the app's site, since the
   * site is the one way in that is really different, and a refusal leaves only
   * the site, since the same sign-in meets the same refusal. `hasSite` is
   * whether there is one: an app on this machine has none, so its other way
   * is the same sign-in here, and a refusal leaves nothing to press.
   */
  compact?:
    | { failure?: "failed" | "refused"; hasSite: boolean; primary: boolean }
    | false;
  /** Whether a sign-in says where it signs in; off where a line above already explains the buttons. */
  describesDestination?: boolean;
  kind: "key" | "run" | "sign-in" | "web";
  /** The button's words, where they differ from what it does by default. */
  label?: string;
  name: string;
  /** For a local app, what would run on this machine, in words. */
  runs?: string;
  slug: string;
}) {
  const appWindow = useContext(WindowContext);
  const inChat = askedIn === undefined ? {} : { chatId: askedIn };
  const openExternalLink = useOpenExternalLink();
  const site = useSiteSignIn({ askedIn, name, slug });
  // The default browser, for the button that sends the sign-in there.
  const browser = useDefaultBrowser();
  // Whether a sign-in started here is still waiting, kept by the window
  // so it outlives these controls (see `useSignInLanding`).
  const [signInsWaiting, setSignInsWaiting] = useAtom(signInsWaitingAtom);
  const waitingIn = signInsWaiting.get(slug)?.where;
  const setWaiting = (
    started: { from: number | undefined; where: SignInDestination } | false,
  ) => {
    setSignInsWaiting((current) => {
      const next = new Map(current);
      if (started) {
        next.set(slug, { ...started, inChat: appWindow?.chatId !== undefined });
      } else {
        next.delete(slug);
      }
      return next;
    });
  };
  const apps = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const listed = apps.data?.apps.find((app) => app.slug === slug);
  // Where a key or sign-in given here goes. It is shown, and sent back with
  // the key or the sign-in, so main refuses if the app was pointed elsewhere
  // after the user read it.
  const origin = listed?.credentialOrigin;
  const openAuthorization = (url: string, where: SignInDestination) => {
    if (where === "app" && appWindow?.browser) {
      appWindow.openPage(url);
    } else {
      openExternalLink(url, { addReferral: false });
    }
  };

  const startOAuth = useMutation(
    rpcClient.apps.startOAuth.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't start signing in", { cause: error });
      },
    }),
  );
  const signIn = (where: SignInDestination) => {
    if (origin === undefined) {
      return;
    }
    const opensIn = appWindow?.browser ? where : "external";
    startOAuth.mutate(
      {
        ...inChat,
        opensIn,
        origin,
        slug,
      },
      {
        onSuccess: (result) => {
          if (result.status === "started") {
            setWaiting({ from: listed?.connection?.updatedAt, where: opensIn });
            openAuthorization(result.url, where);
          }
        },
      },
    );
  };
  const cancelOAuth = useMutation(rpcClient.apps.cancelOAuth.mutationOptions());
  const allow = useMutation(
    rpcClient.apps.allow.mutationOptions({
      onError: (error) => {
        toast.error(`Couldn't start ${name}`, { cause: error });
      },
      onSuccess: (report) => {
        const failure = report.checks.find((check) => check.status === "fail");
        // A missing key is asked for next, in the same place.
        if (failure && failure.name !== "credential") {
          toast.error(`Couldn't connect ${name}`, { cause: failure.detail });
        }
      },
    }),
  );
  const busy =
    origin === undefined ||
    allow.isPending ||
    startOAuth.isPending ||
    cancelOAuth.isPending ||
    site.isDonePending;

  // A server that runs here is the one thing the user is agreeing to rather
  // than supplying, so the words say what will run before the button does it.
  if (kind === "run") {
    return (
      <div className="flex flex-col gap-2">
        {runs ? (
          <p className="text-xs text-muted-foreground">
            Instrument will install and run {runs} on{" "}
            {osConventions().thisComputer}.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={busy}
            onClick={() => {
              allow.mutate({ ...inChat, slug });
            }}
            size="sm"
          >
            {allow.isPending
              ? "Setting it up…"
              : (label ?? "Allow and connect")}
          </Button>
          {alongside}
        </div>
      </div>
    );
  }

  // A site's own sign-in, in the window's browser where the work happens:
  // nothing here can see the session, so once the site is open the user says
  // when they are done there.
  if (kind === "web") {
    if (compact) {
      return (
        <div className={SITE_ROW_BUTTONS}>
          {site.isWaiting ? (
            <Button
              className="text-foreground"
              disabled={busy}
              onClick={site.done}
              size="sm"
              variant="outline"
            >
              Done signing in
            </Button>
          ) : null}
          <Button
            className={cn(
              "min-w-24",
              (site.isWaiting || !compact.primary) && "text-foreground",
            )}
            disabled={!site.canOpen}
            onClick={site.open}
            size="sm"
            variant={!site.isWaiting && compact.primary ? "brand" : "outline"}
          >
            {site.isWaiting ? "Show page" : "Sign in"}
          </Button>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-2">
        {site.isWaiting ? (
          <p className="text-xs text-muted-foreground">
            Sign in on the {name} page that opened, then press Done.
          </p>
        ) : (
          <Destination origin={origin}>Signs in at</Destination>
        )}
        <div className="flex flex-wrap items-center gap-2 @max-md/transcript:flex-col @max-md/transcript:items-stretch">
          <Button
            className={site.isWaiting ? "text-foreground" : undefined}
            disabled={!site.canOpen}
            onClick={site.open}
            size="sm"
            variant={site.isWaiting ? "outline" : "default"}
          >
            {site.isWaiting ? "Show page" : (label ?? `Open ${name}`)}
          </Button>
          {site.isWaiting ? (
            <Button disabled={busy} onClick={site.done} size="sm">
              Done signing in
            </Button>
          ) : null}
          {alongside}
        </div>
      </div>
    );
  }

  const cancelSignIn = () => {
    setWaiting(false);
    cancelOAuth.mutate({ slug });
  };
  // The pair a sign-in offers: the user's own browser, then another way in.
  // While one waits it stays in its place, dimmed, and the other's place is
  // Cancel, at the width of the button it stands in for.
  const pair = ({
    lit,
    other,
    verb,
  }: {
    lit: boolean;
    /** The second way in, where it is not the same sign-in here. */
    other?: ReactNode;
    verb: string;
  }) => {
    // Named only when the computer says which browser is the default, so the
    // button never promises the wrong one.
    const ownBrowser = browser.data?.appName
      ? `${verb} with ${browser.data.appName}`
      : `${verb} with your browser`;
    const cancel = (standsFor: ReactNode) => (
      <Button
        className="relative text-foreground"
        onClick={cancelSignIn}
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
            className={lit ? undefined : "text-foreground"}
            disabled={busy || waitingIn !== undefined}
            onClick={() => {
              signIn("external");
            }}
            size="sm"
            variant={lit ? "brand" : "outline"}
          >
            {inBrowser}
          </Button>
        )}
        {waitingIn === "external"
          ? cancel(other === undefined ? "Sign in here" : SIGN_IN_ON_SITE)
          : (other ?? (
              <Button
                className="text-foreground"
                disabled={busy || waitingIn !== undefined}
                onClick={() => {
                  signIn("app");
                }}
                size="sm"
                variant="outline"
              >
                {label ?? "Sign in here"}
              </Button>
            ))}
      </>
    );
  };

  if (kind === "sign-in" && compact) {
    const { failure, hasSite, primary } = compact;
    const onSite = (lit: boolean) => (
      <SignInOnSiteButton lit={lit} onOpened={site.opened} slug={slug} />
    );
    if (failure === "refused") {
      return hasSite ? onSite(primary) : null;
    }
    return (
      <div className={ROW_BUTTONS}>
        {pair({
          lit: primary,
          ...(failure === "failed" && hasSite ? { other: onSite(false) } : {}),
          verb: failure === "failed" ? "Try again" : "Sign in",
        })}
      </div>
    );
  }

  if (kind === "sign-in") {
    return (
      <div className="flex flex-col gap-2">
        {describesDestination ? (
          <Destination origin={origin}>Signs in at</Destination>
        ) : null}
        {/* In a column too narrow for three buttons in a row they stack, each
          the column's width, rather than wrapping into a ragged pair. */}
        <div className="flex flex-wrap items-center gap-2 @max-md/transcript:flex-col @max-md/transcript:items-stretch">
          {pair({ lit: true, verb: "Sign in" })}
          {alongside}
        </div>
      </div>
    );
  }

  // Where the directory says the key is made, so the card says where to go
  // rather than asking for something the user has never seen.
  const keyHelp = listed?.type === "web" ? undefined : listed?.keyHelp;
  return (
    <div className="flex flex-col gap-2">
      {keyHelp ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {keyHelp.steps ?? `Make a key for ${name}, then paste it here.`}
          </p>
          <Button
            onClick={() => {
              if (appWindow?.browser) {
                appWindow.openPage(keyHelp.page);
              } else {
                openExternalLink(keyHelp.page, { addReferral: false });
              }
            }}
            size="sm"
            variant="outline"
          >
            Get a key
          </Button>
        </div>
      ) : null}
      <KeyForm
        alongside={alongside}
        askedIn={askedIn}
        keys={listed?.keys ?? []}
        name={name}
        origin={origin}
        slug={slug}
      />
    </div>
  );
}

/**
 * Moves the app to the service's site and opens it in the window's browser,
 * where the site's own sign-in works and its cookies keep it.
 */
function SignInOnSiteButton({
  lit,
  onOpened,
  slug,
}: {
  lit: boolean;
  /** Takes the tab the site opened in. */
  onOpened: (tab: string | undefined) => void;
  slug: string;
}) {
  const appWindow = useContext(WindowContext);
  const move = useMutation(
    rpcClient.apps.signInOnWeb.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't open the site", { cause: error });
      },
      onSuccess: ({ signIn }) => {
        onOpened(appWindow?.openPage(signIn));
      },
    }),
  );
  return (
    <Button
      className={lit ? undefined : "text-foreground"}
      disabled={move.isPending || !appWindow?.browser}
      onClick={() => {
        move.mutate({ slug });
      }}
      size="sm"
      variant={lit ? "brand" : "outline"}
    >
      {SIGN_IN_ON_SITE}
    </Button>
  );
}
