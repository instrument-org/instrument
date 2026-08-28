import { describe, expect, it } from "vitest";

import { mailtoAddress, originToDisclose, webUrl } from "./link-target";

const disclosed = (label: string, href: string) =>
  originToDisclose(label, new URL(href));

describe("originToDisclose", () => {
  // The cases that decide the rule: a label either names the destination's
  // origin or it does not, and every way of naming it partially counts as not.
  it.each([
    // A label that says nothing about where it goes.
    [
      "the channels doc",
      "https://channels.finalpoint.org",
      "channels.finalpoint.org",
    ],
    ["", "https://channels.finalpoint.org", "channels.finalpoint.org"],
    // A label that is the host, which is the whole point of suppressing.
    ["channels.finalpoint.org", "https://channels.finalpoint.org", null],
    ["CHANNELS.FinalPoint.org", "https://channels.finalpoint.org", null],
    ["channels.finalpoint.org/", "https://channels.finalpoint.org", null],
    // A label naming a port the destination is already on.
    ["channels.finalpoint.org:443", "https://channels.finalpoint.org", null],
    ["channels.finalpoint.org:80", "http://channels.finalpoint.org", null],
    // No port named matches whichever port the destination is on.
    ["channels.finalpoint.org", "https://channels.finalpoint.org:8443", null],
    // A port named and not matched is a claim the destination contradicts.
    [
      "channels.finalpoint.org:443",
      "https://channels.finalpoint.org:8443",
      "channels.finalpoint.org:8443",
    ],
    // A scheme named and not matched is answered in the same terms.
    [
      "HTTP://channels.finalpoint.org",
      "https://channels.finalpoint.org",
      "https://channels.finalpoint.org",
    ],
    [
      "https://channels.finalpoint.org",
      "https://channels.finalpoint.org",
      null,
    ],
    // A near-miss host is exactly what the cue exists to catch.
    ["github.com", "https://evil.example", "evil.example"],
    [
      "github.com",
      "https://github.com.evil.example",
      "github.com.evil.example",
    ],
    // Credentials never reach the disclosure, so they can never be suppressed
    // by a label that matched the host in front of them.
    [
      "channels.finalpoint.org",
      "https://user@channels.finalpoint.org",
      "channels.finalpoint.org",
    ],
  ])("discloses %j pointing at %j as %j", (label, href, expected) => {
    expect(disclosed(label, href)).toBe(expected);
  });

  // A URL written out in prose is autolinked with itself as the label, and
  // repeating its own origin after it would be noise on every one of them.
  it.each([
    [
      "https://channels.finalpoint.org/handoff",
      "https://channels.finalpoint.org/handoff",
    ],
    [
      "https://channels.finalpoint.org/handoff?a=1#b",
      "https://channels.finalpoint.org/handoff?a=1#b",
    ],
    ["http://localhost:5173/", "http://localhost:5173/"],
  ])("says nothing about %j, which is its own label", (label, href) => {
    expect(disclosed(label, href)).toBeNull();
  });

  // The cue is origin-level by design, so a label naming the same origin
  // suppresses it whatever path either of them carries.
  it("treats a label naming the same origin as having said it", () => {
    expect(
      disclosed(
        "https://channels.finalpoint.org/handoff",
        "https://channels.finalpoint.org/other",
      ),
    ).toBeNull();
  });

  // A label that names the host and then keeps going still names the host, so
  // repeating it after the label would say nothing the label had not.
  it.each([
    [
      "finalpoint.co/runbooks/rotation",
      "https://finalpoint.co/runbooks/rotation",
    ],
    ["finalpoint.co/runbooks", "https://finalpoint.co/elsewhere"],
  ])(
    "says nothing about %j, whose label opens with the host",
    (label, href) => {
      expect(disclosed(label, href)).toBeNull();
    },
  );

  it("strips bidi controls before reading a label as a host", () => {
    // The label draws as the host but carries an override that could reorder
    // whatever is placed beside it.
    expect(
      disclosed("‮channels.finalpoint.org", "https://channels.finalpoint.org"),
    ).toBeNull();
  });
});

describe("mailtoAddress", () => {
  it.each([
    ["mailto:neil@finalpoint.co", "neil@finalpoint.co"],
    ["MAILTO:neil@finalpoint.co", "neil@finalpoint.co"],
    ["mailto:neil@finalpoint.co?subject=Hi%20there", "neil@finalpoint.co"],
    ["mailto:neil%40finalpoint.co", "neil@finalpoint.co"],
    ["https://finalpoint.co", null],
    ["mailto:", null],
    ["mailto:not-an-address", null],
  ])("reads %j as %j", (href, expected) => {
    expect(mailtoAddress(href)).toBe(expected);
  });

  it("keeps a raw address that is not valid percent-encoding", () => {
    expect(mailtoAddress("mailto:100%@finalpoint.co")).toBe(
      "100%@finalpoint.co",
    );
  });
});

describe("webUrl", () => {
  it.each(["https://finalpoint.co", "http://localhost:5173"])(
    "recognizes %j as a page",
    (href) => {
      expect(webUrl(href)?.href).toBeDefined();
    },
  );

  it.each(["mailto:neil@finalpoint.co", "data:text/plain,hi", "not a url"])(
    "leaves %j to somebody else",
    (href) => {
      expect(webUrl(href)).toBeUndefined();
    },
  );
});
