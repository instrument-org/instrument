import { Button } from "@/client/components/ui/button";
import { cn, osConventions } from "@/client/lib/utils";
import { KeyForm } from "@/client/components/window/key-form";
import { WindowContext } from "@/client/components/window/context";
import {
  type SignInDestination,
  signInsWaitingAtom,
} from "@/client/components/window/use-sign-in-landing";
import { FixWithInstrumentButton } from "@/client/components/window/fix-connection";
import { SignInButton } from "@/client/components/window/sign-in-button";
import { useSiteSignIn } from "@/client/components/window/site-sign-in";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import { rpcClient } from "@/client/rpc/client";
import { type ChatId } from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import {
  type ReactNode,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { toast } from "@/client/lib/toast";

/**
 * A web app's row buttons. In a narrow chat they go under the name at the
 * row's width, the last first, so the button that shows the site stays
 * where the one that opened it was pressed.
 */
const SITE_ROW_BUTTONS =
  "flex shrink-0 items-center gap-1.5 @max-md/transcript:w-full @max-md/transcript:flex-col-reverse @max-md/transcript:items-stretch";

/**
 * The one thing only the user can give an app, wherever it is asked for: a
 * sign-in, or a key. The card in the conversation, the directory row, and the
 * app's page all draw these same controls, so an app the agent set up gets
 * finished by a click on whichever of them is in front of the user, with no
 * second trip through the agent. Plain buttons, not the mark: nothing here
 * sends the agent a word.
 *
 * A sign-in is one button, whose menu has the user's own browser and the
 * window's. The browser leads, since it is where they are most likely already
 * signed in and have their passkeys, saved passwords and extensions. Either
 * one connects the app, since the answer comes back to the same callback. A key
 * goes straight to the encrypted store and is tested on arrival. A web app
 * signs in on its own site in the window's browser, and the user's word that
 * they did is what connects it: Done on the bar over the site
 * (`SiteSignInBar`), or here. The button that shows the site again stands
 * where the one that opened it stood.
 */
export function ConnectControls({
  alongside,
  askedIn,
  failure,
  fix,
  kind,
  label,
  name,
  primary = true,
  onStarted,
  runs,
  slug,
  startsIn,
}: {
  /** One more control at the end of a key's or a server's row. */
  alongside?: ReactNode;
  /** For a card in a chat, the chat, which hears what the user does here even after the card stopped waiting. */
  askedIn?: ChatId;
  /** How the app's last sign-in ended. A refusal leaves only `fix`, since the same sign-in meets the same refusal. */
  failure?: "failed" | "refused" | undefined;
  /** Asks Instrument for another way, offered beside another try once a sign-in failed. */
  fix?: () => void;
  kind: "key" | "run" | "sign-in" | "web";
  /** The button's words, where they differ from what it does by default. */
  label?: string;
  name: string;
  /** Whether a sign-in's button is lit as the one to press next. */
  primary?: boolean;
  /** Called once `startsIn` has been acted on. */
  onStarted?: () => void;
  /** Where to start the sign-in as soon as the app is here to be signed in to, for a press that set the app up first. */
  startsIn?: SignInDestination | undefined;
  /** For a local app, what would run on this machine, in words. */
  runs?: string;
  slug: string;
}) {
  const appWindow = useContext(WindowContext);
  const inChat = askedIn === undefined ? {} : { chatId: askedIn };
  const openExternalLink = useOpenExternalLink();
  const site = useSiteSignIn({ askedIn, name, slug });
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
  const fixRef = useRef<HTMLButtonElement>(null);
  const [fixInMenu, setFixInMenu] = useState(false);
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
        const failed = report.checks.find((check) => check.status === "fail");
        // A missing key is asked for next, in the same place.
        if (failed && failed.name !== "credential") {
          toast.error(`Couldn't connect ${name}`, { cause: failed.detail });
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

  const canStart = kind === "web" ? site.canOpen : origin !== undefined;
  const startDue =
    startsIn !== undefined &&
    canStart &&
    (kind === "web" || kind === "sign-in");
  const startNow = useEffectEvent(() => {
    if (startsIn === undefined) {
      return;
    }
    if (kind === "web") {
      site.open();
    } else {
      signIn(startsIn);
    }
    onStarted?.();
  });
  useEffect(() => {
    if (startDue) {
      startNow();
    }
  }, [startDue]);

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
            (site.isWaiting || !primary) && "text-foreground",
          )}
          disabled={!site.canOpen}
          onClick={site.open}
          size="sm"
          variant={!site.isWaiting && primary ? "brand" : "outline"}
        >
          {site.isWaiting ? "Show page" : (label ?? "Sign in")}
        </Button>
      </div>
    );
  }

  const cancelSignIn = () => {
    setWaiting(false);
    cancelOAuth.mutate({ slug });
  };
  if (kind === "sign-in") {
    if (failure === "refused") {
      return fix ? <FixWithInstrumentButton onClick={fix} /> : null;
    }
    const offersFix = failure !== undefined && waitingIn === undefined;
    return (
      <div className="flex shrink-0 items-center gap-1.5">
        {fix && offersFix ? (
          <FixWithInstrumentButton
            className="@max-md/transcript:hidden"
            onClick={fix}
            ref={fixRef}
          />
        ) : null}
        <SignInButton
          busy={busy}
          canSignInHere={Boolean(appWindow?.browser)}
          {...(offersFix && fixInMenu ? { fix } : {})}
          label={failure === undefined ? (label ?? "Sign in") : "Try again"}
          onCancel={cancelSignIn}
          onMenuOpen={() => {
            // Hidden where the row has no room for it.
            setFixInMenu(
              fixRef.current !== null &&
                fixRef.current.getClientRects().length === 0,
            );
          }}
          onStart={signIn}
          variant={primary ? "brand" : "outline"}
          waiting={waitingIn !== undefined}
        />
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
