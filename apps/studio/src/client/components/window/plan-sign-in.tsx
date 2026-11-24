import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { InstrumentGlyph } from "@/client/components/wordmark";
import {
  useChatGPTConnect,
  useClaudeConnect,
  useGrokConnect,
} from "@/client/hooks/use-connect";
import {
  type ConnectFlow,
  type ConnectPhase,
} from "@/client/hooks/use-connect-flow";
import { type PlanProvider } from "@/client/hooks/use-connected-plans";
import { CONNECT_NAMES } from "@/client/lib/connect-copy";
import { showConnectToast } from "@/client/lib/connect-toast";
import { rpcClient } from "@/client/rpc/client";
import { type ConnectOutcome } from "@/shared/connect-outcome";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import { WindowContext, type WindowContextValue } from "./context";
import { type SignInDestination } from "./use-sign-in-landing";
import { useShowAppPage } from "./use-show-app-page";
import { useWindowTabs } from "./window-tabs";

/** One attempt at a plan's sign-in, as it was pressed. */
interface Attempt {
  accountId: string | undefined;
  openPage: WindowContextValue["openPage"];
  /** The app's page to bring up once it is done with; without one, its tab just closes. */
  slug?: string;
  /** The tab its page is in, once it opened in one. */
  tab?: string;
  where: SignInDestination;
}

interface PlanSignIn {
  cancel: () => void;
  /** Where the person presses on from a finished sign-in: its tab closes and the app's page comes up. */
  finish: () => void;
  outcome: ConnectOutcome | undefined;
  phase: ConnectPhase;
  start: (attempt: Omit<Attempt, "tab">) => void;
  /** The tab its page is in, while it waits and until Done. */
  tab: string | undefined;
  /** Where the last press sent it. */
  where: SignInDestination | undefined;
  /** Where the sign-in under way was sent. */
  waitingIn: SignInDestination | undefined;
  /** The account it signs in again, rather than a new one. */
  accountId: string | undefined;
}

interface PlanSignIns extends Record<PlanProvider, PlanSignIn> {
  /** Notes that a surface says how this plan's sign-in went; answers the way to take it back. */
  noteShown: (provider: PlanProvider) => () => void;
}

const PlanSignInsContext = createContext<null | PlanSignIns>(null);

/** The plans' sign-ins under way in this window. */
export function usePlanSignIns() {
  const signIns = useContext(PlanSignInsContext);
  if (!signIns) {
    throw new Error("usePlanSignIns is only for surfaces of the app window");
  }
  return signIns;
}

/** The same, or null outside the app window. */
export function useOptionalPlanSignIns() {
  return useContext(PlanSignInsContext);
}

/** The window's context, with the plans' sign-ins it keeps. */
export function PlanSignInsWindow({
  children,
  value,
}: {
  children: ReactNode;
  value: null | WindowContextValue;
}) {
  return (
    <WindowContext value={value}>
      <PlanSignInsProvider>{children}</PlanSignInsProvider>
    </WindowContext>
  );
}

/**
 * The sign-ins that connect a plan, kept by the window so they outlive the
 * page they were pressed on. One opened in a tab here is canceled by closing
 * that tab; the tab of one that landed stays until the person presses Done
 * over it, and that of one that didn't closes, since the app's page says why.
 */
function PlanSignInsProvider({ children }: { children: ReactNode }) {
  const shown = useRef(new Map<PlanProvider, number>());
  const isShown = (provider: PlanProvider) =>
    (shown.current.get(provider) ?? 0) > 0;
  const chatgpt = usePlanSignIn("chatgpt", useChatGPTConnect(), isShown);
  const claude = usePlanSignIn("claude", useClaudeConnect(), isShown);
  const grok = usePlanSignIn("grok", useGrokConnect(), isShown);

  const takePage = useEffectEvent((provider: PlanProvider, url: string) => {
    ({ chatgpt, claude, grok })[provider].takePage(url);
  });
  useEffect(() => {
    const ending = new AbortController();
    void (async () => {
      const pages = await rpcClient.planSignIn.live.page.call(undefined, {
        signal: ending.signal,
      });
      for await (const { provider, url } of pages) {
        takePage(provider, url);
      }
    })().catch(() => undefined);
    return () => {
      ending.abort();
    };
  }, []);

  const noteShown = (provider: PlanProvider) => {
    shown.current.set(provider, (shown.current.get(provider) ?? 0) + 1);
    return () => {
      shown.current.set(provider, (shown.current.get(provider) ?? 1) - 1);
    };
  };
  return (
    <PlanSignInsContext value={{ chatgpt, claude, grok, noteShown }}>
      {children}
    </PlanSignInsContext>
  );
}

function usePlanSignIn(
  provider: PlanProvider,
  flow: ConnectFlow<{ accountId?: string; opensIn?: SignInDestination } | void>,
  isShown: (provider: PlanProvider) => boolean,
): PlanSignIn & { takePage: (url: string) => void } {
  const windowTabs = useWindowTabs();
  const showAppPage = useShowAppPage();
  const [attempt, setAttempt] = useState<Attempt>();
  const { outcome, phase } = flow;
  const tab = attempt?.tab;
  const isTabOpen =
    tab !== undefined && windowTabs.allTabs.some((each) => each.id === tab);

  const start: PlanSignIn["start"] = (next) => {
    if (tab !== undefined && isTabOpen) {
      windowTabs.close(tab);
    }
    setAttempt(next);
    void flow.start({
      opensIn: next.where,
      ...(next.accountId === undefined ? {} : { accountId: next.accountId }),
    });
  };
  const cancel = () => {
    flow.cancel();
    if (tab !== undefined && isTabOpen) {
      windowTabs.close(tab);
    }
    setAttempt(undefined);
  };
  const finish = () => {
    if (attempt === undefined) {
      return;
    }
    const group = windowTabs.allTabs.find((each) => each.id === tab)?.group;
    if (attempt.slug !== undefined) {
      showAppPage(attempt.slug, group === undefined ? {} : { group });
    }
    if (tab !== undefined) {
      windowTabs.close(tab);
    }
    setAttempt(undefined);
  };

  // Closing the page gives the sign-in up, while it still waits there.
  const dropped = tab !== undefined && !isTabOpen;
  const onDropped = useEffectEvent(() => {
    if (phase === "signing-in") {
      flow.cancel();
    }
    setAttempt((current) => {
      if (current === undefined) {
        return current;
      }
      const { tab: _closed, ...rest } = current;
      return rest;
    });
  });
  useEffect(() => {
    if (dropped) {
      onDropped();
    }
  }, [dropped]);

  const onSettled = useEffectEvent((settled: ConnectOutcome) => {
    if (attempt === undefined) {
      return;
    }
    // The bar over its tab says it connected.
    if (settled.kind === "ready" && isTabOpen) {
      return;
    }
    if (tab !== undefined && isTabOpen) {
      windowTabs.close(tab);
    }
    if (!isShown(provider)) {
      showConnectToast(
        {
          outcome: settled,
          ...(flow.modelName === undefined
            ? {}
            : { modelName: flow.modelName }),
        },
        provider,
        () => {
          start(attempt);
        },
      );
    }
  });
  useEffect(() => {
    if (outcome !== undefined) {
      onSettled(outcome);
    }
  }, [outcome]);

  return {
    accountId: attempt?.accountId,
    cancel,
    finish,
    outcome,
    phase,
    start,
    tab: isTabOpen ? tab : undefined,
    takePage: (url) => {
      // Another window's sign-in, or one whose page is open already.
      if (
        attempt?.where !== "app" ||
        phase !== "signing-in" ||
        tab !== undefined
      ) {
        return;
      }
      const opened = attempt.openPage(url, { newTab: true });
      if (opened === undefined) {
        flow.cancel();
        return;
      }
      setAttempt({ ...attempt, tab: opened });
    },
    waitingIn: phase === "idle" ? undefined : attempt?.where,
    where: attempt?.where,
  };
}

/**
 * The bar over a plan's sign-in page, once the page is done with: the plan
 * being checked, then that it connected, with Done to leave the page. While
 * the person still works on the page there is none, except to give the code
 * xAI's page asks for when its address doesn't carry it.
 */
export function PlanSignInBar({ tabId }: { tabId: string }) {
  const signIns = useContext(PlanSignInsContext);
  const provider = (["chatgpt", "claude", "grok"] as const).find(
    (each) => signIns?.[each].tab === tabId,
  );
  if (signIns === null || provider === undefined) {
    return null;
  }
  const signIn = signIns[provider];
  const name = CONNECT_NAMES[provider];
  const bar =
    "flex h-12 shrink-0 items-center gap-2.5 border-b border-border bg-brand-50 px-3 text-sm dark:bg-brand-500/15";
  if (signIn.phase === "checking") {
    return (
      <div className={bar} role="status">
        <Spinner className="size-4" />
        <span className="min-w-0 flex-1 truncate">
          Checking your {name} plan.
        </span>
      </div>
    );
  }
  if (signIn.phase === "idle" && signIn.outcome?.kind === "ready") {
    return (
      <div className={bar} role="status">
        <CheckIcon
          className="size-4 shrink-0 text-brand-600 dark:text-brand-400"
          weight="bold"
        />
        <span className="min-w-0 flex-1 truncate">
          Your {name} plan is connected.
        </span>
        <Button
          className="min-w-18"
          onClick={signIn.finish}
          size="sm"
          variant="brand"
        >
          Done
        </Button>
      </div>
    );
  }
  return provider === "grok" && signIn.phase === "signing-in" ? (
    <GrokCodeBar className={bar} />
  ) : null;
}

/** The code xAI's page asks for, with that page's address, while a Grok sign-in waits. */
export function usePendingGrokCode() {
  const { data } = useQuery(
    rpcClient.grokAccount.live.status.experimental_liveOptions(),
  );
  return data?.pending;
}

function GrokCodeBar({ className }: { className: string }) {
  const pending = usePendingGrokCode();
  if (!pending || pending.verificationUri.includes(pending.userCode)) {
    return null;
  }
  return (
    <div className={className}>
      <InstrumentGlyph
        className="shrink-0 text-brand-600 dark:text-brand-400"
        size={18}
      />
      <span className="min-w-0 flex-1 truncate">
        Enter{" "}
        <span className="font-mono font-medium select-all">
          {pending.userCode}
        </span>{" "}
        on this page.
      </span>
    </div>
  );
}
