import {
  DefenseInDepthBox,
  NetworkAccessDeniedError,
  type SecureFetch,
  TooManyRedirectsError,
} from "just-bash";

import {
  isWorkspaceServerUrl,
  workspaceServerRefusal,
} from "./workspace-server-address";

type FetchResult = Awaited<ReturnType<SecureFetch>>;

// just-bash's own defaults for its network config, kept so a request behaves
// the way it would under `network`.
const MAX_REDIRECTS = 20;
const TIMEOUT_MS = 30_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BODYLESS_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The fetch behind the shell's `curl`, `js-exec`'s `fetch` and `python`'s
 * `jb_http`, handed to just-bash as `BashOptions.fetch` in place of the one
 * it builds from `network`.
 *
 * Every address is open, the local network and loopback included, since the
 * native interpreters reach all of them anyway. The one refusal is
 * Instrument's own workspace server, and just-bash's network config can only
 * allow URLs, never deny one, which is why this replaces it: redirects are
 * followed here, by hand, so each hop is checked before it is requested.
 * Everything else mirrors just-bash's fetch under
 * `dangerouslyAllowFullInternetAccess`: any method, the same redirect and
 * timeout caps, a body cap, and its error classes, whose messages `curl`
 * reads its exit codes from (a refusal, first hop or redirect, is exit 7). Like just-bash's own, it runs in the trusted
 * scope, since `curl` is an untrusted builtin and Node's `fetch` reaches for
 * globals (`WeakRef`) that defense-in-depth blocks there.
 */
export function createSandboxFetch({
  maxResponseSize,
}: {
  maxResponseSize: number;
}): SecureFetch {
  return (url, options = {}) =>
    runTrusted(() => request(url, options, maxResponseSize));
}

async function request(
  url: string,
  options: NonNullable<Parameters<SecureFetch>[1]>,
  maxResponseSize: number,
): Promise<FetchResult> {
  const method = options.method?.toUpperCase() ?? "GET";
  const maxRedirects = Math.min(
    options.maxRedirects ?? MAX_REDIRECTS,
    MAX_REDIRECTS,
  );
  const signal = AbortSignal.any([
    AbortSignal.timeout(Math.min(options.timeoutMs ?? TIMEOUT_MS, TIMEOUT_MS)),
    ...(options.signal ? [options.signal] : []),
  ]);

  let current = await checkedUrl(url, (reason) => {
    throw new NetworkAccessDeniedError(url, reason);
  });
  for (let redirects = 0; ; redirects++) {
    const response = await fetch(current, {
      body: BODYLESS_METHODS.has(method) ? undefined : options.body,
      headers: options.headers,
      method,
      redirect: "manual",
      signal,
    });
    const location = response.headers.get("location");
    if (
      options.followRedirects === false ||
      !REDIRECT_STATUSES.has(response.status) ||
      location === null
    ) {
      return await readResult(response, current.href, maxResponseSize);
    }
    await response.body?.cancel();
    if (redirects >= maxRedirects) {
      throw new TooManyRedirectsError(maxRedirects);
    }
    const target = new URL(location, current).href;
    current = await checkedUrl(target, (reason) => {
      throw new NetworkAccessDeniedError(target, reason);
    });
  }
}

/**
 * just-bash 3.4.1 publishes no declarations for its security module (its
 * `files` list leaves `dist/security` out), so `DefenseInDepthBox` arrives
 * untyped. This is the signature its source gives `runTrustedAsync`.
 */
function runTrusted<T>(run: () => Promise<T>): Promise<T> {
  // oxlint-disable-next-line typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return
  return DefenseInDepthBox.runTrustedAsync(run);
}

async function checkedUrl(
  raw: string,
  refuse: (reason: string) => never,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return refuse("invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return refuse(`only http and https are supported (got ${url.protocol})`);
  }
  if (await isWorkspaceServerUrl(url)) {
    return refuse(workspaceServerRefusal(url));
  }
  return url;
}

async function readResult(
  response: Response,
  url: string,
  maxResponseSize: number,
): Promise<FetchResult> {
  const headers = Object.fromEntries(response.headers.entries());
  const tooLarge = () =>
    new Error(`Response body too large (max: ${maxResponseSize} bytes)`);

  const declared = Number(response.headers.get("content-length"));
  if (declared > maxResponseSize) {
    await response.body?.cancel();
    throw tooLarge();
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxResponseSize) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    body,
    headers,
    status: response.status,
    statusText: response.statusText,
    url,
  };
}
