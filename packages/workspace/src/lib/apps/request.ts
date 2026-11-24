import { err, ok, type Result } from "neverthrow";

import { appKeySlots, type KeyPlacement, type PlacedKey } from "./keys";
import { type ApiAppManifest } from "./manifest";
import { checkAppUrl } from "./safe-url";

const MAX_REDIRECTS = 5;
// Cap response bodies read into memory; larger payloads are truncated with a
// marker so the agent knows to narrow the request.
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export interface AppRequestError {
  message: string;
  reason:
    | "invalid-headers"
    | "invalid-path"
    | "network"
    | "too-many-redirects"
    | "unsafe-url";
}

export interface AppResponse {
  bodyText: string;
  contentType: string;
  status: number;
  truncated: boolean;
  url: string;
}

/**
 * Build the request URL by joining `path` onto the manifest's base. The path
 * is never parsed as a full URL, so a request can only ever target the
 * app's configured origin; query params are appended separately.
 */
export function buildAppUrl({
  params,
  path,
  url: appUrl,
}: {
  /** The manifest's `url`, which every request starts from. */
  url: string;
  params: Record<string, string>;
  path: string;
}): Result<URL, AppRequestError> {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//")) {
    return err({
      message: `The path must be relative to the app's base URL (got "${path}"). Do not pass a full URL.`,
      reason: "invalid-path",
    });
  }

  const base = new URL(appUrl);
  const basePath = base.pathname.replace(/\/$/, "");
  const requestPath = path.startsWith("/") ? path : `/${path}`;

  // Query strings belong in `params`; a raw "?" in the path would silently
  // swallow everything after it during normalization below.
  const questionMarkIndex = requestPath.indexOf("?");
  const pathOnly =
    questionMarkIndex === -1
      ? requestPath
      : requestPath.slice(0, questionMarkIndex);
  const inlineQuery =
    questionMarkIndex === -1
      ? undefined
      : requestPath.slice(questionMarkIndex + 1);

  const url = new URL(base.origin);
  url.pathname = `${basePath}${pathOnly}`;

  // Containment is checked against the *normalized* pathname the URL setter
  // produces, which collapses dot-segments -- including percent-encoded ones
  // like `%2e%2e` -- so a traversal that escapes the base path fails this
  // check. Comparing the normalized pathname (rather than the raw string) also
  // means ordinary characters the setter encodes (spaces, non-ASCII) are
  // accepted instead of being mistaken for tampering.
  if (
    basePath !== "" &&
    url.pathname !== basePath &&
    !url.pathname.startsWith(`${basePath}/`)
  ) {
    return err({
      message: `The path "${path}" escapes the app's base path "${base.pathname}".`,
      reason: "invalid-path",
    });
  }

  if (inlineQuery !== undefined) {
    for (const [key, value] of new URLSearchParams(inlineQuery)) {
      url.searchParams.append(key, value);
    }
  }
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return ok(url);
}

/**
 * Perform one app request: inject each key where the manifest places
 * it, follow redirects manually (each hop re-validated, credentials
 * dropped when a redirect leaves the app's origin), and read the body
 * with a size cap. The credential value never appears in the returned data;
 * callers additionally redact it from the body before showing the agent.
 */
export async function performAppRequest({
  body: requestBody,
  keys,
  manifest,
  method: requestMethod,
  params,
  path,
  signal,
}: {
  body: string | undefined;
  keys: PlacedKey[];
  manifest: ApiAppManifest;
  method: string;
  params: Record<string, string>;
  path: string;
  signal: AbortSignal;
}): Promise<Result<AppResponse, AppRequestError>> {
  const urlResult = buildAppUrl({
    params,
    path,
    url: manifest.url,
  });
  if (urlResult.isErr()) {
    return err(urlResult.error);
  }

  const origin = new URL(manifest.url).origin;
  const queryParams = appKeySlots(manifest).flatMap(({ placement }) =>
    placement.kind === "query" ? [placement.param] : [],
  );

  let url = urlResult.value;
  let authenticated = true;
  let method = requestMethod;
  let body = requestBody;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const hopValid = await validateHopUrl(url);
    if (hopValid.isErr()) {
      return err(hopValid.error);
    }

    const headers = new Headers({ Accept: "application/json" });
    if (body !== undefined) {
      headers.set("Content-Type", "application/json");
    }
    if (authenticated) {
      // Static manifest headers (e.g. Notion-Version) ride with the request;
      // like the credential, they are dropped once a redirect leaves the
      // app's origin. The auth binding is applied last so a manifest
      // header can never shadow it.
      // What `Headers` throws quotes the value it refused, so it goes no further.
      try {
        for (const [name, value] of Object.entries(manifest.headers ?? {})) {
          headers.set(name, value);
        }
        for (const key of keys) {
          applyKey(key, { headers, url });
        }
      } catch {
        return err({
          message:
            "The request's headers can't be sent: a header name or value in the app's setup, or its key, has a character HTTP does not allow.",
          reason: "invalid-headers",
        });
      }
    }

    let response: Response;
    try {
      response = await fetch(url, {
        body,
        headers,
        method,
        redirect: "manual",
        signal,
      });
    } catch (error) {
      return err({
        message: `Request to ${url.origin} failed: ${error instanceof Error ? error.message : String(error)}`,
        reason: "network",
      });
    }

    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location !== null) {
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        return err({
          message: `Received an invalid redirect location: ${location}`,
          reason: "network",
        });
      }
      // Never carry the credential across origins. For query auth the
      // credential lives in the URL, so also strip it from the redirect target
      // (whether we injected it or the upstream reflected it into Location).
      if (next.origin !== origin) {
        authenticated = false;
        for (const param of queryParams) {
          next.searchParams.delete(param);
        }
      }
      // Fetch's rules: a 303 asks for the result with GET (HEAD stays HEAD),
      // and a 301 or 302 answering a POST is followed as a GET, both without
      // the body. A 307 or 308 repeats the request as it was.
      if (
        (response.status === 303 && method !== "GET" && method !== "HEAD") ||
        ((response.status === 301 || response.status === 302) &&
          method === "POST")
      ) {
        method = "GET";
        body = undefined;
      }
      url = next;
      continue;
    }

    try {
      const { bodyText, truncated } = await readBodyCapped(response);
      return ok({
        bodyText,
        contentType: response.headers.get("content-type") ?? "",
        status: response.status,
        truncated,
        // Strip the query-auth credential from the display URL at the source;
        // url.toString() percent-encodes it, which plain string redaction on the
        // raw credential would miss.
        url: displayUrl(url, queryParams),
      });
    } catch (error) {
      return err({
        message: `Reading the response body failed: ${error instanceof Error ? error.message : String(error)}`,
        reason: "network",
      });
    }
  }

  return err({
    message: `Gave up after ${MAX_REDIRECTS} redirects.`,
    reason: "too-many-redirects",
  });
}

/**
 * Replace every occurrence of the credential in agent-visible text, in each
 * form a service can hand it back: as it is, percent-encoded as a URL carries
 * it, escaped as JSON writes it, and the base64 a Basic header carries.
 */
export function redactCredential(
  text: string,
  credential: null | string,
  placement?: KeyPlacement,
): string {
  return credential === null
    ? text
    : redactForms(text, echoedForms(credential, placement));
}

/** `redactCredential` for every key an app sends, whichever of them a service echoes. */
export function redactKeys(text: string, keys: PlacedKey[]): string {
  return redactForms(
    text,
    keys.flatMap(({ placement, value }) => echoedForms(value, placement)),
  );
}

function echoedForms(credential: string, placement?: KeyPlacement): string[] {
  if (credential.length === 0) {
    return [];
  }
  const carried =
    placement?.kind === "basic"
      ? [credential, basicUserinfo(placement, credential)]
      : [credential];
  return carried.flatMap((value) => [
    value,
    encodeURIComponent(value),
    JSON.stringify(value).slice(1, -1),
  ]);
}

function redactForms(text: string, forms: string[]): string {
  // Longest first, so a form that holds another is taken out whole.
  return [...new Set(forms)]
    .sort((a, b) => b.length - a.length)
    .reduce((out, form) => out.split(form).join("[REDACTED]"), text);
}

/** What a Basic header carries: the username, when there is one, and the key, in base64. */
function basicUserinfo(
  placement: Extract<KeyPlacement, { kind: "basic" }>,
  credential: string,
): string {
  const userinfo =
    placement.user === undefined
      ? credential
      : `${placement.user}:${credential}`;
  return Buffer.from(userinfo, "utf8").toString("base64");
}

/**
 * Why a key can't be sent the way its app sends it, for the person who pasted
 * it, or undefined when it can. A header takes no character past Latin-1 and
 * no control character; an environment variable takes no NUL.
 */
export function unsendableKey(
  { kind }: KeyPlacement,
  credential: string,
): string | undefined {
  const refused =
    kind === "bearer" || kind === "header"
      ? /[^\t\x20-\x7e\x80-\xff]/
      : kind === "env"
        ? /\0/
        : undefined;
  return refused?.test(credential)
    ? "The key has a character in it that can’t be sent, often an invisible one picked up while copying. Copy the key again and paste it here."
    : undefined;
}

function applyKey(
  { placement, value }: PlacedKey,
  { headers, url }: { headers: Headers; url: URL },
) {
  switch (placement.kind) {
    case "basic": {
      headers.set("Authorization", `Basic ${basicUserinfo(placement, value)}`);
      break;
    }
    case "bearer": {
      headers.set("Authorization", `Bearer ${value}`);
      break;
    }
    case "env": {
      // A local server's alone: no request carries one.
      break;
    }
    case "header": {
      headers.set(placement.header, value);
      break;
    }
    case "query": {
      url.searchParams.set(placement.param, value);
      break;
    }
  }
}

/**
 * The request URL as shown to the agent, with a query-auth credential removed
 * at the source (never rely on string redaction alone for URL-borne secrets).
 */
function displayUrl(url: URL, queryParams: string[]): string {
  const present = queryParams.filter((param) => url.searchParams.has(param));
  if (present.length === 0) {
    return url.toString();
  }
  const copy = new URL(url.toString());
  for (const param of present) {
    copy.searchParams.set(param, "[REDACTED]");
  }
  return copy.toString();
}

async function readBodyCapped(response: Response): Promise<{
  bodyText: string;
  truncated: boolean;
}> {
  const reader = response.body?.getReader();
  if (!reader) {
    return { bodyText: "", truncated: false };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      chunks.push(
        value.slice(0, value.byteLength - (total - MAX_RESPONSE_BYTES)),
      );
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return {
    bodyText: new TextDecoder().decode(Buffer.concat(chunks)),
    truncated,
  };
}

/** Per-hop guard, mapping the shared URL check onto this tool's error shape. */
async function validateHopUrl(
  url: URL,
): Promise<Result<undefined, AppRequestError>> {
  const message = await checkAppUrl(url);
  return message === null
    ? ok(undefined)
    : err({ message, reason: "unsafe-url" });
}
