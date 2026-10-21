import type { BrowserTargetId } from "@instrument-org/workspace/electron";
import type { AuthInfo, WebContents } from "electron";

import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import {
  createCertificateExceptions,
  createSignInRequests,
  guardGuestSecurity,
  isSignInTrustworthy,
  signInSiteOf,
} from "./guest-security";

const tab = "tab-1" as BrowserTargetId;
const signInFrom = (guestId: number) => ({
  guestId,
  proxy: false,
  realm: "Staging",
  site: "example.com",
  targetId: tab,
  trustworthy: true,
});

describe("sign-in requests", () => {
  it("lists what is waiting without the guest, and answers once", () => {
    const onChange = vi.fn();
    const requests = createSignInRequests(onChange);
    const reply = vi.fn();
    const id = requests.add(signInFrom(7), reply);
    expect(requests.list()).toMatchInlineSnapshot(`
      [
        {
          "id": "1",
          "proxy": false,
          "realm": "Staging",
          "site": "example.com",
          "targetId": "tab-1",
          "trustworthy": true,
        },
      ]
    `);
    expect(requests.answer(id, { password: "hunter2", username: "sam" })).toBe(
      true,
    );
    expect(reply).toHaveBeenCalledExactlyOnceWith({
      password: "hunter2",
      username: "sam",
    });
    expect(requests.answer(id, null)).toBe(false);
    expect(requests.list()).toEqual([]);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("answers Cancel with no credentials", () => {
    const requests = createSignInRequests(vi.fn());
    const reply = vi.fn();
    requests.answer(requests.add(signInFrom(7), reply), null);
    expect(reply).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it("cancels only the dropped guest's requests", () => {
    const requests = createSignInRequests(vi.fn());
    const gone = vi.fn();
    const kept = vi.fn();
    requests.add(signInFrom(7), gone);
    requests.add(signInFrom(7), gone);
    const keptId = requests.add(signInFrom(8), kept);
    requests.dropGuest(7);
    expect(gone).toHaveBeenCalledTimes(2);
    expect(gone).toHaveBeenCalledWith();
    expect(kept).not.toHaveBeenCalled();
    expect(requests.list().map(({ id }) => id)).toEqual([keptId]);
  });
});

describe("certificate exceptions", () => {
  it("trusts a refused certificate only after Continue, by site and fingerprint", () => {
    const onChange = vi.fn();
    const exceptions = createCertificateExceptions(onChange);
    const url = "https://expired.badssl.com/path";
    expect(exceptions.decide(7, url, "sha256/A", true)).toBe(false);
    expect(exceptions.allowRefused(7, "https://other.example/")).toBe(false);
    expect(exceptions.allowRefused(7, url)).toBe(true);
    expect(exceptions.decide(7, url, "sha256/A", true)).toBe(true);
    // Another guest on the same site, the same certificate.
    expect(exceptions.decide(8, url, "sha256/A", true)).toBe(true);
    // A different certificate, or the same one on another site, is not.
    expect(exceptions.decide(7, url, "sha256/B", true)).toBe(false);
    expect(
      exceptions.decide(
        7,
        "https://expired.badssl.com:8443/",
        "sha256/A",
        true,
      ),
    ).toBe(false);
    expect(exceptions.hosts()).toEqual(["expired.badssl.com"]);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("keeps no refusal for what a page loads, only for the page", () => {
    const exceptions = createCertificateExceptions(vi.fn());
    exceptions.decide(7, "https://cdn.example/a.js", "sha256/A", false);
    expect(exceptions.allowRefused(7, "https://cdn.example/")).toBe(false);
  });

  it("forgets a guest's refusal when the guest goes", () => {
    const exceptions = createCertificateExceptions(vi.fn());
    exceptions.decide(7, "https://self-signed.badssl.com/", "sha256/A", true);
    exceptions.forgetGuest(7);
    expect(exceptions.allowRefused(7, "https://self-signed.badssl.com/")).toBe(
      false,
    );
    expect(exceptions.hosts()).toEqual([]);
  });
});

describe("localhost, as Chromium treats it", () => {
  // Chromium shows its certificate interstitial on localhost too: only the
  // --allow-insecure-localhost switch skips it (SSLManager::OnCertError).
  it.each([
    "https://localhost:8443/",
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://app.localhost/",
  ])("refuses a bad certificate on %s until Continue", (url) => {
    const exceptions = createCertificateExceptions(vi.fn());
    expect(exceptions.decide(7, url, "sha256/A", true)).toBe(false);
    expect(exceptions.allowRefused(7, url)).toBe(true);
    expect(exceptions.decide(7, url, "sha256/A", true)).toBe(true);
  });

  // LoginHandler::GetDialogStrings leaves "not private" out for a
  // potentially trustworthy address, localhost over plain http included.
  const site = (url: string): AuthInfo => {
    const { hostname, port } = new URL(url);
    return {
      host: hostname,
      isProxy: false,
      port: Number(port) || 80,
      realm: "",
      scheme: "basic",
    };
  };
  it.each([
    ["http://localhost:8471/", true],
    ["http://localhost.:8471/", true],
    ["http://127.0.0.1:8471/", true],
    ["http://127.4.5.6/", true],
    ["http://[::1]:8471/", true],
    ["http://app.localhost/", true],
    ["https://example.com/", true],
    ["http://example.com/", false],
    ["http://192.168.1.10/", false],
    ["http://localhost.example.com/", false],
  ])("a sign-in at %s is trustworthy: %s", (url, expected) => {
    expect(isSignInTrustworthy(site(url), url)).toBe(expected);
  });

  it.each([
    ["localhost", true],
    ["proxy.example", false],
  ])("a proxy at %s is trustworthy: %s", (host, expected) => {
    expect(
      isSignInTrustworthy(
        { host, isProxy: true, port: 3128, realm: "", scheme: "basic" },
        "https://example.com/",
      ),
    ).toBe(expected);
  });
});

describe("signInSiteOf", () => {
  const info = (over: Partial<AuthInfo>): AuthInfo => ({
    host: "example.com",
    isProxy: false,
    port: 443,
    realm: "",
    scheme: "basic",
    ...over,
  });
  it.each([
    [info({}), "https://example.com/", "example.com"],
    [info({ port: 80 }), "http://example.com/", "example.com"],
    [info({ port: 8080 }), "http://example.com:8080/", "example.com:8080"],
    [
      info({ host: "proxy.local", isProxy: true, port: 3128 }),
      "https://example.com/",
      "proxy.local:3128",
    ],
  ])("%o at %s is %s", (authInfo, url, expected) => {
    expect(signInSiteOf(authInfo, url)).toBe(expected);
  });
});

describe("guardGuestSecurity", () => {
  function setup() {
    const guest = Object.assign(new EventEmitter(), { id: 7 });
    const signIns = createSignInRequests(vi.fn());
    const exceptions = createCertificateExceptions(vi.fn());
    // A fake standing in for the guest's contents: only its events are read.
    guardGuestSecurity(guest as unknown as WebContents, tab, {
      exceptions,
      signIns,
    });
    const login = () => {
      const callback = vi.fn();
      const event = { preventDefault: vi.fn() };
      guest.emit(
        "login",
        event,
        { url: "http://intranet.example/" },
        {
          host: "intranet.example",
          isProxy: false,
          port: 80,
          realm: "Team",
          scheme: "basic",
        },
        callback,
      );
      return { callback, event };
    };
    return { exceptions, guest, login, signIns };
  }

  it("holds a login for the person and passes their answer to Chromium", () => {
    const { login, signIns } = setup();
    const { callback, event } = login();
    expect(event.preventDefault).toHaveBeenCalled();
    const [request] = signIns.list();
    expect(request).toMatchObject({
      site: "intranet.example",
      targetId: tab,
      trustworthy: false,
    });
    signIns.answer(request?.id ?? "", { password: "pw", username: "sam" });
    expect(callback).toHaveBeenCalledExactlyOnceWith("sam", "pw");
  });

  it.each([
    [
      "the guest starts another page",
      ["did-start-navigation", { isMainFrame: true, isSameDocument: false }],
    ],
    ["the guest stops loading", ["did-stop-loading"]],
    ["the guest goes", ["destroyed"]],
  ] as const)("cancels a waiting login when %s", (_when, [name, ...args]) => {
    const { guest, login, signIns } = setup();
    const { callback } = login();
    guest.emit(name, ...args);
    expect(callback).toHaveBeenCalledExactlyOnceWith();
    expect(signIns.list()).toEqual([]);
  });

  it("keeps a waiting login across a same-page navigation", () => {
    const { guest, login, signIns } = setup();
    login();
    guest.emit("did-start-navigation", {
      isMainFrame: true,
      isSameDocument: true,
    });
    expect(signIns.list()).toHaveLength(1);
  });

  it("refuses a bad certificate until Continue, then trusts it", () => {
    const { exceptions, guest } = setup();
    const certificateError = () => {
      const callback = vi.fn();
      guest.emit(
        "certificate-error",
        { preventDefault: vi.fn() },
        "https://self-signed.badssl.com/",
        "net::ERR_CERT_AUTHORITY_INVALID",
        { fingerprint: "sha256/A" },
        callback,
        true,
      );
      return callback;
    };
    expect(certificateError()).toHaveBeenCalledWith(false);
    exceptions.allowRefused(7, "https://self-signed.badssl.com/");
    expect(certificateError()).toHaveBeenCalledWith(true);
  });
});
