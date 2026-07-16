import { err, ok, type Result } from "neverthrow";

import {
  type ApiConnectorManifest,
  type ConnectorAuth,
  isLoopbackHost,
} from "./manifest";

const MAX_REDIRECTS = 5;
// Cap response bodies read into memory; larger payloads are truncated with a
// marker so the agent knows to narrow the request.
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

interface ConnectorRequestError {
  message: string;
  reason: "invalid-path" | "network" | "too-many-redirects" | "unsafe-url";
}

interface ConnectorResponse {
  bodyText: string;
  contentType: string;
  status: number;
  truncated: boolean;
  url: string;
}

const PRIVATE_V4_PATTERNS = [
  /^0\./,
  /^10\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
];

/**
 * Build the request URL by joining `path` onto the manifest's base. The path
 * is never parsed as a full URL, so a request can only ever target the
 * connector's configured origin; query params are appended separately.
 */
export function buildConnectorUrl({
  baseUrl,
  params,
  path,
}: {
  baseUrl: string;
  params: Record<string, string>;
  path: string;
}): Result<URL, ConnectorRequestError> {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//")) {
    return err({
      message: `The path must be relative to the connector's base URL (got "${path}"). Do not pass a full URL.`,
      reason: "invalid-path",
    });
  }

  const base = new URL(baseUrl);
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
      message: `The path "${path}" escapes the connector's base path "${base.pathname}".`,
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
 * Perform one connector request: inject the credential per the manifest's auth
 * binding, follow redirects manually (each hop re-validated, credentials
 * dropped when a redirect leaves the connector's origin), and read the body
 * with a size cap. The credential value never appears in the returned data;
 * callers additionally redact it from the body before showing the agent.
 */
export async function performConnectorRequest({
  body,
  credential,
  manifest,
  method,
  params,
  path,
  signal,
}: {
  body: string | undefined;
  credential: null | string;
  manifest: ApiConnectorManifest;
  method: string;
  params: Record<string, string>;
  path: string;
  signal: AbortSignal;
}): Promise<Result<ConnectorResponse, ConnectorRequestError>> {
  const urlResult = buildConnectorUrl({
    baseUrl: manifest.baseUrl,
    params,
    path,
  });
  if (urlResult.isErr()) {
    return err(urlResult.error);
  }

  const allowLoopback = isLoopbackHost(new URL(manifest.baseUrl).hostname);
  const origin = new URL(manifest.baseUrl).origin;

  let url = urlResult.value;
  let authenticated = true;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const hopValid = validateHopUrl(url, { allowLoopback });
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
      // connector's origin. The auth binding is applied last so a manifest
      // header can never shadow it.
      for (const [name, value] of Object.entries(manifest.headers ?? {})) {
        headers.set(name, value);
      }
      applyAuth({ auth: manifest.auth, credential, headers, url });
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
        if (manifest.auth.kind === "query") {
          next.searchParams.delete(manifest.auth.param);
        }
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
        url: displayUrl(url, manifest.auth),
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
 * Replace every occurrence of the credential in agent-visible text -- both the
 * raw value and its percent-encoded form, since a credential that rode in a URL
 * comes back encoded (e.g. `+`/`/`/`=` in a base64-ish token).
 */
export function redactCredential(
  text: string,
  credential: null | string,
): string {
  if (credential === null || credential.length === 0) {
    return text;
  }
  let out = text.split(credential).join("[REDACTED]");
  const encoded = encodeURIComponent(credential);
  if (encoded !== credential) {
    out = out.split(encoded).join("[REDACTED]");
  }
  return out;
}

function applyAuth({
  auth,
  credential,
  headers,
  url,
}: {
  auth: ConnectorAuth;
  credential: null | string;
  headers: Headers;
  url: URL;
}) {
  if (credential === null) {
    return;
  }
  switch (auth.kind) {
    case "bearer": {
      headers.set("Authorization", `Bearer ${credential}`);
      break;
    }
    case "header": {
      headers.set(auth.header, credential);
      break;
    }
    case "none": {
      break;
    }
    case "query": {
      url.searchParams.set(auth.param, credential);
      break;
    }
  }
}

/**
 * The request URL as shown to the agent, with a query-auth credential removed
 * at the source (never rely on string redaction alone for URL-borne secrets).
 */
function displayUrl(url: URL, auth: ConnectorAuth): string {
  if (auth.kind !== "query" || !url.searchParams.has(auth.param)) {
    return url.toString();
  }
  const copy = new URL(url.toString());
  copy.searchParams.set(auth.param, "[REDACTED]");
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

/**
 * Reject URLs that could reach non-public address space. IP-literal and
 * well-known-name checks only -- DNS resolution is not consulted, matching the
 * guarantee level of the bash sandbox's private-range deny. Loopback stays
 * allowed only when the connector's configured base is itself loopback (local
 * services, tests).
 */
function validateHopUrl(
  url: URL,
  { allowLoopback }: { allowLoopback: boolean },
): Result<undefined, ConnectorRequestError> {
  const hostname = url.hostname.toLowerCase();

  if (isLoopbackHost(hostname)) {
    return allowLoopback
      ? ok(undefined)
      : err({
          message: `Refusing to request loopback address "${hostname}" for a non-loopback connector.`,
          reason: "unsafe-url",
        });
  }

  if (url.protocol !== "https:") {
    return err({
      message: `Connector requests must use https (got "${url.protocol}//").`,
      reason: "unsafe-url",
    });
  }

  if (
    PRIVATE_V4_PATTERNS.some((pattern) => pattern.test(hostname)) ||
    hostname.startsWith("[") ||
    hostname.includes(":")
  ) {
    return err({
      message: `Refusing to request private or non-public address "${hostname}".`,
      reason: "unsafe-url",
    });
  }

  return ok(undefined);
}
