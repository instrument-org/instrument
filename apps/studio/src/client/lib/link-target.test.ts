import { describe, expect, it } from "vitest";

import { destinationParts, mailtoAddress, webUrl } from "./link-target";

const parts = (href: string) => destinationParts(new URL(href));

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

describe("destinationParts", () => {
  it.each([
    [
      "https://channels.finalpoint.org",
      ["https://", "", "channels.finalpoint.org", "/"],
    ],
    [
      "https://channels.finalpoint.org/rotation?team=core#today",
      ["https://", "", "channels.finalpoint.org", "/rotation?team=core#today"],
    ],
    ["http://localhost:5173/x", ["http://", "", "localhost:5173", "/x"]],
    // Credentials are their own piece, never part of the host. They are chosen
    // by whoever wrote the href and decide nothing about where it goes, so the
    // renderer mutes them with the scheme.
    [
      "https://neil:hunter2@finalpoint.co/x",
      ["https://", "neil:hunter2@", "finalpoint.co", "/x"],
    ],
    // The one that matters: a username shaped like the host the reader was
    // expecting. Split off, `evil.test` is the only thing said at full
    // strength; folded into the authority it opened on `github.com`.
    [
      "https://github.com@evil.test/x",
      ["https://", "github.com@", "evil.test", "/x"],
    ],
  ])("splits %j", (href, expected) => {
    const { authority, credentials, scheme, tail } = parts(href);

    expect([scheme, credentials, authority, tail]).toEqual(expected);
  });

  // A label can carry lookalike glyphs and bidi controls. What the parser
  // resolved cannot, which is the whole reason this is read off the URL.
  it("prints a host in punycode and a path percent-encoded", () => {
    expect(parts("https://finalpoınt.co/é")).toMatchObject({
      authority: "xn--finalpont-1pb.co",
      tail: "/%C3%A9",
    });
  });

  it("stands in for the rest of a tail nobody is going to read", () => {
    const { authority, tail } = parts(
      `https://finalpoint.co/x?q=${"tracking".repeat(60)}`,
    );

    expect(authority).toBe("finalpoint.co");
    expect(tail).toHaveLength(181);
    expect(tail.endsWith("…")).toBe(true);
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
