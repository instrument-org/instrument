import {
  type HeadersReceivedResponse,
  type OnHeadersReceivedListenerDetails,
  type Session,
} from "electron";

/**
 * The task browser has no passkeys, and says so the moment a site asks.
 *
 * Electron carries Chromium's WebAuthn plumbing but none of Chrome's browser
 * layer: no sheet to pick a phone or a security key, no password manager, and
 * no way to reach passkeys kept on a phone, in iCloud Keychain, or by another
 * app. Left to Chromium, a request none of that can serve waits with nothing
 * on screen until the site's own timeout, which is minutes, and while it
 * waits every other WebAuthn call on the page fails with "A request is
 * already pending". A site that asks on every sign-in page load (Amazon, for
 * an account that has passkeys) is stuck on each one.
 *
 * So every document gets a Permissions-Policy that turns both passkey calls
 * off, and Chromium refuses them itself, at once, with the `NotAllowedError`
 * a site also gets when someone dismisses a browser's passkey sheet. That is
 * what sends a site to its other ways in: a password, a code, a prompt on a
 * phone. It holds in frames too, since a frame cannot have a feature its
 * page lacks. Nothing runs in the page, so there is nothing there for a
 * sign-in page's scripts to find altered.
 */
const PASSKEYS_OFF =
  "publickey-credentials-get=(), publickey-credentials-create=()";

/**
 * Registers the guest session's one headers listener: `others` answers first
 * (ad blocking's CSP filters), then every document has passkeys turned off.
 * Electron keeps one listener per event, so the two have to share it.
 */
export function refusePasskeys(
  guestSession: Session,
  others: (
    details: OnHeadersReceivedListenerDetails,
  ) => HeadersReceivedResponse,
) {
  guestSession.webRequest.onHeadersReceived((details, callback) => {
    const response = others(details);
    if (
      details.resourceType !== "mainFrame" &&
      details.resourceType !== "subFrame"
    ) {
      callback(response);
      return;
    }
    callback({
      ...response,
      responseHeaders: withPasskeysOff(
        response.responseHeaders ?? details.responseHeaders ?? {},
      ),
    });
  });
}

/**
 * The headers with passkeys turned off. Added after any policy the site sent,
 * under the name it used: the header's directives read as one dictionary in
 * which the last entry for a feature wins, so the site cannot turn it back on.
 */
export function withPasskeysOff(
  headers: Record<string, string | string[]>,
): Record<string, string | string[]> {
  const name =
    Object.keys(headers).find(
      (key) => key.toLowerCase() === "permissions-policy",
    ) ?? "permissions-policy";
  const sent = headers[name] ?? [];
  return {
    ...headers,
    [name]: [...(typeof sent === "string" ? [sent] : sent), PASSKEYS_OFF],
  };
}
