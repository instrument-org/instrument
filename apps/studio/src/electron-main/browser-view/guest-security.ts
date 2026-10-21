import type { BrowserTargetId } from "@instrument-org/workspace/electron";
import type { AuthInfo, WebContents } from "electron";

import type { GuestSignIn } from "@/shared/browser";

import { isPotentiallyTrustworthy } from "@/shared/potentially-trustworthy";

/** What a person typed into a site's sign-in dialog. */
export interface Credentials {
  password: string;
  username: string;
}

/**
 * The sign-ins pages are waiting on (HTTP basic or digest auth, or a proxy
 * asking), each with the reply Chromium is waiting for, in the order they
 * were asked. A request is answered once: by the person, or with no
 * credentials when its guest navigates away, stops, or goes. Credentials
 * pass straight to Chromium, whose own auth cache is the only place they
 * are kept.
 */
export function createSignInRequests(onChange: () => void) {
  const pending = new Map<
    string,
    {
      reply: (credentials?: Credentials) => void;
      request: GuestSignIn & { guestId: number };
    }
  >();
  let next = 0;

  return {
    /** Records a request and answers its id. */
    add(
      request: Omit<GuestSignIn, "id"> & { guestId: number },
      reply: (credentials?: Credentials) => void,
    ): string {
      next += 1;
      const id = String(next);
      pending.set(id, { reply, request: { ...request, id } });
      onChange();
      return id;
    },
    /**
     * Answers request `id`, with no credentials for null (Cancel). False
     * when it is no longer waiting.
     */
    answer(id: string, credentials: Credentials | null): boolean {
      const waiting = pending.get(id);
      if (!waiting) {
        return false;
      }
      pending.delete(id);
      onChange();
      waiting.reply(credentials ?? undefined);
      return true;
    },
    /** Cancels everything guest `guestId` is waiting on. */
    dropGuest(guestId: number) {
      const dropped = [...pending].filter(
        ([, { request }]) => request.guestId === guestId,
      );
      if (dropped.length === 0) {
        return;
      }
      for (const [id] of dropped) {
        pending.delete(id);
      }
      onChange();
      for (const [, { reply }] of dropped) {
        reply();
      }
    },
    /** The requests waiting, oldest first, as the window draws them. */
    list(): GuestSignIn[] {
      return [...pending.values()].map(
        ({ request: { guestId: _guestId, ...request } }) => request,
      );
    },
  };
}

export type SignInRequests = ReturnType<typeof createSignInRequests>;

/**
 * The certificates a person chose to trust anyway, by site and fingerprint,
 * for as long as the app runs, and the one each guest's page was last
 * refused, which "Continue" trusts. Nothing here is written to disk.
 */
export function createCertificateExceptions(onChange: () => void) {
  const allowed = new Set<string>();
  const refused = new Map<number, { fingerprint: string; host: string }>();
  const keyOf = (host: string, fingerprint: string) =>
    `${host}\n${fingerprint}`;

  return {
    /**
     * Whether trusted anyway: the page's own address only with a
     * certificate the person allowed for its site. The page's own refusal
     * is kept for "Continue"; anything the page loads with a bad
     * certificate is refused without one.
     */
    decide(
      guestId: number,
      url: string,
      fingerprint: string,
      isMainFrame: boolean,
    ): boolean {
      const host = URL.parse(url)?.host;
      if (!host) {
        return false;
      }
      if (allowed.has(keyOf(host, fingerprint))) {
        return true;
      }
      if (isMainFrame) {
        refused.set(guestId, { fingerprint, host });
      }
      return false;
    },
    /**
     * Trusts the certificate guest `guestId` was last refused, when it was
     * for `url`'s site. False when there is none to trust.
     */
    allowRefused(guestId: number, url: string): boolean {
      const host = URL.parse(url)?.host;
      const last = refused.get(guestId);
      if (!host || last?.host !== host) {
        return false;
      }
      refused.delete(guestId);
      allowed.add(keyOf(host, last.fingerprint));
      onChange();
      return true;
    },
    forgetGuest(guestId: number) {
      refused.delete(guestId);
    },
    /** The sites with a certificate trusted anyway, which the address field calls not secure. */
    hosts(): string[] {
      return [...new Set([...allowed].map((key) => key.split("\n")[0] ?? ""))]
        .filter(Boolean)
        .sort();
    },
  };
}

export type CertificateExceptions = ReturnType<
  typeof createCertificateExceptions
>;

/** The site a sign-in names: its host, and its port when not the scheme's own. */
export function signInSiteOf(authInfo: AuthInfo, url: string): string {
  const page = URL.parse(url);
  if (authInfo.isProxy) {
    return `${authInfo.host}:${authInfo.port}`;
  }
  const defaultPort = page?.protocol === "http:" ? 80 : 443;
  return authInfo.port && authInfo.port !== defaultPort
    ? `${authInfo.host}:${authInfo.port}`
    : authInfo.host;
}

/**
 * Whether Chromium's own sign-in dialog would leave out its "not private"
 * line (`LoginHandler::GetDialogStrings`): the address it names is
 * potentially trustworthy, the page's for a site and the proxy's for a proxy.
 * Electron does not say which scheme a proxy speaks, so a proxy is taken as
 * plain http, trustworthy only on localhost.
 */
export function isSignInTrustworthy(authInfo: AuthInfo, url: string): boolean {
  return isPotentiallyTrustworthy(
    authInfo.isProxy ? `http://${authInfo.host}:${authInfo.port}/` : url,
  );
}

/**
 * Asks the person for a guest's sign-ins and decides its certificate
 * errors. A sign-in still waiting is answered with nothing when the guest
 * starts another page, stops loading, or goes, since Chromium has given up
 * on it by then.
 */
export function guardGuestSecurity(
  guest: WebContents,
  targetId: BrowserTargetId,
  {
    exceptions,
    signIns,
  }: { exceptions: CertificateExceptions; signIns: SignInRequests },
) {
  const guestId = guest.id;
  guest.on("login", (event, details, authInfo, callback) => {
    event.preventDefault();
    signIns.add(
      {
        guestId,
        proxy: authInfo.isProxy,
        realm: authInfo.realm,
        site: signInSiteOf(authInfo, details.url),
        targetId,
        trustworthy: isSignInTrustworthy(authInfo, details.url),
      },
      (credentials) => {
        if (credentials) {
          callback(credentials.username, credentials.password);
        } else {
          callback();
        }
      },
    );
  });
  guest.on(
    "certificate-error",
    (event, url, _error, certificate, callback, isMainFrame) => {
      event.preventDefault();
      callback(
        exceptions.decide(guestId, url, certificate.fingerprint, isMainFrame),
      );
    },
  );
  const drop = () => {
    signIns.dropGuest(guestId);
  };
  guest.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      drop();
    }
  });
  guest.on("did-stop-loading", drop);
  guest.once("destroyed", () => {
    drop();
    exceptions.forgetGuest(guestId);
  });
}
