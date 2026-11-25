interface CallInFlight {
  path: string;
  startedAt: number;
}

/**
 * The requests this page has made of the main process and not yet heard back
 * on, for a driving script to tell an app that has settled from one still
 * waiting (`studio-drive.ts`). A live route is in flight only until its stream
 * opens.
 */
const calls = new Set<CallInFlight>();

/** An oRPC link interceptor that counts a call for as long as it is out. */
export async function countCall<T>({
  next,
  path,
}: {
  next: () => Promise<T>;
  path: readonly string[];
}): Promise<T> {
  const call = { path: path.join("."), startedAt: Date.now() };
  calls.add(call);
  try {
    return await next();
  } finally {
    calls.delete(call);
  }
}

export function callsInFlight(): readonly CallInFlight[] {
  return [...calls];
}
