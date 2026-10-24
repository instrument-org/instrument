import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { BrowserHandoffButton } from "@/client/components/browser-handoff-button";
import { ClaudeSignInCode } from "@/client/components/claude-sign-in-code";
import {
  useChatGPTConnect,
  useClaudeConnect,
  useGrokConnect,
  useInstrumentConnect,
} from "@/client/hooks/use-connect";
import {
  type ConnectFlow,
  type ConnectResult,
} from "@/client/hooks/use-connect-flow";
import { CONNECT_NAMES, connectLine } from "@/client/lib/connect-copy";
import { cn } from "@/client/lib/utils";
import { type ConnectProvider } from "@/shared/connect-outcome";
import { type ComponentProps, type ReactNode, useEffect } from "react";
import { FcGoogle } from "react-icons/fc";

type Props = {
  /** Under the button while nothing is under way. */
  caption?: ReactNode;
  className?: string;
  /** Told how each attempt ended, once it is still this button's own. */
  onResult?: (result: ConnectResult) => void;
  /** Told when the button starts and stops holding. */
  onWaitingChange?: (waiting: boolean) => void;
  variant?: ComponentProps<typeof BrowserHandoffButton>["variant"];
};

/**
 * "Continue with …" for one way in: it holds as Cancel while the browser has
 * the sign-in and while the plan is checked, says where to finish under it,
 * and says there how an attempt that didn't land ended.
 */
export function ConnectButton({
  provider,
  ...props
}: Props & { provider: ConnectProvider }) {
  switch (provider) {
    case "chatgpt": {
      return <ChatGPTConnectButton {...props} />;
    }
    case "claude": {
      return <ClaudeConnectButton {...props} />;
    }
    case "grok": {
      return <GrokConnectButton {...props} />;
    }
    case "instrument": {
      return <InstrumentConnectButton {...props} />;
    }
  }
}

function InstrumentConnectButton(props: Props) {
  const flow = useInstrumentConnect();
  return (
    <ConnectButtonView
      {...props}
      flow={flow}
      icon={<FcGoogle />}
      label="Continue with Google"
      provider="instrument"
      waitingLine={
        flow.phase === "on-web"
          ? "Finish choosing your plan in your browser"
          : "Finish signing in with Google in your browser"
      }
    />
  );
}

function ChatGPTConnectButton(props: Props) {
  const flow = useChatGPTConnect();
  return (
    <ConnectButtonView
      {...props}
      flow={flow}
      provider="chatgpt"
      waitingLine="Finish signing in with ChatGPT in your browser"
    />
  );
}

function ClaudeConnectButton(props: Props) {
  const flow = useClaudeConnect();
  const { status } = flow;
  return (
    <ConnectButtonView
      {...props}
      below={
        flow.phase === "signing-in" &&
        status?.signingIn &&
        status.signInLink && (
          <ClaudeSignInCode
            className="w-full text-center"
            link={status.signInLink}
          />
        )
      }
      flow={flow}
      provider="claude"
      waitingLine={claudeWaitingLine(status)}
    />
  );
}

function GrokConnectButton(props: Props) {
  const flow = useGrokConnect();
  return (
    <ConnectButtonView
      {...props}
      flow={flow}
      provider="grok"
      waitingLine={grokWaitingLine(flow.userCode)}
    />
  );
}

function ConnectButtonView({
  below,
  caption,
  className,
  flow,
  icon,
  label,
  onResult,
  onWaitingChange,
  provider,
  variant = "outline",
  waitingLine,
}: Props & {
  below?: ReactNode;
  flow: ConnectFlow<void>;
  icon?: ReactNode;
  label?: string;
  provider: ConnectProvider;
  waitingLine: ReactNode;
}) {
  const { waiting } = flow;
  useEffect(() => {
    onWaitingChange?.(waiting);
  }, [onWaitingChange, waiting]);

  const name = CONNECT_NAMES[provider];
  const answer = flow.outcome && connectLine(flow.outcome, provider);
  return (
    <div className="flex w-full flex-col items-center gap-y-2">
      <BrowserHandoffButton
        className={className}
        icon={icon ?? <ConnectIcon className="size-4" provider={provider} />}
        onCancel={flow.cancel}
        onStart={() => {
          void flow.start().then((result) => {
            if (result) {
              onResult?.(result);
            }
          });
        }}
        variant={variant}
        waiting={waiting}
      >
        {label ?? `Continue with ${name}`}
      </BrowserHandoffButton>
      <div
        className={cn(
          "text-center text-xs text-foreground/60",
          answer && !waiting && "text-warning-700 dark:text-warning-300",
        )}
      >
        {flow.phase === "checking"
          ? `Checking your ${name} plan`
          : waiting
            ? waitingLine
            : (answer ?? caption)}
      </div>
      {below}
    </div>
  );
}

/** Where a Claude sign-in is: Claude Code installing, the browser, or back. */
export function claudeWaitingLine(
  status: ReturnType<typeof useClaudeConnect>["status"],
): string {
  const install = status?.install;
  if (install?.state === "downloading") {
    const percent =
      install.total > 0
        ? Math.round((install.received / install.total) * 100)
        : 0;
    return `Getting Claude Code ready, ${String(percent)}% done`;
  }
  return status?.finishing
    ? "Connecting your Claude account"
    : "Finish signing in to Claude in your browser";
}

/** The code xAI's page asks for, once it has handed one out. */
export function grokWaitingLine(userCode: string | undefined): ReactNode {
  return userCode ? (
    <>
      Enter{" "}
      <span className="font-mono font-medium text-foreground select-all">
        {userCode}
      </span>{" "}
      on the page that opened in your browser
    </>
  ) : (
    "Finish signing in with Grok in your browser"
  );
}

/**
 * The mark of a way in: Google's for Instrument, each service's own else,
 * in its brand's colors where it has them.
 */
export function ConnectIcon({
  className,
  provider,
}: {
  className?: string;
  provider: ConnectProvider;
}) {
  return provider === "instrument" ? (
    <FcGoogle className={className} />
  ) : (
    <AIProviderIcon
      className={className}
      colored
      type={
        provider === "chatgpt"
          ? "chatgpt-account"
          : provider === "claude"
            ? "claude-account"
            : "grok-account"
      }
    />
  );
}
