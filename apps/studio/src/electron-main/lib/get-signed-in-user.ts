import {
  chatGPTAccountPeople,
  chatGPTAccountUser,
} from "@/electron-main/lib/chatgpt-account";
import {
  claudeAccountStatus,
  claudeAccountStatusKnown,
} from "@/electron-main/lib/claude-account";
import { grokAccountPeople } from "@/electron-main/lib/grok-account";
import {
  platformApiQueryClient,
  platformApiRpcClient,
} from "@/electron-main/platform-api/client";
import { hasToken } from "@/electron-main/platform-api/utils";

/**
 * The signed-in account's name and email, for the workspace to tell its
 * agents whose work it is, or undefined while nobody is signed in. The
 * Instrument account answers first, read through the same cached query the
 * Settings screen reads, so it costs a request only when that has gone stale;
 * without one, the first ChatGPT account signed in for a plan answers from what
 * its ID token said. A request that fails falls through the same way rather
 * than erroring, since a session's context must be built whatever the
 * network is doing.
 */
export async function getSignedInUser(): Promise<
  undefined | { email: string; name?: string }
> {
  if (!hasToken()) {
    return chatGPTAccountUser();
  }
  try {
    const me = await platformApiQueryClient.fetchQuery(
      platformApiRpcClient.users.getMe.queryOptions(),
    );
    return { email: me.email, name: me.name };
  } catch {
    return chatGPTAccountUser();
  }
}

type Person = { email: string; name?: string };

/**
 * How long a report waits to learn who is signed in before going with what
 * it already knows.
 */
const PEOPLE_WAIT_MS = 10_000;

/**
 * Every account signed in that is known without a request, for a report to
 * take out of what it sends: the Instrument account as last fetched, every
 * ChatGPT and Grok account kept here, and the Claude account as Claude Code
 * last named it.
 */
export function knownSignedInPeople(): Person[] {
  const me = platformApiQueryClient.getQueryData(
    platformApiRpcClient.users.getMe.queryKey(),
  );
  const claude = claudeAccountStatus();
  return [
    ...(me ? [{ email: me.email, name: me.name }] : []),
    ...chatGPTAccountPeople(),
    ...grokAccountPeople(),
    ...(claude.kind === "signed-in" && claude.email
      ? [{ email: claude.email }]
      : []),
  ];
}

/**
 * The same, once the Instrument account has been asked for and Claude Code
 * has been read, each given `PEOPLE_WAIT_MS` at most. `unknownAccount` says
 * the app is signed in to Instrument but could not learn whose account it is.
 */
export async function signedInPeople(): Promise<{
  people: Person[];
  unknownAccount: boolean;
}> {
  const settled = <T>(work: Promise<T>) => {
    const done = work.catch(() => undefined);
    return Promise.race([
      done,
      new Promise<undefined>((resolve) => {
        const timer = setTimeout(resolve, PEOPLE_WAIT_MS);
        void done.then(() => clearTimeout(timer));
      }),
    ]);
  };
  const signedIn = hasToken();
  await Promise.all([
    signedIn
      ? settled(
          platformApiQueryClient.fetchQuery({
            ...platformApiRpcClient.users.getMe.queryOptions(),
            retry: false,
          }),
        )
      : undefined,
    settled(claudeAccountStatusKnown()),
  ]);
  return {
    people: knownSignedInPeople(),
    unknownAccount:
      signedIn &&
      platformApiQueryClient.getQueryData(
        platformApiRpcClient.users.getMe.queryKey(),
      ) === undefined,
  };
}
