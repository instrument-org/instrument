import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import {
  ConnectedChip,
  SetupGroup,
  SetupHead,
  SetupPage,
  SetupPill,
  SetupQuietLink,
  SetupRow,
} from "@/client/components/onboarding/setup/chrome";
import { useSetup } from "@/client/components/onboarding/setup/context";
import { WelcomeHero } from "@/client/components/onboarding/setup/way-in-hero";
import {
  BadgedTile,
  ChatGPTMark,
  ClaudeMark,
  GOOGLE_TILE,
  GoogleButton,
  IconWell,
  LegalLine,
  PerkCards,
  ProductTile,
  WayInButton,
} from "@/client/components/onboarding/setup/way-in-parts";
import { describeResetTime } from "@/client/components/onboarding/setup/way-in-routing";
import {
  useChatGPTWayIn,
  useClaudeSignInPickup,
  useClaudeStatus,
  useClaudeWayIn,
  useGoogleWayIn,
  useStartClaudeSignIn,
} from "@/client/components/onboarding/setup/way-in-sign-in";
import { Input } from "@/client/components/ui/input";
import { Spinner } from "@/client/components/ui/spinner";
import { rpcClient } from "@/client/rpc/client";
import { ClockIcon } from "@phosphor-icons/react/Clock";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { KeyIcon } from "@phosphor-icons/react/Key";
import { SparkleIcon } from "@phosphor-icons/react/Sparkle";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

const PRODUCT_NAME = { chatgpt: "ChatGPT", claude: "Claude" } as const;

function ProductHeadTile({ provider }: { provider: "chatgpt" | "claude" }) {
  return (
    <ProductTile size="head">
      {provider === "chatgpt" ? (
        <ChatGPTMark size="head" />
      ) : (
        <ClaudeMark size="head" />
      )}
    </ProductTile>
  );
}

/** Moves to the own-key path's provider list. */
function useOwnKeyWayIn() {
  const { dispatch } = useSetup();
  return () => {
    dispatch({ type: "way", way: "key" });
    dispatch({ step: "providers", type: "go" });
  };
}

/** The Google sign-in that starts a trial, which goes on to the plans. */
function useGoogleTrialWayIn() {
  const { dispatch } = useSetup();
  return useGoogleWayIn({
    onSignedIn: () => {
      dispatch({ type: "way", way: "google" });
      dispatch({ step: "plans", type: "go" });
    },
  });
}

/** F2: the four ways in. */
export function WelcomePage() {
  const google = useGoogleTrialWayIn();
  const chatgpt = useChatGPTWayIn({ move: "go" });
  const claude = useClaudeWayIn({ move: "go" });
  const ownKey = useOwnKeyWayIn();

  return (
    <SetupPage align="top" footer={false}>
      <SetupHead
        illustration={<WelcomeHero />}
        subtitle="Hand it the work you'd give an assistant. It gets it done on your computer and tells you when it's ready."
        title="Welcome to Instrument"
      />
      <div className="mt-8 flex flex-col items-center gap-1.5">
        <GoogleButton
          onCancel={google.cancel}
          onStart={() => {
            void google.start();
          }}
          waiting={google.waiting}
        />
        <span className="text-xs text-foreground/50">
          New here? Your first 7 days are free. No card needed.
        </span>
      </div>
      <div className="mt-4 flex flex-col items-center gap-1.5">
        <div className="flex w-85 gap-3">
          <WayInButton
            className="flex-1"
            icon={<ChatGPTMark />}
            onCancel={chatgpt.cancel}
            onStart={() => {
              void chatgpt.start();
            }}
            waiting={chatgpt.waiting}
          >
            ChatGPT
          </WayInButton>
          <WayInButton
            className="flex-1"
            icon={<ClaudeMark />}
            onStart={() => {
              void claude.start();
            }}
            waiting={claude.connecting}
          >
            Claude
          </WayInButton>
        </div>
        <span className="text-xs text-foreground/50">
          Only works with paid ChatGPT and Claude plans.
        </span>
      </div>
      <SetupQuietLink className="mt-5" onClick={ownKey}>
        Or add an API provider manually
      </SetupQuietLink>
      <div className="mt-auto pt-6 pb-5">
        <LegalLine />
      </div>
    </SetupPage>
  );
}

/** F18: the free Instrument account, offered after any way in but Google. */
export function FreeAccountPage() {
  const { dispatch, state } = useSetup();
  const toMemories = () => {
    dispatch({ step: "memories", type: "go" });
  };
  const google = useGoogleWayIn({ onSignedIn: toMemories });

  return (
    <SetupPage skip={{ label: "Not now", onClick: toMemories }}>
      <div className="pt-1">
        {state.way === "chatgpt" && <ChatGPTChip />}
        {state.way === "claude" && <ClaudeChip />}
        {state.way === "key" && state.answers.providerId && (
          <OwnKeyChip providerId={state.answers.providerId} />
        )}
      </div>
      <SetupHead
        subtitle="Sign in with Google for a few extras that work with any AI. It's free, and it doesn't use your plan or your key."
        title="Add a free Instrument account"
      />
      <PerkCards />
      <div className="mt-8">
        <GoogleButton
          onCancel={google.cancel}
          onStart={() => {
            void google.start();
          }}
          waiting={google.waiting}
        />
      </div>
    </SetupPage>
  );
}

function ChatGPTChip() {
  const { data } = useQuery(
    rpcClient.chatgptAccount.live.status.experimental_liveOptions(),
  );
  // The newest signed-in account is the one this setup just connected.
  const account = data?.accounts.findLast(
    (candidate) => candidate.state === "signed-in",
  );
  return (
    <ConnectedChip
      checked
      icon={<ChatGPTMark />}
      label={account?.email ? `ChatGPT · ${account.email}` : "ChatGPT"}
    />
  );
}

function ClaudeChip() {
  const status = useClaudeStatus();
  const email = status?.kind === "signed-in" ? status.email : undefined;
  return (
    <ConnectedChip
      checked
      icon={<ClaudeMark />}
      label={email ? `Claude · ${email}` : "Claude"}
    />
  );
}

function OwnKeyChip({ providerId }: { providerId: string }) {
  const { data } = useQuery(
    rpcClient.providerConfig.live.list.experimental_liveOptions(),
  );
  const config = data?.find((candidate) => candidate.id === providerId);
  if (!config) {
    return null;
  }
  return (
    <ConnectedChip
      checked
      icon={<AIProviderIcon className="size-4" colored type={config.type} />}
      label={config.displayName ?? "Your provider"}
    />
  );
}

/**
 * F19: the ChatGPT or Claude account has no paid plan, or the sign-in failed
 * for a reason we can't name. Either way it offers the other ways in and a
 * retry.
 */
export function NoPaidPlanPage() {
  const { state } = useSetup();
  const trouble = state.answers.connectTrouble;
  const provider = trouble?.provider ?? "chatgpt";
  const other = provider === "chatgpt" ? "claude" : "chatgpt";
  const name = PRODUCT_NAME[provider];
  const otherName = PRODUCT_NAME[other];
  const couldNotConnect = trouble?.reason === "could-not-connect";

  const google = useGoogleTrialWayIn();
  const ownKey = useOwnKeyWayIn();
  const chatgptInstead = useChatGPTWayIn({ move: "go" });
  const chatgptAgain = useChatGPTWayIn({ move: "replace" });
  const claudeInstead = useClaudeWayIn({ move: "go" });
  const claudeAgain = useClaudeWayIn({ move: "replace" });

  const instead =
    other === "chatgpt"
      ? {
          cancel: chatgptInstead.cancel,
          start: chatgptInstead.start,
          waiting: chatgptInstead.waiting,
        }
      : {
          cancel: () => {},
          start: claudeInstead.start,
          waiting: claudeInstead.connecting,
        };
  const again =
    provider === "chatgpt"
      ? {
          cancel: chatgptAgain.cancel,
          start: chatgptAgain.start,
          waiting: chatgptAgain.waiting,
        }
      : {
          cancel: () => {},
          start: claudeAgain.start,
          waiting: claudeAgain.connecting,
        };

  return (
    <SetupPage>
      <SetupHead
        illustration={
          <BadgedTile
            badge={<WarningIcon className="size-4 text-warning-700" />}
          >
            <ProductHeadTile provider={provider} />
          </BadgedTile>
        }
        subtitle={
          couldNotConnect
            ? `Something went wrong while you were signing in, and ${name} didn't tell us what. Try again, or choose another way in.`
            : `Instrument only works with a paid ${name} plan. Upgrade and try again, or choose another way in.`
        }
        title={
          couldNotConnect
            ? `We couldn't connect to ${name}`
            : `Your ${name} account doesn't have a paid plan`
        }
      />
      <SetupGroup className="mt-8">
        <SetupRow
          control={
            <SetupPill
              kind="light"
              onClick={() => {
                if (google.waiting) {
                  google.cancel();
                } else {
                  void google.start();
                }
              }}
              size="small"
            >
              {google.waiting ? "Cancel" : "Start"}
            </SetupPill>
          }
          detail="Sign in with Google. No card needed."
          icon={GOOGLE_TILE}
          title="Try Instrument free for 7 days"
        />
        <SetupRow
          control={
            <SetupPill
              kind="light"
              onClick={() => {
                if (instead.waiting) {
                  instead.cancel();
                } else {
                  void instead.start();
                }
              }}
              size="small"
            >
              {instead.waiting ? "Cancel" : "Continue"}
            </SetupPill>
          }
          detail={`With a paid ${otherName} plan`}
          icon={
            <ProductTile>
              {other === "chatgpt" ? <ChatGPTMark /> : <ClaudeMark />}
            </ProductTile>
          }
          title={`Use ${otherName} instead`}
        />
        <SetupRow
          control={
            <SetupPill kind="light" onClick={ownKey} size="small">
              Add
            </SetupPill>
          }
          detail="OpenAI, Anthropic, Google and more"
          icon={
            <IconWell tone="neutral">
              <KeyIcon />
            </IconWell>
          }
          title="Use your own API key"
        />
      </SetupGroup>
      <SetupQuietLink
        className="mt-5"
        onClick={() => {
          if (again.waiting) {
            again.cancel();
          } else {
            void again.start();
          }
        }}
      >
        {again.waiting
          ? `Waiting for ${name} in your browser. Cancel`
          : couldNotConnect
            ? `Try ${name} again`
            : `I've upgraded. Try ${name} again`}
      </SetupQuietLink>
    </SetupPage>
  );
}

/** F20: the plan is out of usage as they connect it. */
export function OutOfUsagePage() {
  const { dispatch, state } = useSetup();
  const trouble = state.answers.connectTrouble;
  const name = PRODUCT_NAME[trouble?.provider ?? "chatgpt"];
  const resetsAt = trouble?.resetsAt
    ? describeResetTime(trouble.resetsAt)
    : undefined;

  return (
    <SetupPage
      next={{
        label: "Finish setup",
        onClick: () => {
          dispatch({ answers: { isOutOfUsage: true }, type: "answer" });
          dispatch({ step: "memories", type: "go" });
        },
      }}
    >
      <SetupHead
        illustration={
          <BadgedTile
            badge={<ClockIcon className="size-4 text-stone-600" />}
          >
            <ProductHeadTile provider={trouble?.provider ?? "chatgpt"} />
          </BadgedTile>
        }
        subtitle={
          resetsAt
            ? `Your ${name} plan has hit its limit, and ${name} says it comes back around ${resetsAt}. You can finish setup now, and we'll skip the one step that needs AI.`
            : `Your ${name} plan has hit its limit. You can finish setup now, and we'll skip the one step that needs AI.`
        }
        title={`${name} is out of usage for now`}
      />
      <SetupGroup className="mt-8">
        <SetupRow
          control={
            <span className="text-xs font-medium text-foreground/45">
              Skipped
            </span>
          }
          detail="We'll show starter tasks instead of writing them for you"
          icon={
            <IconWell>
              <SparkleIcon />
            </IconWell>
          }
          title="Suggested tasks"
        />
      </SetupGroup>
      <SetupQuietLink
        className="mt-5"
        onClick={() => {
          dispatch({
            answers: { connectTrouble: null, isOutOfUsage: false },
            type: "answer",
          });
          dispatch({ type: "way", way: null });
          dispatch({ step: "welcome", type: "go" });
        }}
      >
        Use something else instead
      </SetupQuietLink>
    </SetupPage>
  );
}

/** F21: waiting on Claude's sign-in in the browser. */
export function ClaudeSignInPage() {
  const { dispatch } = useSetup();
  const { error, retry, status } = useStartClaudeSignIn();
  const pickup = useClaudeSignInPickup();
  const install =
    status?.install?.state === "downloading" ? status.install : undefined;

  return (
    <SetupPage next={{ disabled: true, label: "Continue", onClick: () => {} }}>
      <SetupHead
        illustration={<ProductHeadTile provider="claude" />}
        subtitle="We opened Claude in your browser. Instrument picks it up as soon as you're done."
        title="Finish signing in to Claude"
      />
      <div className="mt-8 flex items-center gap-3 text-sm text-foreground/60">
        {error ? (
          <>
            <span className="max-w-100 text-center">{error}</span>
            <SetupPill
              kind="light"
              onClick={retry}
              size="small"
            >
              Try again
            </SetupPill>
          </>
        ) : (
          <>
            <Spinner className="size-4 text-brand-600" delay={0} />
            {install
              ? `Getting Claude ready, ${installPercent(install)}% done`
              : "Waiting for Claude…"}
            <SetupPill
              kind="light"
              onClick={() => {
                pickup.stop();
                dispatch({ type: "back" });
              }}
              size="small"
            >
              Cancel
            </SetupPill>
          </>
        )}
      </div>
      {status?.signInLink && (
        <SetupQuietLink
          className="mt-6"
          onClick={() => {
            dispatch({ step: "claude-device", type: "go" });
          }}
        >
          Signing in on another device?
        </SetupQuietLink>
      )}
    </SetupPage>
  );
}

function installPercent({
  received,
  total,
}: {
  received: number;
  total: number;
}) {
  return total > 0 ? Math.round((received / total) * 100) : 0;
}

/** F22: Claude's sign-in link and code, for another device. */
export function ClaudeDevicePage() {
  const { dispatch } = useSetup();
  const { status } = useStartClaudeSignIn();
  const pickup = useClaudeSignInPickup();
  const link = status?.signInLink;
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  // Held after Claude takes the code, until the sign-in carries setup on.
  const [submitting, setSubmitting] = useState(false);
  const canSubmit = code.trim() !== "" && !submitting;

  const submit = async () => {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    setError(undefined);
    const result = await rpcClient.claudeAccount.submitSignInCode
      .call({ code: code.trim() })
      .catch(() => ({ error: "Claude didn't accept that code." }));
    if (result.error) {
      setSubmitting(false);
      setError(result.error);
      setCode("");
    }
  };

  return (
    <SetupPage
      next={{
        disabled: !canSubmit,
        label: "Continue",
        onClick: () => {
          void submit();
        },
      }}
    >
      <SetupHead
        illustration={<ProductHeadTile provider="claude" />}
        subtitle="Open this sign-in link in any browser, sign in, and paste the code Claude shows you here."
        title="Sign in on another device"
      />
      <div className="mt-8 flex flex-col items-center gap-4">
        <SetupPill
          disabled={!link}
          kind="light"
          onClick={() => {
            if (link) {
              void navigator.clipboard.writeText(link).then(() => {
                toast.success("Copied the sign-in link");
              });
            }
          }}
        >
          <CopyIcon className="size-3.75" />
          Copy sign-in link
        </SetupPill>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Input
            aria-label="Code from Claude"
            autoComplete="off"
            className="h-11 w-85 rounded-xl bg-card px-4 text-sm shadow-xs"
            onChange={(event) => {
              setCode(event.target.value);
            }}
            placeholder="Paste the code from Claude"
            value={code}
          />
          <SetupPill disabled={!canSubmit} type="submit">
            Continue
          </SetupPill>
        </form>
        {error && (
          <p className="max-w-110 text-center text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <SetupQuietLink
        className="mt-6"
        onClick={() => {
          pickup.stop();
          dispatch({ type: "way", way: "key" });
          dispatch({ step: "providers", type: "go" });
        }}
      >
        Trouble signing in? Use your own API key instead
      </SetupQuietLink>
    </SetupPage>
  );
}
