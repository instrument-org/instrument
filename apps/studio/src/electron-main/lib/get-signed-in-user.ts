import {
  platformApiQueryClient,
  platformApiRpcClient,
} from "@/electron-main/platform-api/client";
import { hasToken } from "@/electron-main/platform-api/utils";

/**
 * The signed-in account's name and email, for the workspace to tell its
 * agents whose work it is, or undefined while nobody is signed in. Read
 * through the same cached query the Settings screen reads, so it costs a
 * request only when that has gone stale; a request that fails reads as
 * nobody rather than as an error, since a session's context must be built
 * whatever the network is doing.
 */
export async function getSignedInUser(): Promise<
  undefined | { email: string; name: string }
> {
  if (!hasToken()) {
    return undefined;
  }
  try {
    const me = await platformApiQueryClient.fetchQuery(
      platformApiRpcClient.users.getMe.queryOptions(),
    );
    return { email: me.email, name: me.name };
  } catch {
    return undefined;
  }
}
