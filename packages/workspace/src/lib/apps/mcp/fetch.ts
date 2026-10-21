/**
 * `fetch`, with its result made an instance of whatever the global `Response`
 * is at the time, and one token refresh shared by every caller holding the
 * same refresh token.
 *
 * The workspace server puts @hono/node-server's lightweight Response on the
 * global (its proxy helper depends on the matching Request, so the override
 * stays), while Node's fetch keeps returning undici's. So in this process a
 * fetched response fails `instanceof Response`. The MCP SDK reads an error
 * body only after that check and otherwise stringifies the object, which is
 * how a service's 403 at client registration came back as "[object Response]"
 * with the status and the body gone. Wrapping the result in the global class
 * costs nothing where the two already agree.
 *
 * Two calls to one app that both meet an expired token both refresh it with
 * the refresh token they read. A server that rotates refresh tokens honors
 * the first and refuses the second with `invalid_grant`, which the SDK answers
 * by invalidating the tokens and asking for a new sign-in. So a refresh posted
 * while another with the same refresh token is in flight, or shortly after
 * one succeeded, gets that refresh's answer instead of a request of its own.
 */
export const fetchForMcp: typeof fetch = async (input, init) => {
  const refresh = refreshKey(input, init);
  if (refresh === undefined) {
    return globalResponse(input, init);
  }
  let shared = refreshes.get(refresh);
  if (shared === undefined) {
    shared = globalResponse(input, init).then(async (response) => ({
      body: await response.arrayBuffer(),
      init: {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
      },
    }));
    refreshes.set(refresh, shared);
    const settled = shared;
    settled.then(
      ({ init: answered }) => {
        // A refused or failed refresh is not kept: a later attempt may be
        // answered differently.
        if (answered.status < 200 || answered.status >= 300) {
          refreshes.delete(refresh);
          return;
        }
        setTimeout(() => {
          if (refreshes.get(refresh) === settled) {
            refreshes.delete(refresh);
          }
        }, REFRESH_REUSE_MS).unref();
      },
      () => {
        refreshes.delete(refresh);
      },
    );
  }
  const { body, init: answered } = await shared;
  return new Response(body.slice(0), answered);
};

// A rotated refresh token is refused from then on, so the answer to its one
// good use stands in for any caller that read it before the new one was saved.
const REFRESH_REUSE_MS = 60_000;

const refreshes = new Map<
  string,
  Promise<{
    body: ArrayBuffer;
    init: { headers: Headers; status: number; statusText: string };
  }>
>();

async function globalResponse(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): Promise<Response> {
  // Typed as unknown because the types say fetch returns the global Response
  // and it does not: the value is a Response of another class.
  const response: unknown = await fetch(input, init);
  if (response instanceof Response) {
    return response;
  }
  const foreign = response as Response;
  return new Response(foreign.body, foreign);
}

/** The token endpoint and refresh token of a refresh grant; nothing for any other request. */
function refreshKey(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): string | undefined {
  if (init?.method !== "POST" || !(init.body instanceof URLSearchParams)) {
    return undefined;
  }
  const token = init.body.get("refresh_token");
  if (init.body.get("grant_type") !== "refresh_token" || !token) {
    return undefined;
  }
  const url =
    input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.href
        : input;
  return `${url}\n${token}`;
}
