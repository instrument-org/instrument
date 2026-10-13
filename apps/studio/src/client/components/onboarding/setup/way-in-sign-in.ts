import { useSetup } from "@/client/components/onboarding/setup/context";
import {
  type PlanReport,
  reportFromCheck,
  stepAfterConnect,
} from "@/client/components/onboarding/setup/way-in-routing";
import { useLoginSocial } from "@/client/hooks/use-login-social";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/client/lib/toast";

/**
 * How a page moves on once an account connects: `go` keeps the page behind it
 * for Back, `replace` leaves it out (a waiting page, or a retry).
 */
type Move = "go" | "replace";

function useRouteAfterConnect() {
  const { dispatch } = useSetup();
  return ({
    move,
    provider,
    report,
  }: {
    move: Move;
    provider: "chatgpt" | "claude";
    report: PlanReport;
  }) => {
    const next = stepAfterConnect({ provider, report });
    dispatch({ type: "way", way: provider });
    dispatch({ answers: next.answers, type: "answer" });
    dispatch({ step: next.step, type: move });
  };
}

/**
 * Google's sign-in to an Instrument account, held as a wait while the
 * browser has it. On success the first name, once the account reports it,
 * becomes the setup's `firstName`.
 */
export function useGoogleWayIn({ onSignedIn }: { onSignedIn: () => void }) {
  const { dispatch } = useSetup();
  const { login } = useLoginSocial();
  const [waiting, setWaiting] = useState(false);
  // Counts presses, so a sign-in that settles after a newer one started
  // leaves the button to the newer one.
  const attempts = useRef(0);

  const start = async () => {
    const attempt = ++attempts.current;
    setWaiting(true);
    const outcome = await login().catch(() => "failed" as const);
    if (attempt !== attempts.current) {
      return;
    }
    setWaiting(false);
    if (outcome === "signed-in") {
      void readFirstName().then((firstName) => {
        if (firstName) {
          dispatch({ answers: { firstName }, type: "answer" });
        }
      });
      onSignedIn();
    } else if (outcome === "failed") {
      toast.error("Couldn't sign in with Google", {
        description: "Try again, or choose another way in.",
      });
    }
  };

  const cancel = () => {
    attempts.current++;
    setWaiting(false);
    void rpcClient.auth.cancelSignIn.call();
  };

  return { cancel, start, waiting };
}

/**
 * The signed-in user's first name, from the first answer the account gives
 * with a user in it, or null when none comes within a few seconds.
 */
async function readFirstName(): Promise<null | string> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, 10_000);
  try {
    const answers = await rpcClient.user.live.me.call(
      {},
      { signal: controller.signal },
    );
    for await (const user of answers) {
      if (user) {
        return user.name.trim().split(/\s+/)[0] || null;
      }
    }
  } catch {
    // No name is fine: the pages that greet by name have a line without one.
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return null;
}

/**
 * Sign in with ChatGPT in the browser, check the account can be used here
 * (its plan, and one short request on it), then move on by what the check
 * says. `checking` is up while the check runs, a few seconds.
 */
export function useChatGPTWayIn({ move }: { move: Move }) {
  const routeAfterConnect = useRouteAfterConnect();
  const [waiting, setWaiting] = useState(false);
  const [checking, setChecking] = useState(false);
  const attempts = useRef(0);
  // The account that signed in without allowing plan use, asked again next.
  const [declinedAccountId, setDeclinedAccountId] = useState<string>();

  const start = async () => {
    const attempt = ++attempts.current;
    setWaiting(true);
    const result = await rpcClient.chatgptAccount.signIn
      .call({ accountId: declinedAccountId })
      .catch((error: unknown) => ({
        error: error instanceof Error ? error.message : "Sign-in failed",
        outcome: "failed" as const,
      }));
    if (attempt !== attempts.current) {
      return;
    }
    switch (result.outcome) {
      case "signed-in": {
        // Setup's last step opens a chat, so the plan's model becomes the
        // default before moving on.
        if (!result.account) {
          setWaiting(false);
          routeAfterConnect({
            move,
            provider: "chatgpt",
            report: { kind: "could-not-connect" },
          });
          return;
        }
        const accountId = result.account.id;
        await rpcClient.chatgptAccount.chooseDefaultModel
          .call({ accountId })
          .catch(() => {});
        setChecking(true);
        const report = await rpcClient.chatgptAccount.check
          .call({ accountId })
          .then(reportFromCheck)
          .catch((): PlanReport => ({ kind: "could-not-connect" }));
        setChecking(false);
        if (attempt !== attempts.current) {
          return;
        }
        routeAfterConnect({ move, provider: "chatgpt", report });
        return;
      }
      case "plan-off": {
        setWaiting(false);
        setDeclinedAccountId(result.account?.id);
        toast.error(`${APP_NAME} isn't allowed to use your plan yet`, {
          description: "Press ChatGPT again and allow plan use.",
        });
        return;
      }
      case "failed": {
        setWaiting(false);
        routeAfterConnect({
          move,
          provider: "chatgpt",
          report: { kind: "could-not-connect" },
        });
        return;
      }
      case "canceled":
      case "declined": {
        setWaiting(false);
        return;
      }
    }
  };

  const cancel = () => {
    attempts.current++;
    setWaiting(false);
    setChecking(false);
    void rpcClient.chatgptAccount.cancelSignIn.call();
  };

  return { cancel, checking, start, waiting };
}

export function useClaudeStatus() {
  const { data } = useQuery(
    rpcClient.claudeAccount.live.status.experimental_liveOptions(),
  );
  return data;
}

/**
 * Uses the Claude account our copy of Claude Code is signed in to, then
 * checks it can be used here (its plan and usage, and one short request on
 * it) to say where setup goes. The check can take up to about 15 seconds.
 */
async function connectClaude(): Promise<PlanReport> {
  const { status } = await rpcClient.claudeAccount.connect.call({});
  if (status.kind === "not-a-plan") {
    return { kind: "no-paid-plan" };
  }
  if (status.kind !== "signed-in") {
    return { kind: "could-not-connect" };
  }
  return reportFromCheck(await rpcClient.claudeAccount.check.call());
}

/**
 * Claude from Welcome or the no-paid-plan page: connects at once when Claude
 * is already signed in here, and otherwise opens the sign-in page.
 */
export function useClaudeWayIn({ move }: { move: Move }) {
  const { dispatch } = useSetup();
  const routeAfterConnect = useRouteAfterConnect();
  const status = useClaudeStatus();
  const [connecting, setConnecting] = useState(false);

  const start = async () => {
    if (status?.kind === "signed-in") {
      setConnecting(true);
      const report = await connectClaude().catch(
        (): PlanReport => ({ kind: "could-not-connect" }),
      );
      routeAfterConnect({ move, provider: "claude", report });
      return;
    }
    dispatch({ type: "way", way: "claude" });
    dispatch({ step: "claude-sign-in", type: move });
  };

  return { connecting, start };
}

/**
 * Starts Claude's sign-in in the browser when the page opens, unless one is
 * already waiting. Answers why it could not start, when it could not, and a
 * way to start it again.
 */
export function useStartClaudeSignIn() {
  const status = useClaudeStatus();
  const started = useRef(false);
  const {
    data,
    error: failure,
    mutate: open,
  } = useMutation(rpcClient.claudeAccount.signIn.mutationOptions());
  const error =
    data?.error ??
    (failure ? "Claude's sign-in didn't open. Try again." : undefined);

  useEffect(() => {
    if (started.current || !status) {
      return;
    }
    started.current = true;
    if (!status.signingIn && status.kind !== "signed-in") {
      open({});
    }
  }, [open, status]);

  return {
    error,
    retry: () => {
      open({});
    },
    status,
  };
}

/**
 * Watches a Claude sign-in waiting in the browser or on another device, and
 * moves on when it ends: signed in, it connects and goes where the plan says;
 * ended any other way, it says we couldn't connect. `stop` hands the page
 * back to the person, for Cancel or another way in.
 */
export function useClaudeSignInPickup() {
  const routeAfterConnect = useRouteAfterConnect();
  const status = useClaudeStatus();
  const sawWaiting = useRef(false);
  const settled = useRef(false);

  useEffect(() => {
    if (!status || settled.current) {
      return;
    }
    if (status.signingIn) {
      sawWaiting.current = true;
      return;
    }
    if (status.kind === "signed-in") {
      settled.current = true;
      void connectClaude()
        .catch((): PlanReport => ({ kind: "could-not-connect" }))
        .then((report) => {
          routeAfterConnect({ move: "replace", provider: "claude", report });
        });
      return;
    }
    if (sawWaiting.current && status.install?.state !== "downloading") {
      settled.current = true;
      routeAfterConnect({
        move: "replace",
        provider: "claude",
        report: { kind: "could-not-connect" },
      });
    }
  });

  const stop = () => {
    settled.current = true;
    void rpcClient.claudeAccount.cancelSignIn.call({});
  };

  // Signed in while this page is still up means the account is being checked;
  // the check moves the page on when it is done.
  return { checking: status?.kind === "signed-in", status, stop };
}
